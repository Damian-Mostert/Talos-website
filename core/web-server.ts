'use client';

import { NeuronMap } from './neuron-map';
import {
  spatialPattern,
  retinaPattern,
  flowPattern,
  proprioceptionPattern,
  objectsToPattern,
} from './vision';
import { buildStatePayload } from './state-sync';

const BUS_NAME = 'talos-bus';

interface BusEnvelope {
  from: string;
  to: string; // a specific client id, or 'server'
  payload: any;
}

// ---------------------------------------------------------------------------
// ws-shaped adapter over BroadcastChannel, so WebUI's connection handler
// (lifted straight from server.js) can use ws.on/.send/.readyState unchanged.
// ---------------------------------------------------------------------------
class BusSocket {
  readyState = 1;
  private listeners: Record<string, Array<(...args: any[]) => void>> = {};

  constructor(private channel: BroadcastChannel, private clientId: string) {}

  on(event: string, cb: (...args: any[]) => void) {
    (this.listeners[event] ||= []).push(cb);
  }

  emit(event: string, ...args: any[]) {
    for (const cb of this.listeners[event] || []) cb(...args);
  }

  send(data: string) {
    try {
      this.channel.postMessage({ from: 'server', to: this.clientId, payload: JSON.parse(data) } satisfies BusEnvelope);
    } catch {
      /* ignore malformed frames, same as the ws version silently would on a closed socket */
    }
  }
}

// ---------------------------------------------------------------------------
// WebUI — ported 1:1 from server.js
// ---------------------------------------------------------------------------
export class WebUI {
  onInput: (text: string) => void;
  private _wsUi: BusSocket | null = null;
  private _wsWorld: BusSocket | null = null;
  private _mood = 'calm';
  private _neural: Record<string, any> = { valence: 0, arousal: 0, drive: 0, norepinephrine: 0 };
  private _neuronMap: NeuronMap | null = null;
  private _mapTimer: ReturnType<typeof setInterval> | null = null;
  private _lastRetina = 0;
  private _brain: any = null;
  private _regionBounds: Array<{ name: string; start: number; end: number; size: number }> | null = null;
  private _ready = false;

  private _channel: BroadcastChannel;
  private _sockets = new Map<string, BusSocket>();

  constructor(onInput: (text: string) => void) {
    this.onInput = onInput;

    this._channel = new BroadcastChannel(BUS_NAME);
    this._channel.onmessage = (e: MessageEvent<BusEnvelope>) => this._onBusMessage(e.data);
  }

  // -- bus plumbing (replaces http.createServer + WebSocketServer) --------

  private _onBusMessage(env: BusEnvelope) {
    if (!env || env.to !== 'server') return;
    const ws = this._getOrCreateSocket(env.from);
    if (env.payload && env.payload.__disconnect) {
      ws.emit('close');
      this._sockets.delete(env.from);
      return;
    }
    ws.emit('message', JSON.stringify(env.payload));
  }

  private _getOrCreateSocket(clientId: string): BusSocket {
    let ws = this._sockets.get(clientId);
    if (!ws) {
      ws = new BusSocket(this._channel, clientId);
      this._sockets.set(clientId, ws);
      this._handleConnection(ws);
    }
    return ws;
  }

  // -- everything below is server.js's `this._wss.on('connection', (ws) => {...})`
  //    body, unchanged --------------------------------------------------

  private _handleConnection(ws: BusSocket) {
    ws.on('message', (raw: string) => {
      try {
        const msg = JSON.parse(raw);
        // Role registration: { role: 'ui' } or { role: 'world' }
        if (msg.role === 'ui') {
          this._wsUi = ws;
          this._broadcastState();
          // If already live, send ready immediately so the browser unlocks
          if (this._ready) {
            try {
              ws.send(JSON.stringify({ type: 'ready', ...this._state() }));
            } catch {}
          }
          return;
        }
        if (msg.role === 'world') {
          this._wsWorld = ws;
          this._broadcastState();
          return;
        }

        // Simple text input from UI
        if (msg.text) {
          this.onInput(msg.text);
          return;
        }

        // Movement intent from the world iframe; the brain decides whether and how to act.
        if (msg.type === 'motorHint' && this._brain) {
          try {
            const motorHint = {
              x: Number(msg.x || 0),
              y: Number(msg.y || 0),
              intensity: Math.max(0, Math.min(1, Number(msg.intensity || 1))),
              hintMode: msg.hintMode || null,
            };
            this._brain.integrateWorldState({
              motorHint,
              body: this._brain.getBody(),
              needs: this._brain.getNeeds(),
              interaction: { note: 'motor-hint' },
            });
            this.updateState(this._mood, { ...this._neural, needs: this._brain.getNeeds(), body: this._brain.getBody() });
            if (this._wsWorld?.readyState === 1) {
              try {
                const worldNeural = { ...this._neural, needs: this._brain.getNeeds() };
                //@ts-ignore
                delete worldNeural.body;
                this._wsWorld.send(JSON.stringify(buildStatePayload(this._mood, { ...worldNeural, body: null })));
              } catch {}
            }
          } catch (e) {}
          return;
        }

        // Vision events from the world iframe
        if (msg.type === 'vision' && Array.isArray(msg.detections) && this._brain) {
          try {
            const labelPattern = spatialPattern(msg.detections, this._brain.layout.visual.size);
            this._brain.perceiveVisual(labelPattern);

            if (Array.isArray(msg.retina) && msg.retina.length > 0 && Number.isInteger(msg.retinaWidth) && Number.isInteger(msg.retinaHeight)) {
              // Rate-limit retina pattern processing to avoid blocking spikes
              const now = Date.now();
              if (now - (this._lastRetina || 0) > 800) {
                this._lastRetina = now;
                const retinaPatternData = retinaPattern(new Uint8Array(msg.retina), msg.retinaWidth, msg.retinaHeight, this._brain.layout.visual.size);
                this._brain.perceiveVisual(retinaPatternData);
              }
            }

            if (Array.isArray(msg.objects) && msg.objects.length > 0) {
              const semanticPattern = objectsToPattern(msg.objects, this._brain.layout.visual.size);
              this._brain.perceiveVisual(semanticPattern);
            }

            if (msg.opticFlow && typeof msg.opticFlow === 'object') {
              const flowPatternData = flowPattern(msg.opticFlow, this._brain.layout.visual.size);
              this._brain.perceiveVisual(flowPatternData);
            }

            if (msg.body && typeof msg.body === 'object') {
              const propPattern = proprioceptionPattern(msg.body, this._brain.layout.sensory.size);
              this._brain.perceive(propPattern);
            }

            // integrateWorldState handles needs/body/interaction — pass detections only once
            this._brain.integrateWorldState({
              body: msg.body,
              needs: msg.needs,
              interaction: msg.interaction,
              opticFlow: msg.opticFlow,
              motorHint: msg.motorHint,
            });
            if (msg.mood || msg.neural) this.updateState(msg.mood || this._mood, { ...this._neural, ...(msg.neural || {}), needs: this._brain.getNeeds(), body: this._brain.getBody() });
            // (no immediate motorIntent forwarding here — motorIntent is included by regular broadcast)
          } catch (e) {}
          // Forward a lightweight vision update to the main UI if connected
          if (this._wsUi && this._wsUi.readyState === 1) {
            try {
              this._wsUi.send(
                JSON.stringify({
                  type: 'vision',
                  objects: msg.objects || [],
                  detections: msg.detections,
                  opticFlow: msg.opticFlow || null,
                  body: msg.body || null,
                })
              );
            } catch {}
          }
          return;
        }
      } catch {}
    });
    ws.on('close', () => {
      if (this._wsUi === ws) this._wsUi = null;
      if (this._wsWorld === ws) this._wsWorld = null;
    });
  }

  attachBrain(brain: any) {
    this._brain = brain;
    this._regionBounds = null; // reset on attach so new regions are picked up
    // Avoid recreating NeuronMap or duplicate timers if attachBrain is called repeatedly
    if (!this._neuronMap) this._neuronMap = new NeuronMap(brain);
    if (this._mapTimer) {
      clearInterval(this._mapTimer);
      this._mapTimer = null;
    }
    this._mapTimer = setInterval(() => {
      if (!this._wsUi || this._wsUi.readyState !== 1) return;
      setTimeout(() => {
        try {
          const snap = this._neuronMap!.snapshot();
          this._wsUi!.send(JSON.stringify(snap));
        } catch {}
      }, 0);
    }, 1000);
  }

  private _send(obj: any) {
    if (this._wsUi?.readyState === 1) this._wsUi.send(JSON.stringify(obj));
  }

  /** No port to bind in the browser — just marks the bus live. Kept for call-site parity. */
  start(_port = 3000) {
    console.log('Talos WebUI \u2192 listening on BroadcastChannel("talos-bus")');
  }

  stop() {
    if (this._mapTimer) clearInterval(this._mapTimer);
  }

  private _state() {
    return { mood: this._mood, neural: this._neural };
  }

  private _broadcastState() {
    const payload = buildStatePayload(this._mood, this._neural);
    try {
      //@ts-ignore
      if (this._brain && typeof this._brain.getMotorIntent === 'function') payload.motorIntent = this._brain.getMotorIntent();
    } catch {}
    if (this._wsUi?.readyState === 1) {
      try {
        this._wsUi.send(JSON.stringify(payload));
      } catch {}
    }
    if (this._wsWorld?.readyState === 1) {
      try {
        const worldPayload = { ...payload, body: null, neural: { ...payload.neural } };
        //@ts-ignore
        delete worldPayload.neural.body;
        this._wsWorld.send(JSON.stringify(worldPayload));
      } catch {}
    }
  }

  log(msg: string) {
    this._send({ type: 'system', text: msg, ...this._state() });
  }
  thinking(msg: string) {
    this._send({ type: 'think', text: msg, ...this._state() });
  }
  brainThinks(msg: string) {
    this._send({ type: 'think', text: msg, ...this._state() });
  }
  brainSpeaks(msg: string) {
    this._send({ type: 'speaks', text: msg, ...this._state() });
  }
  ready() {
    this._ready = true;
    this._send({ type: 'ready', ...this._state() });
  }
  bootProgress() {}

  updateState(mood: string, neural: Record<string, any>) {
    this._mood = mood;
    this._neural = neural;
    if (this._brain) {
      const e = this._brain.engine;
      const l = this._brain.layout;
      if (!this._regionBounds) {
        this._regionBounds = Object.entries(l)
          .map(([name, r]: [string, any]) => ({ name, start: r.start, end: r.end, size: r.end - r.start }))
          .sort((a, b) => a.start - b.start);
      }
      const counts: Record<string, number> = {};
      for (const r of this._regionBounds) counts[r.name] = 0;

      // Cap scan to avoid blocking the event loop on large brains
      const list = e._activeList;
      const limit = Math.min(list.length, 20_000);
      const stride = list.length > limit ? Math.floor(list.length / limit) : 1;
      for (let li = 0; li < list.length; li += stride) {
        const idx = list[li];
        for (const r of this._regionBounds) {
          if (idx < r.start) break;
          if (idx < r.end) {
            counts[r.name]++;
            break;
          }
        }
      }
      // Scale counts back up if we strided
      const scale = stride;
      this._neural.regions = {};
      for (const r of this._regionBounds) {
        const mean = Math.min(1, (counts[r.name] * scale) / r.size * 800);
        this._neural.regions[r.name] = { mean, peak: mean, firing: mean };
      }
    }
    this._broadcastState();
  }
}

// ---------------------------------------------------------------------------
// Singleton accessor — one WebUI instance per page load, shared by whichever
// component (chat page, world page, your brain's main loop) asks for it first.
// ---------------------------------------------------------------------------
let _instance: WebUI | null = null;

/** Get (and lazily create) the shared browser WebUI instance. */
export function getWebUI(onInput?: (text: string) => void): WebUI {
  if (!_instance) {
    _instance = new WebUI(onInput || (() => {}));
    _instance.start();
  } else if (onInput) {
    _instance.onInput = onInput;
  }
  return _instance;
}

// ---------------------------------------------------------------------------
// Client-facing socket — drop-in WebSocket replacement for the pages.
// Use in place of `new WebSocket('ws://' + location.host)`.
// ---------------------------------------------------------------------------
export class PseudoSocket {
  readyState = 0; // 0 CONNECTING, 1 OPEN, 2 CLOSING, 3 CLOSED
  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;

  readonly id: string;
  private channel: BroadcastChannel;
  private closed = false;

  constructor() {
    this.id = 'c_' + Math.random().toString(36).slice(2);
    this.channel = new BroadcastChannel(BUS_NAME);
    this.channel.onmessage = (e: MessageEvent<BusEnvelope>) => {
      if (this.closed) return;
      const env = e.data;
      if (!env || env.to !== this.id) return;
      this.onmessage?.({ data: JSON.stringify(env.payload) });
    };

    // Ensure a WebUI server exists on this bus. If nothing has called
    // getWebUI(onInput) yet, this intentionally throws — wire your brain
    // up before connecting a page, same as you'd start server.js before
    // opening the browser locally.
    getWebUI();

    queueMicrotask(() => {
      if (this.closed) return;
      this.readyState = 1;
      this.onopen?.({});
    });
  }

  send(data: string) {
    if (this.closed || this.readyState !== 1) return;
    let payload: any;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    this.channel.postMessage({ from: this.id, to: 'server', payload } satisfies BusEnvelope);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    try {
      this.channel.postMessage({ from: this.id, to: 'server', payload: { __disconnect: true } } satisfies BusEnvelope);
    } catch {}
    this.channel.close();
    this.onclose?.({});
  }
}

/** Use in place of `new WebSocket(...)`. */
export function connectPseudoSocket(): PseudoSocket {
  return new PseudoSocket();
}