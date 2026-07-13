'use client';

import { useEffect, useRef, useState } from 'react';
import { buildWorldVisionPayload } from '@core/state-sync';
import { connectPseudoSocket, PseudoSocket } from '@core/web-server';

type Needs = { hunger: number; energy: number; joy: number };
type Neural = { valence: number; arousal: number; drive: number; norepinephrine: number };
type MotorIntent = { dx: number; dy: number; strength: number } | null;

const MOVE_ACCEL = 0.017;
const MOVE_DRAG = 0.88;
const MAX_SPEED = 0.16;
const MIN_MOTION = 0.001;
const MOTOR_INTENT_ACCEL = 0.012;
const RETINA_W = 32;
const RETINA_H = 24;

const moodWords: [number, string][] = [
  [0.0, 'fading quiet'],
  [0.25, 'a little dim'],
  [0.45, 'settling in…'],
  [0.6, 'humming softly'],
  [0.8, 'glowing bright'],
  [1.0, 'radiant'],
];
function moodWord(v: number) {
  let w = moodWords[0][1];
  for (const [t, word] of moodWords) if (v >= t) w = word;
  return w;
}

export default function TalosWorldPage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = canvasRef; //useRef<HTMLDivElement | null>(null);
  const wsRef = useRef<PseudoSocket | null>(null);

  // ---- UI-facing state (re-renders the HUD) ----
  const [stats, setStats] = useState<Needs>({ hunger: 80, energy: 70, joy: 60 });
  const [moodLabel, setMoodLabel] = useState('settling in…');
  const [statusDotClass, setStatusDotClass] = useState('pending');
  const [statusText, setStatusText] = useState('connecting');

  // ---- Mutable simulation state (kept in refs so the 60fps loop never re-renders React) ----
  const petRef = useRef({
    x: 0.5,
    y: 0.48,
    vx: 0,
    vy: 0,
    speed: 0,
    heading: 0,
    mood: 0.6,
    blink: 0,
    nextBlink: 2 + Math.random() * 3,
    lastFoodX: undefined as number | undefined,
    lastFoodY: undefined as number | undefined,
  });
  const statsRef = useRef<Needs>({ hunger: 80, energy: 70, joy: 60 });
  const currentMoodRef = useRef('calm');
  const currentNeuralRef = useRef<Neural>({ valence: 0, arousal: 0, drive: 0, norepinephrine: 0 });
  const currentNeedsRef = useRef<Needs>({ hunger: 0.8, energy: 0.7, joy: 0.6 });
  const motionRef = useRef({ x: 0, y: 0 });
  const lastMotorIntentRef = useRef<MotorIntent>(null);
  const keysRef = useRef<Record<string, boolean>>({
    ArrowUp: false,
    ArrowDown: false,
    ArrowLeft: false,
    ArrowRight: false,
  });
  const ringsRef = useRef<
    { x: number; y: number; r: number; maxR: number; life: number; color: string }[]
  >([]);
  const particlesRef = useRef<
    { x: number; y: number; r: number; vy: number; vx: number; phase: number; alpha: number }[]
  >([]);
  const burstsRef = useRef<
    { x: number; y: number; vx: number; vy: number; life: number; color: string }[]
  >([]);
  const dimsRef = useRef({ W: 0, H: 0, DPR: 1 });
  const tRef = useRef(0);
  const lastRetinalSendRef = useRef(0);
  const retinalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // NEW: tracks document.documentElement[data-theme] so the canvas can re-theme itself
  const isLightRef = useRef(false);

  function updateStatsUI() {
    setStats({ ...statsRef.current });
  }

  function syncNeedsFromStats() {
    currentNeedsRef.current = {
      hunger: statsRef.current.hunger / 100,
      energy: statsRef.current.energy / 100,
      joy: statsRef.current.joy / 100,
    };
  }

  function sendVision(detections: any[], objects: string[]) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const pet = petRef.current;
    ws.send(
      JSON.stringify({
        type: 'vision',
        detections,
        objects,
        opticFlow: { x: -pet.vx, y: -pet.vy, magnitude: pet.speed },
        body: { x: pet.x, y: pet.y, vx: pet.vx, vy: pet.vy, speed: pet.speed, heading: pet.heading },
        needs: currentNeedsRef.current,
      })
    );
  }

  function sendWorldScene(interaction: any = null) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== 1) return;
    const pet = petRef.current;
    const payload = {
      //@ts-ignore
      type: 'vision',
      ...buildWorldVisionPayload({
        pet: { x: pet.x, y: pet.y },
        mood: currentMoodRef.current,
        neural: currentNeuralRef.current,
        needs: currentNeedsRef.current,
        body: { x: pet.x, y: pet.y, vx: pet.vx, vy: pet.vy, speed: pet.speed, heading: pet.heading },
        interaction,
      }),
    };
    ws.send(JSON.stringify(payload));
  }

  function spawnRing(x: number, y: number, color: string, maxR = 0.32) {
    ringsRef.current.push({ x, y, r: 0.02, maxR, life: 1, color });
  }
  function spawnBurst(x: number, y: number, color: string) {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.006 + Math.random() * 0.012;
      burstsRef.current.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1, color });
    }
  }

  function poke(x: number, y: number) {
    spawnRing(x, y, 'rgba(224,116,138,0.95)');
    spawnBurst(x, y, '224,116,138');
    setTimeout(() => spawnRing(x, y, 'rgba(167,139,250,0.5)'), 180);

    const stats = statsRef.current;
    stats.energy = Math.max(0, stats.energy - 4);
    stats.joy = Math.max(0, stats.joy - 3);
    const pet = petRef.current;
    pet.blink = 1;
    pet.nextBlink = 0.8 + Math.random();
    syncNeedsFromStats();
    updateStatsUI();

    const det = { label: 'finger', x: Math.max(0, x - 0.05), y: Math.max(0, y - 0.05), w: 0.1, h: 0.1, note: 'poke' };
    sendVision([det], ['finger']);
    sendWorldScene({ x, y, note: 'poke-aversive' });
  }

  function feed() {
    const pet = petRef.current;
    const x = pet.x;
    const y = pet.y - 0.12;
    spawnRing(x, y, 'rgba(240,168,104,0.85)', 0.22);
    spawnBurst(x, y, '240,168,104');

    const stats = statsRef.current;
    const hungerLevel = stats.hunger / 100;
    const feedValue = Math.round(18 * (1.2 - hungerLevel * 0.8));
    stats.hunger = Math.min(100, stats.hunger + feedValue);
    stats.joy = Math.min(100, stats.joy + Math.round(feedValue * 0.3));

    pet.lastFoodX = x;
    pet.lastFoodY = y;
    syncNeedsFromStats();
    updateStatsUI();

    const det = { label: 'food', x: Math.max(0, x - 0.05), y: Math.max(0, y - 0.05), w: 0.1, h: 0.1, note: 'feed' };
    sendVision([det], ['food']);
    sendWorldScene({ x, y, note: 'feed', hungerLevel });
  }

  function applyState(
    mood: string | undefined,
    neural: (Partial<Neural> & { body?: any }) | undefined,
    needs: Needs | null = null,
    motorIntent: MotorIntent = null,
    stateBody: any = null
  ) {
    if (mood) currentMoodRef.current = mood;
    if (neural) {
      const { body: _discardBody, ...neuralState } = neural;
      currentNeuralRef.current = { ...currentNeuralRef.current, ...neuralState };
    }
    if (needs) currentNeedsRef.current = { ...currentNeedsRef.current, ...needs };

    const pet = petRef.current;
    const body = stateBody || null;
    const localControlActive = motionRef.current.x !== 0 || motionRef.current.y !== 0;

    if (body && typeof body.x === 'number' && typeof body.y === 'number') {
      const dx = Math.abs(body.x - pet.x);
      const dy = Math.abs(body.y - pet.y);
      const POS_THRESHOLD = 0.02;
      if (pet.speed < MIN_MOTION || dx > POS_THRESHOLD || dy > POS_THRESHOLD) {
        pet.x = Math.max(0, Math.min(1, body.x));
        pet.y = Math.max(0, Math.min(1, body.y));
      }
    }

    if (!motorIntent && !localControlActive) {
      if (body && typeof body.vx === 'number' && typeof body.vy === 'number') {
        pet.vx = body.vx;
        pet.vy = body.vy;
        pet.speed = typeof body.speed === 'number' ? body.speed : Math.hypot(body.vx, body.vy);
        pet.heading = typeof body.heading === 'number' ? body.heading : Math.atan2(body.vy, body.vx);
      }
    } else if (motorIntent && !localControlActive) {
      if (
        typeof motorIntent.dx === 'number' &&
        typeof motorIntent.dy === 'number' &&
        typeof motorIntent.strength === 'number'
      ) {
        const accel = MOTOR_INTENT_ACCEL * Math.max(0, Math.min(1, motorIntent.strength || 0));
        pet.vx += motorIntent.dx * accel;
        pet.vy += motorIntent.dy * accel;
        pet.speed = Math.hypot(pet.vx, pet.vy);
        if (pet.speed > MIN_MOTION) pet.heading = Math.atan2(pet.vy, pet.vx);
      }
    }

    const EDGE_NUDGE = 0.012;
    if (pet.x <= 0.001 && Math.abs(pet.vx) < 0.002) pet.vx = EDGE_NUDGE;
    if (pet.x >= 0.999 && Math.abs(pet.vx) < 0.002) pet.vx = -EDGE_NUDGE;
    if (pet.y <= 0.001 && Math.abs(pet.vy) < 0.002) pet.vy = EDGE_NUDGE;
    if (pet.y >= 0.999 && Math.abs(pet.vy) < 0.002) pet.vy = -EDGE_NUDGE;

    const stats = statsRef.current;
    if (currentNeedsRef.current && typeof currentNeedsRef.current.hunger === 'number') {
      stats.hunger = Math.max(0, Math.min(100, currentNeedsRef.current.hunger * 100));
      stats.energy = Math.max(0, Math.min(100, currentNeedsRef.current.energy * 100));
      stats.joy = Math.max(0, Math.min(100, currentNeedsRef.current.joy * 100));
    } else {
      const valence = currentNeuralRef.current.valence ?? 0;
      const arousal = currentNeuralRef.current.arousal ?? 0;
      const drive = currentNeuralRef.current.drive ?? 0;
      const ne = currentNeuralRef.current.norepinephrine ?? 0;
      stats.hunger = Math.max(0, Math.min(100, 70 + (0.4 - valence) * 30));
      stats.energy = Math.max(0, Math.min(100, 65 + arousal * 20 + drive * 10));
      stats.joy = Math.max(0, Math.min(100, 60 + valence * 25 + ne * 20));
    }
    pet.mood = Math.max(0, Math.min(1, (stats.hunger + stats.energy + stats.joy) / 300));
    setMoodLabel(moodWord(pet.mood) + ` · ${currentMoodRef.current}`);
    updateStatsUI();
  }

  function updateMovementFromKeys() {
    const keys = keysRef.current;
    const moveX = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    const moveY = (keys.ArrowDown ? 1 : 0) - (keys.ArrowUp ? 1 : 0);
    motionRef.current.x = moveX;
    motionRef.current.y = moveY;

    const intensity = moveX === 0 && moveY === 0 ? 0 : 1.0;
    const payload = { type: 'motorHint', x: moveX, y: moveY, intensity, hintMode: 'vector' };
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify(payload));
    }
  }

  function handlePokeButton() {
    const pet = petRef.current;
    const x = pet.x + (Math.random() - 0.5) * 0.14;
    const y = pet.y + (Math.random() - 0.5) * 0.14;
    poke(x, y);
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    retinalCanvasRef.current = document.createElement('canvas');
    retinalCanvasRef.current.width = RETINA_W;
    retinalCanvasRef.current.height = RETINA_H;
    const retinalCtx = retinalCanvasRef.current.getContext('2d', { willReadFrequently: true } as any);

    // NEW: theme sync — watches <html data-theme="..."> so the canvas can
    // repaint light/dark without needing a postMessage from a parent frame.
    function syncTheme() {
      isLightRef.current = document.documentElement.getAttribute('data-theme') === 'light';
    }
    syncTheme();
    const themeObserver = new MutationObserver(syncTheme);
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

    function resize() {
      const rect = wrapRef.current?.getBoundingClientRect();
      const W = Math.max(1, Math.floor(rect?.width ?? window.innerWidth));
      const H = Math.max(1, Math.floor(rect?.height ?? window.innerHeight));
      const DPR = Math.min(window.devicePixelRatio || 1, 2);
      dimsRef.current = { W, H, DPR };
      canvas!.width = Math.floor(W * DPR);
      canvas!.height = Math.floor(H * DPR);
      canvas!.style.width = W + 'px';
      canvas!.style.height = H + 'px';
      initParticles();
    }

    function initParticles() {
      const { W, H } = dimsRef.current;
      const particles = particlesRef.current;
      particles.length = 0;
      const n = Math.round((W * H) / 26000);
      for (let i = 0; i < n; i++) {
        particles.push({
          x: Math.random(),
          y: Math.random(),
          r: 0.6 + Math.random() * 1.6,
          vy: -(0.004 + Math.random() * 0.008),
          vx: (Math.random() - 0.5) * 0.003,
          phase: Math.random() * Math.PI * 2,
          alpha: 0.15 + Math.random() * 0.35,
        });
      }
    }

    function connect() {
      setStatusDotClass('pending');
      setStatusText('connecting');
      const ws = connectPseudoSocket();
      wsRef.current = ws;
      ws.onopen = () => {
        setStatusDotClass('on');
        setStatusText('connected');
        ws.send(JSON.stringify({ role: 'world' }));
      };
      ws.onclose = () => {
        setStatusDotClass('');
        setStatusText('reconnecting');
        setTimeout(connect, 1500);
      };
      ws.onerror = () => {
        setStatusDotClass('');
        setStatusText('error');
      };
      ws.onmessage = (e) => {
        try {
          const m = JSON.parse(e.data);
          if (m.type === 'vision') console.log('UI vision update', m);
          if (m.type === 'state') {
            const stateBody = m.body || m.neural?.body || null;
            lastMotorIntentRef.current = m.motorIntent || null;
            applyState(m.mood, m.neural, m.needs, lastMotorIntentRef.current, stateBody);
          }
        } catch (err) {
          /* ignore malformed frames */
        }
      };
    }

    function onMessage(event: MessageEvent) {
      if (!event.data || event.data.type !== 'theme') return;
      const theme = String(event.data.theme || 'dark');
      document.documentElement.setAttribute('data-theme', theme);
    }

    function onClick(ev: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      poke(x, y);
    }
    function onTouchStart(ev: TouchEvent) {
      const t0 = ev.touches[0];
      if (!t0) return;
      const rect = canvas!.getBoundingClientRect();
      const x = (t0.clientX - rect.left) / rect.width;
      const y = (t0.clientY - rect.top) / rect.height;
      poke(x, y);
    }

    function keyToDir(key: string) {
      if (key === 'ArrowUp') return 'ArrowUp';
      if (key === 'ArrowDown') return 'ArrowDown';
      if (key === 'ArrowLeft') return 'ArrowLeft';
      return 'ArrowRight';
    }
    function onKeyDown(ev: KeyboardEvent) {
      const key = ev.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        ev.preventDefault();
        keysRef.current[keyToDir(key)] = true;
        updateMovementFromKeys();
      }
    }
    function onKeyUp(ev: KeyboardEvent) {
      const key = ev.key;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) {
        ev.preventDefault();
        keysRef.current[keyToDir(key)] = false;
        updateMovementFromKeys();
      }
    }

    function drawBackground(w: number, h: number) {
      const light = isLightRef.current;
      ctx!.fillStyle = light ? '#f4f1fb' : '#07040d';
      ctx!.fillRect(0, 0, w, h);
      const g = ctx!.createRadialGradient(w * 0.5, h * 0.38, 0, w * 0.5, h * 0.38, Math.max(w, h) * 0.75);
      if (light) {
        g.addColorStop(0, 'rgba(196,182,235,0.55)');
        g.addColorStop(0.55, 'rgba(225,218,245,0.35)');
        g.addColorStop(1, 'rgba(244,241,251,0)');
      } else {
        g.addColorStop(0, 'rgba(46,26,74,0.55)');
        g.addColorStop(0.55, 'rgba(15,10,24,0.4)');
        g.addColorStop(1, 'rgba(7,4,10,0)');
      }
      ctx!.fillStyle = g;
      ctx!.fillRect(0, 0, w, h);
    }

    function drawParticles(w: number, h: number) {
      const light = isLightRef.current;
      const t = tRef.current;
      const { DPR } = dimsRef.current;
      for (const p of particlesRef.current) {
        p.y += p.vy;
        p.x += p.vx + Math.sin(t * 0.5 + p.phase) * 0.0006;
        if (p.y < -0.02) {
          p.y = 1.02;
          p.x = Math.random();
        }
        if (p.x < -0.02) p.x = 1.02;
        if (p.x > 1.02) p.x = -0.02;
        const tw = 0.5 + 0.5 * Math.sin(t * 1.4 + p.phase);
        ctx!.beginPath();
        ctx!.fillStyle = light
          ? `rgba(120,100,170,${p.alpha * (0.5 + 0.5 * tw)})`
          : `rgba(210,195,240,${p.alpha * (0.5 + 0.5 * tw)})`;
        ctx!.arc(p.x * w, p.y * h, p.r * DPR, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function drawRings(w: number, h: number, minDim: number) {
      const { DPR } = dimsRef.current;
      const rings = ringsRef.current;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.r += (r.maxR - r.r) * 0.06 + 0.0015;
        r.life -= 0.018;
        if (r.life <= 0) {
          rings.splice(i, 1);
          continue;
        }
        ctx!.beginPath();
        ctx!.strokeStyle = r.color.replace(/[\d.]+\)$/, (r.life * 0.8).toFixed(3) + ')');
        ctx!.lineWidth = Math.max(1.2, DPR * 1.4);
        ctx!.arc(r.x * w, r.y * h, r.r * minDim, 0, Math.PI * 2);
        ctx!.stroke();
      }
    }

    function drawBursts(w: number, h: number, minDim: number) {
      const { DPR } = dimsRef.current;
      const bursts = burstsRef.current;
      for (let i = bursts.length - 1; i >= 0; i--) {
        const b = bursts[i];
        b.x += b.vx;
        b.y += b.vy;
        b.life -= 0.03;
        if (b.life <= 0) {
          bursts.splice(i, 1);
          continue;
        }
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${b.color},${b.life})`;
        ctx!.arc(b.x * w, b.y * h, 2.2 * DPR * b.life, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function drawPet(w: number, h: number, minDim: number) {
      const t = tRef.current;
      const pet = petRef.current;
      const bob = Math.sin(t * 1.6) * 0.012;
      const breathe = 1 + Math.sin(t * 1.3) * 0.035;
      const arousal = currentNeuralRef.current.arousal ?? 0;
      const valence = currentNeuralRef.current.valence ?? 0;
      const cx = pet.x * w;
      const cy = (pet.y + bob) * h;
      const baseR = 0.09 * minDim * breathe;
      const { DPR } = dimsRef.current;

      const moodT = Math.max(0, Math.min(1, pet.mood));
      const auraGrad = ctx!.createRadialGradient(cx, cy, baseR * 0.2, cx, cy, baseR * 2.6);
      auraGrad.addColorStop(0, `rgba(167,139,250,${0.28 + moodT * 0.15})`);
      auraGrad.addColorStop(1, 'rgba(167,139,250,0)');
      ctx!.beginPath();
      ctx!.fillStyle = auraGrad;
      ctx!.arc(cx, cy, baseR * 2.6, 0, Math.PI * 2);
      ctx!.fill();

      const bodyGrad = ctx!.createRadialGradient(cx - baseR * 0.3, cy - baseR * 0.35, baseR * 0.1, cx, cy, baseR);
      const bodyHue = valence >= 0 ? '#e9e0ff' : '#d8c1ff';
      const bodyMid = valence >= 0 ? '#a78bfa' : '#8f73d9';
      const bodyDeep = arousal > 0.35 ? '#6fd8e0' : '#4a5a6a';
      bodyGrad.addColorStop(0, moodT > 0.4 ? bodyHue : '#c9bfe0');
      bodyGrad.addColorStop(0.55, moodT > 0.4 ? bodyMid : '#7c6fa0');
      bodyGrad.addColorStop(1, moodT > 0.4 ? bodyDeep : '#4a5a6a');
      ctx!.beginPath();
      ctx!.fillStyle = bodyGrad;
      ctx!.arc(cx, cy, baseR, 0, Math.PI * 2);
      ctx!.fill();

      const eyeScale = 0.9 + arousal * 0.25;
      pet.nextBlink -= 1 / 60;
      if (pet.nextBlink <= 0) {
        pet.blink = 1;
        pet.nextBlink = 2.5 + Math.random() * 3;
      }
      if (pet.blink > 0) pet.blink = Math.max(0, pet.blink - 0.14);
      const eyeOpen = 1 - Math.sin(pet.blink * Math.PI);
      const eyeH = baseR * 0.16 * Math.max(0.08, eyeOpen);
      ctx!.fillStyle = '#0a0714';
      [-1, 1].forEach((side) => {
        ctx!.beginPath();
        ctx!.ellipse(cx + side * baseR * 0.34, cy - baseR * 0.12, baseR * 0.1 * eyeScale, eyeH, 0, 0, Math.PI * 2);
        ctx!.fill();
      });

      const mouthShift = valence * 0.08 + arousal * 0.02;
      ctx!.strokeStyle = '#0a0714';
      ctx!.lineWidth = Math.max(2, DPR * 1.6);
      ctx!.beginPath();
      const smile = (moodT - 0.5) * baseR * 0.5;
      ctx!.moveTo(cx - baseR * 0.28, cy + baseR * 0.22);
      ctx!.quadraticCurveTo(cx, cy + baseR * 0.22 + smile + mouthShift, cx + baseR * 0.28, cy + baseR * 0.22);
      ctx!.stroke();
    }

    function sampleRetina() {
      const { W, H } = dimsRef.current;
      const pet = petRef.current;
      //@ts-ignore
      retinalCtx!.drawImage(canvas!, 0, 0, RETINA_W, RETINA_H);
      //@ts-ignore
      const pixels = retinalCtx!.getImageData(0, 0, RETINA_W, RETINA_H).data;

      const retina = new Uint8Array(RETINA_W * RETINA_H * 3);
      let ri = 0;
      for (let row = 0; row < RETINA_H; row++) {
        for (let col = 0; col < RETINA_W; col++) {
          const idx = (row * RETINA_W + col) * 4;
          retina[ri++] = pixels[idx];
          retina[ri++] = pixels[idx + 1];
          retina[ri++] = pixels[idx + 2];
        }
      }

      const aspect = W / H;
      const selfW = aspect >= 1 ? 0.09 * 2 : 0.09 * 2 * aspect;
      const selfH = aspect >= 1 ? 0.09 * 2 / aspect : 0.09 * 2;
      const detections = [
        { label: 'visual-field', x: 0, y: 0, w: 1, h: 1, note: 'retinal scene' },
        {
          label: 'self',
          x: Math.max(0, pet.x - selfW / 2),
          y: Math.max(0, pet.y - selfH / 2),
          w: selfW,
          h: selfH,
          note: `self at ${pet.x.toFixed(2)},${pet.y.toFixed(2)}`,
        },
      ];

      return { detections, retina };
    }

    let rafId = 0;
    function draw() {
      tRef.current += 1 / 60;
      const canvasEl = canvas!;
      drawBackground(canvasEl.width, canvasEl.height);
      drawParticles(canvasEl.width, canvasEl.height);
      drawRings(canvasEl.width, canvasEl.height, Math.min(canvasEl.width, canvasEl.height));
      drawPet(canvasEl.width, canvasEl.height, Math.min(canvasEl.width, canvasEl.height));
      drawBursts(canvasEl.width, canvasEl.height, Math.min(canvasEl.width, canvasEl.height));

      const pet = petRef.current;
      const now = performance.now();
      if (now - lastRetinalSendRef.current > 400) {
        lastRetinalSendRef.current = now;
        const sample = sampleRetina();
        const detections = sample.detections.filter((d) => d.label !== 'void');
        const ws = wsRef.current;
        if (detections.length > 0 && ws && ws.readyState === 1) {
          ws.send(
            JSON.stringify({
              type: 'vision',
              detections,
              objects: [...new Set(detections.map((d) => d.label))],
              retina: Array.from(sample.retina),
              retinaWidth: RETINA_W,
              retinaHeight: RETINA_H,
              retinaChannels: 3,
              body: { x: pet.x, y: pet.y, vx: pet.vx, vy: pet.vy, speed: pet.speed, heading: pet.heading },
              needs: currentNeedsRef.current,
            })
          );
        }
      }

      const motion = motionRef.current;
      const targetMag = Math.hypot(motion.x, motion.y);
      const ws = wsRef.current;
      const connected = ws && ws.readyState === 1;
      if (connected) {
        if (targetMag > 0) {
          const nx = motion.x / targetMag;
          const ny = motion.y / targetMag;
          pet.vx += nx * MOVE_ACCEL * 1.4;
          pet.vy += ny * MOVE_ACCEL * 1.4;
          lastMotorIntentRef.current = null;
          pet.vx *= 0.9;
          pet.vy *= 0.9;
          if (Math.abs(pet.vx) < MIN_MOTION) pet.vx = 0;
          if (Math.abs(pet.vy) < MIN_MOTION) pet.vy = 0;
        } else if (
          lastMotorIntentRef.current &&
          typeof lastMotorIntentRef.current.dx === 'number' &&
          typeof lastMotorIntentRef.current.dy === 'number' &&
          typeof lastMotorIntentRef.current.strength === 'number'
        ) {
          const mi = lastMotorIntentRef.current;
          const accel = MOTOR_INTENT_ACCEL * Math.max(0, Math.min(1, mi.strength));
          pet.vx += mi.dx * accel;
          pet.vy += mi.dy * accel;
        } else {
          pet.vx *= MOVE_DRAG;
          pet.vy *= MOVE_DRAG;
          if (Math.abs(pet.vx) < MIN_MOTION) pet.vx = 0;
          if (Math.abs(pet.vy) < MIN_MOTION) pet.vy = 0;
        }
      } else {
        if (targetMag > 0) {
          const nx = motion.x / targetMag;
          const ny = motion.y / targetMag;
          pet.vx += nx * MOVE_ACCEL;
          pet.vy += ny * MOVE_ACCEL;
        } else {
          pet.vx *= MOVE_DRAG;
          pet.vy *= MOVE_DRAG;
          if (Math.abs(pet.vx) < MIN_MOTION) pet.vx = 0;
          if (Math.abs(pet.vy) < MIN_MOTION) pet.vy = 0;
        }
      }

      let speed = Math.hypot(pet.vx, pet.vy);
      if (speed > MAX_SPEED) {
        const scale = MAX_SPEED / speed;
        pet.vx *= scale;
        pet.vy *= scale;
        speed = MAX_SPEED;
      }

      pet.x = Math.max(0, Math.min(1, pet.x + pet.vx));
      pet.y = Math.max(0, Math.min(1, pet.y + pet.vy));

      if (pet.x <= 0 || pet.x >= 1) pet.vx *= -0.35;
      if (pet.y <= 0 || pet.y >= 1) pet.vy *= -0.35;

      pet.speed = speed;
      if (speed > MIN_MOTION) pet.heading = Math.atan2(pet.vy, pet.vx);

      rafId = requestAnimationFrame(draw);
    }

    // ---- boot ----
    resize();
    applyState('calm', { valence: 0, arousal: 0.2, drive: 0.1, norepinephrine: 0.1 });
    connect();
    rafId = requestAnimationFrame(draw);

    const resizeObserver = new ResizeObserver(() => resize());
    if (wrapRef.current) resizeObserver.observe(wrapRef.current);

    window.addEventListener('resize', resize);
    window.addEventListener('message', onMessage);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    canvas.addEventListener('click', onClick);
    canvas.addEventListener('touchstart', onTouchStart, { passive: true });

    // ---- passive stat drift ----
    const driftInterval = setInterval(() => {
      const stats = statsRef.current;
      stats.hunger = Math.max(0, stats.hunger - 0.3);
      stats.energy = Math.max(0, stats.energy - 0.2);
      stats.joy = Math.max(0, stats.joy - 0.25);
      syncNeedsFromStats();
      updateStatsUI();
    }, 4000);

    // ---- interoceptive loop ----
    const interoInterval = setInterval(() => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== 1) return;
      const stats = statsRef.current;
      const pet = petRef.current;
      const payload = {
        type: 'vision',
        detections: [
          {
            label: stats.hunger < 35 ? 'hunger-pain' : stats.hunger < 60 ? 'hunger-low' : 'satiated',
            x: 0.4,
            y: 0.4,
            w: 0.2,
            h: 0.2,
            note: `hunger=${Math.round(stats.hunger)} energy=${Math.round(stats.energy)} joy=${Math.round(stats.joy)}`,
          },
          {
            label: stats.energy < 25 ? 'fatigue-pain' : stats.energy < 50 ? 'fatigue-low' : 'energised',
            x: 0.4,
            y: 0.5,
            w: 0.2,
            h: 0.2,
            note: 'energy-state',
          },
          {
            label: stats.joy < 30 ? 'distress' : stats.joy < 55 ? 'subdued' : 'content',
            x: 0.5,
            y: 0.4,
            w: 0.2,
            h: 0.2,
            note: 'joy-state',
          },
        ],
        objects: ['interoception'],
        body: { x: pet.x, y: pet.y },
        needs: currentNeedsRef.current,
        motorHint:
          stats.hunger < 50 && pet.lastFoodX != null ? { x: pet.lastFoodX, y: pet.lastFoodY } : null,
      };
      ws.send(JSON.stringify(payload));
    }, 2500);

    return () => {
      cancelAnimationFrame(rafId);
      clearInterval(driftInterval);
      clearInterval(interoInterval);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      window.removeEventListener('resize', resize);
      window.removeEventListener('message', onMessage);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      canvas.removeEventListener('click', onClick);
      canvas.removeEventListener('touchstart', onTouchStart);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div id="wrap"  style={{ width: '100%', height: '100%', minHeight: 0 }}>
      <canvas ref={canvasRef} id="canvas" />

      <div id="nameplate">
        <p id="mood-label">{moodLabel}</p>
      </div>

      <div id="status-pill">
        <span id="status-dot" className={statusDotClass}></span>
        <span id="status-text">{statusText}</span>
      </div>

      <div id="hud">
        <div id="stats">
          <div className="stat hunger">
            <div className="stat-label">
              <span>Hunger</span>
              <span id="hunger-val">{Math.round(stats.hunger)}</span>
            </div>
            <div className="stat-track">
              <div className="stat-fill" id="hunger-fill" style={{ width: `${stats.hunger}%` }}></div>
            </div>
          </div>
          <div className="stat energy">
            <div className="stat-label">
              <span>Energy</span>
              <span id="energy-val">{Math.round(stats.energy)}</span>
            </div>
            <div className="stat-track">
              <div className="stat-fill" id="energy-fill" style={{ width: `${stats.energy}%` }}></div>
            </div>
          </div>
          <div className="stat joy">
            <div className="stat-label">
              <span>Joy</span>
              <span id="joy-val">{Math.round(stats.joy)}</span>
            </div>
            <div className="stat-track">
              <div className="stat-fill" id="joy-fill" style={{ width: `${stats.joy}%` }}></div>
            </div>
          </div>
        </div>
        <div id="controls">
          <button id="btn-poke" className="primary" onClick={handlePokeButton}>
            ✦ Poke
          </button>
          <button id="btn-feed" onClick={feed}>
            ◍ Feed
          </button>
          <span id="hint">tap anywhere to reach Talos</span>
        </div>
      </div>
    </div>
  );
}