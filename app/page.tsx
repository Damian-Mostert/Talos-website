'use client';

import { useEffect, useRef } from 'react';
import TalosWorldPage from './components/world';
import { connectPseudoSocket, PseudoSocket } from '@core/web-server';

export default function TalosChatPage() {
  const toggleThemeRef = useRef<() => void>(() => {});
  const sendRef = useRef<() => void>(() => {});

  useEffect(() => {
    let mounted = true;

    // ---------------------------------------------------------------------
    // Theme
    // ---------------------------------------------------------------------
    let lightMode = document.documentElement.getAttribute('data-theme') === 'light';

    function syncThemeUI() {
      const root = document.documentElement;
      const isLight = root.getAttribute('data-theme') === 'light';
      const toggleBtn = document.getElementById('theme-toggle') as HTMLButtonElement | null;

      if (toggleBtn) {
        toggleBtn.setAttribute('aria-pressed', String(isLight));
        toggleBtn.setAttribute('data-theme-state', isLight ? 'light' : 'dark');
        toggleBtn.setAttribute('title', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      }
    }

    function syncWorldTheme() {
      // NOTE: TalosWorldPage now renders inline as a React component
      // instead of an iframe, so there is no #world-frame element anymore
      // and this postMessage call is a no-op. Left in place for parity;
      // safe to delete once you confirm you don't need it.
      const frame = document.getElementById('world-frame') as HTMLIFrameElement | null;
      if (!frame || !frame.contentWindow) return;
      const theme = document.documentElement.getAttribute('data-theme') || 'dark';
      frame.contentWindow.postMessage({ type: 'theme', theme }, '*');
    }

    function toggleTheme() {
      const root = document.documentElement;
      const isLight = root.getAttribute('data-theme') === 'light';
      const nextTheme = isLight ? 'dark' : 'light';
      root.setAttribute('data-theme', nextTheme);
      lightMode = nextTheme === 'light';
      syncThemeUI();
      syncWorldTheme();
      if (typeof buildBrainOutline === 'function' && CW && CH) buildBrainOutline();
    }
    toggleThemeRef.current = toggleTheme;

    lightMode = document.documentElement.getAttribute('data-theme') === 'light';
    syncThemeUI();
    syncWorldTheme();

    // ---------------------------------------------------------------------
    // Pseudo-socket / mood state
    // ---------------------------------------------------------------------
    let ws: PseudoSocket | null = null;
    let currentMood = 'calm';
    let currentNeural: Record<string, number> = { valence: 0, arousal: 0, drive: 0, norepinephrine: 0 };
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    let breathTimer: number | undefined;

    const MOOD_COLORS: Record<string, string> = {
      engaged: '#7ee8c1',
      curious: '#c9a6ff',
      unsettled: '#ff8a65',
      calm: '#8fb8e0',
      reflective: '#9a8fae',
    };
    function currentMoodColor() {
      return MOOD_COLORS[currentMood] || '#8fb8e0';
    }

    function connect() {
      ws = connectPseudoSocket();

      ws.onopen = () => {
        const conn = document.getElementById('conn');
        if (conn) conn.className = 'on';
        const st = document.getElementById('status-text');
        if (st) st.textContent = 'Connected';
        try {
          ws!.send(JSON.stringify({ role: 'ui' }));
        } catch (e) {}
      };
      ws.onclose = () => {
        const conn = document.getElementById('conn');
        if (conn) conn.className = '';
        const st = document.getElementById('status-text');
        if (st) st.textContent = 'Reconnecting…';
        setTimeout(() => {
          if (mounted) connect();
        }, 3000);
      };
      ws.onmessage = ({ data }) => {
        if (typeof data !== 'string') return;
        const msg = JSON.parse(data);
        if (msg.type === 'nmap') {
          applyNmap(msg);
          return;
        }
        if (msg.mood || msg.neural) applyState(msg.mood, msg.neural);
        if (msg.type === 'system') addMsg(msg.text, 'system');
        if (msg.type === 'think') {
          addThought(msg.text);
          setThinking(true);
        }
        if (msg.type === 'speaks') {
          hideTyping();
          setThinking(false);
          addMsg(msg.text, 'brain');
        }
        if (msg.type === 'ready') {
          hideTyping();
          setThinking(false);
          addMsg('✓ Ready — say something', 'system');
        }
        if (msg.type === 'vision') {
          /* suppress — vision is background sensory, not chat */
        }
        if (msg.type === 'state') {
          applyState(msg.mood, msg.neural);
        }
      };
    }

    const panel = document.getElementById('panel')!;
    const log = document.getElementById('log')!;
    const monologue = document.getElementById('monologue')!;
    const input = document.getElementById('input') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('send-btn')!;

    // -----------------------------------------------------------------------
    // LIVING NEURAL MAP
    // -----------------------------------------------------------------------
    const chatCol = document.getElementById('chat-col')!;
    const neuralCanvas = document.getElementById('neural-canvas') as HTMLCanvasElement;
    const nCtx = neuralCanvas.getContext('2d')!;

    let DPR = Math.min(window.devicePixelRatio || 1, 2);
    let CW = 0,
      CH = 0;

    type Region = {
      name: string;
      rx: number;
      ry: number;
      rr: number;
      col: number[];
      colDark?: number[];
    };

    const RDEF: Region[] = [
      { name: 'prefrontal', rx: 0.5, ry: 0.09, rr: 0.115, col: [110, 231, 183] },
      { name: 'thalamus', rx: 0.5, ry: 0.22, rr: 0.065, col: [255, 180, 120] },
      { name: 'amygdala', rx: 0.28, ry: 0.3, rr: 0.05, col: [255, 100, 130] },
      { name: 'visual', rx: 0.18, ry: 0.16, rr: 0.09, col: [255, 209, 102] },
      { name: 'sensory', rx: 0.82, ry: 0.16, rr: 0.09, col: [143, 184, 224] },
      { name: 'association', rx: 0.5, ry: 0.35, rr: 0.12, col: [126, 232, 193] },
      { name: 'hippocampus', rx: 0.27, ry: 0.48, rr: 0.085, col: [201, 166, 255] },
      { name: 'temporal', rx: 0.73, ry: 0.48, rr: 0.085, col: [242, 166, 201] },
      { name: 'motor', rx: 0.5, ry: 0.62, rr: 0.105, col: [255, 138, 101] },
      { name: 'cerebellum', rx: 0.5, ry: 0.8, rr: 0.095, col: [148, 163, 184] },
    ];
    const RBY_NAME: Record<string, number> = {};
    RDEF.forEach((r, i) => {
      RBY_NAME[r.name] = i;
    });

    RDEF.forEach((r) => {
      const [cr, cg, cb] = r.col;
      const max = Math.max(cr, cg, cb) || 1;
      r.colDark = [cr, cg, cb].map((c) => Math.round(Math.min(255, (c / max) * 150 + c * 0.15)));
    });
    function regionCol(r: Region) {
      return lightMode ? r.colDark! : r.col;
    }
    function neuralBlendMode(): GlobalCompositeOperation {
      return lightMode ? 'multiply' : 'lighter';
    }

    const CONN_NAMES: [string, string][] = [
      ['visual', 'thalamus'],
      ['sensory', 'thalamus'],
      ['thalamus', 'association'],
      ['thalamus', 'amygdala'],
      ['amygdala', 'prefrontal'],
      ['amygdala', 'hippocampus'],
      ['sensory', 'association'],
      ['visual', 'association'],
      ['association', 'hippocampus'],
      ['association', 'prefrontal'],
      ['hippocampus', 'association'],
      ['hippocampus', 'temporal'],
      ['temporal', 'prefrontal'],
      ['prefrontal', 'motor'],
      ['prefrontal', 'thalamus'],
      ['motor', 'cerebellum'],
      ['cerebellum', 'motor'],
    ];
    const CONNECTIONS: [number, number][] = CONN_NAMES.map(([a, b]) => [RBY_NAME[a], RBY_NAME[b]]);

    type Act = { mean: number; peak: number; firing: number };
    const actTarget: Record<string, Act> = {};
    const actCurr: Record<string, Act> = {};
    RDEF.forEach((r) => {
      actTarget[r.name] = { mean: 0.045, peak: 0.05, firing: 0 };
      actCurr[r.name] = { mean: 0.045, peak: 0.05, firing: 0 };
    });
    let targetDa = 0,
      targetNe = 0,
      globalDa = 0,
      globalNe = 0;
    let globalFiring = 0;

    const regionPulse: Record<string, number> = {};
    RDEF.forEach((r) => {
      regionPulse[r.name] = 0;
    });

    const regionPos: Record<string, { x: number; y: number }> = {};
    RDEF.forEach((r) => {
      regionPos[r.name] = { x: 0, y: 0 };
    });
    let bubbleRadii: Record<string, number> = {};
    let physicsSeeded = false;

    function igniteRegion(ri: number, count: number) {
      const r = RDEF[ri];
      if (!r) return;
      regionPulse[r.name] = Math.min(1, (regionPulse[r.name] || 0) + 0.16 * count);
    }

    type Link = {
      si: number;
      di: number;
      scol: number[];
      dcol: number[];
      t: number;
      speed: number;
      life: number;
      arrived: boolean;
      seed: number;
      strength: number;
    };
    let links: Link[] = [];
    function spawnArc(si: number, di: number, strength: number) {
      const s = RDEF[si],
        d = RDEF[di];
      if (!s || !d) return;
      links.push({
        si,
        di,
        scol: s.col,
        dcol: d.col,
        t: 0,
        speed: 0.9 + strength * 1.3,
        life: 1,
        arrived: false,
        seed: Math.random() * 1000,
        strength,
      });
      if (links.length > 24) links.shift();
    }

    function applyNmap(data: any) {
      targetDa = data.da || 0;
      targetNe = data.ne || 0;
      for (const [name, vals] of Object.entries(data.regions || {})) {
        if (actTarget[name]) Object.assign(actTarget[name], vals as any);
      }
      RDEF.forEach((r, ri) => {
        const act = actTarget[r.name];
        if (act.firing < 0.01) return;
        igniteRegion(ri, Math.max(2, Math.floor(act.firing * 22)));
        CONNECTIONS.forEach(([si, di]) => {
          if (si === ri && act.firing > 0.05 && Math.random() < act.firing * 0.5) {
            spawnArc(si, di, act.peak);
          }
        });
      });
    }

    const regionLegendEl = document.getElementById('region-legend')!;
    function buildRegionLegend() {
      if (regionLegendEl.children.length) return;
      RDEF.forEach((r) => {
        const [cr, cg, cb] = r.col;
        const row = document.createElement('div');
        row.className = 'region-row';
        row.id = `legend-${r.name}`;
        row.innerHTML =
          `<span class="region-dot" style="background: rgb(${cr},${cg},${cb})"></span>` +
          `<span class="region-name">${r.name}</span>` +
          `<span class="region-val">0.00</span>`;
        regionLegendEl.appendChild(row);
      });
    }
    function updateRegionLegend() {
      RDEF.forEach((r) => {
        const row = document.getElementById(`legend-${r.name}`);
        if (!row) return;
        const act = actCurr[r.name];
        const dot = row.querySelector('.region-dot') as HTMLElement;
        const val = row.querySelector('.region-val') as HTMLElement;
        const brightness = Math.min(1, 0.28 + act.mean * 0.9 + act.firing * 0.55);
        dot.style.opacity = brightness.toFixed(2);
        dot.style.boxShadow =
          act.firing > 0.12
            ? `0 0 ${(4 + act.firing * 6).toFixed(1)}px rgba(${r.col.join(',')},${Math.min(1, act.firing).toFixed(2)})`
            : 'none';
        val.textContent = act.mean.toFixed(2);
      });
    }

    let outlinePath: Path2D | null = null,
      fissurePath: Path2D | null = null,
      sulciPaths: Path2D[] = [];
    let brainstemPath: Path2D | null = null;

    function buildBrainOutline() {
      const cx = CW * 0.5,
        cy = CH * 0.4;
      const baseRX = CW * 0.46,
        baseRY = CH * 0.42;
      outlinePath = new Path2D();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const wobble = 1 + 0.05 * Math.sin(3 * a + 1.3) + 0.035 * Math.sin(5 * a + 0.7) + 0.045 * Math.sin(7 * a + 2.1);
        const x = cx + Math.cos(a) * baseRX * wobble;
        const y = cy + Math.sin(a) * baseRY * wobble * 1.05;
        if (i === 0) outlinePath.moveTo(x, y);
        else outlinePath.lineTo(x, y);
      }
      outlinePath.closePath();

      fissurePath = new Path2D();
      const fx = cx,
        topY = cy - baseRY * 0.92,
        botY = cy + baseRY * 0.98;
      fissurePath.moveTo(fx, topY);
      const segs = 10;
      for (let i = 1; i <= segs; i++) {
        const t = i / segs;
        const y = topY + (botY - topY) * t;
        const x = fx + Math.sin(t * Math.PI * 3.2) * CW * 0.012;
        fissurePath.lineTo(x, y);
      }

      sulciPaths = [];
      for (let i = 0; i < 6; i++) {
        const p = new Path2D();
        const sx = cx + (Math.random() - 0.5) * baseRX * 1.3;
        const sy = cy - baseRY * 0.6 + (i / 6) * baseRY * 1.5;
        const len = baseRX * (0.28 + Math.random() * 0.24);
        const dir = Math.random() < 0.5 ? -1 : 1;
        p.moveTo(sx, sy);
        p.quadraticCurveTo(sx + dir * len * 0.5, sy + baseRY * 0.05, sx + dir * len, sy - baseRY * 0.03);
        sulciPaths.push(p);
      }

      const stem = RDEF[RBY_NAME.cerebellum];
      const stx = stem.rx * CW,
        sty = stem.ry * CH + stem.rr * Math.min(CW, CH) * 0.5;
      brainstemPath = new Path2D();
      brainstemPath.moveTo(stx - 5, sty);
      brainstemPath.quadraticCurveTo(stx - 4, CH * 0.9, stx, CH);
      brainstemPath.moveTo(stx + 5, sty);
      brainstemPath.quadraticCurveTo(stx + 4, CH * 0.9, stx, CH);
    }

    function resizeCanvas() {
      const rect = chatCol.getBoundingClientRect();
      CW = rect.width;
      CH = rect.height;
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      neuralCanvas.width = Math.max(1, Math.round(CW * DPR));
      neuralCanvas.height = Math.max(1, Math.round(CH * DPR));
      neuralCanvas.style.width = CW + 'px';
      neuralCanvas.style.height = CH + 'px';
      nCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildBrainOutline();
      buildRegionLegend();
      if (!physicsSeeded && CW && CH) {
        RDEF.forEach((r) => {
          regionPos[r.name].x = r.rx * CW;
          regionPos[r.name].y = r.ry * CH;
        });
        physicsSeeded = true;
      }
    }
    window.addEventListener('resize', resizeCanvas);

    function stepBubblePhysics(dt: number) {
      const radii: Record<string, number> = {};
      RDEF.forEach((r) => {
        const act = actCurr[r.name];
        const pulse = regionPulse[r.name] || 0;
        const baseR = r.rr * Math.min(CW, CH);
        const growth = 0.78 + act.mean * 0.95 + act.peak * 0.28 + pulse * 0.42;
        radii[r.name] = baseR * growth;
      });
      bubbleRadii = radii;

      const homeLerp = Math.min(1, dt * 1.0);
      RDEF.forEach((r) => {
        const p = regionPos[r.name];
        p.x += (r.rx * CW - p.x) * homeLerp;
        p.y += (r.ry * CH - p.y) * homeLerp;
      });

      const linkLerp = Math.min(0.9, dt * 0.5);
      CONNECTIONS.forEach(([si, di]) => {
        const a = RDEF[si],
          b = RDEF[di];
        const pa = regionPos[a.name],
          pb = regionPos[b.name];
        const activity = (actCurr[a.name].mean + actCurr[b.name].mean) / 2;
        const pull = linkLerp * (0.12 + activity * 0.55);
        const mx = (pa.x + pb.x) / 2,
          my = (pa.y + pb.y) / 2;
        pa.x += (mx - pa.x) * pull;
        pa.y += (my - pa.y) * pull;
        pb.x += (mx - pb.x) * pull;
        pb.y += (my - pb.y) * pull;
      });

      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < RDEF.length; i++) {
          for (let j = i + 1; j < RDEF.length; j++) {
            const A = RDEF[i],
              B = RDEF[j];
            const pa = regionPos[A.name],
              pb = regionPos[B.name];
            const dx = pb.x - pa.x,
              dy = pb.y - pa.y;
            const dist = Math.hypot(dx, dy) || 0.001;
            const minDist = (radii[A.name] + radii[B.name]) * 0.9;
            if (dist < minDist) {
              const overlap = (minDist - dist) / 2;
              const nx = dx / dist,
                ny = dy / dist;
              pa.x -= nx * overlap;
              pa.y -= ny * overlap;
              pb.x += nx * overlap;
              pb.y += ny * overlap;
            }
          }
        }
      }

      RDEF.forEach((r) => {
        const p = regionPos[r.name];
        const rad = radii[r.name];
        p.x = Math.min(CW - rad * 0.35, Math.max(rad * 0.35, p.x));
        p.y = Math.min(CH - rad * 0.35, Math.max(rad * 0.35, p.y));
      });
    }

    function perpWobble(sx: number, sy: number, dx: number, dy: number, seed: number, time: number, amp: number) {
      const mx = (sx + dx) / 2,
        my = (sy + dy) / 2;
      const ddx = dx - sx,
        ddy = dy - sy;
      const len = Math.hypot(ddx, ddy) || 1;
      const nx = -ddy / len,
        ny = ddx / len;
      const wob = Math.sin(time * 0.5 + seed) * amp + Math.sin(time * 1.15 + seed * 2.3) * amp * 0.4;
      return { mx: mx + nx * wob, my: my + ny * wob };
    }

    function angleDiff(a: number, b: number) {
      let d = a - b;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return d;
    }

    function fhash(x: number, y: number) {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
      return s - Math.floor(s);
    }
    function fnoise(x: number, y: number) {
      const xi = Math.floor(x),
        yi = Math.floor(y);
      const xf = x - xi,
        yf = y - yi;
      const u = xf * xf * (3 - 2 * xf),
        v = yf * yf * (3 - 2 * yf);
      const n00 = fhash(xi, yi),
        n10 = fhash(xi + 1, yi);
      const n01 = fhash(xi, yi + 1),
        n11 = fhash(xi + 1, yi + 1);
      return n00 * (1 - u) * (1 - v) + n10 * u * (1 - v) + n01 * (1 - u) * v + n11 * u * v;
    }
    function fflow(x: number, y: number) {
      let v = 0,
        a = 0.62,
        xx = x,
        yy = y;
      for (let i = 0; i < 3; i++) {
        v += a * (fnoise(xx, yy) - 0.5);
        xx = xx * 2.11 + 7.3;
        yy = yy * 2.11 - 4.1;
        a *= 0.52;
      }
      return v;
    }

    function buildBlobPath(
      cx: number,
      cy: number,
      radius: number,
      seed: number,
      time: number,
      bumps: { angle: number; strength: number }[]
    ) {
      const N = 64;
      const pts: [number, number][] = [];
      const t = time * 0.16;
      const sx = Math.cos(seed) * 3.1,
        sy = Math.sin(seed) * 3.1;

      for (let i = 0; i < N; i++) {
        const a = (i / N) * Math.PI * 2;
        const wx = Math.cos(a) * 1.7 + sx + t * 0.6;
        const wy = Math.sin(a) * 1.7 + sy - t * 0.4;
        const warp = fflow(wx + fflow(wy * 1.3, t) * 0.9, wy + fflow(wx * 1.3, t + 4.2) * 0.9);
        const settle = 1 + 0.1 * Math.sin(a - Math.PI / 2);

        let bump = 0;
        for (let j = 0; j < bumps.length; j++) {
          const b = bumps[j];
          const diff = angleDiff(a, b.angle);
          const infl = Math.max(0, 1 - Math.abs(diff) / 1.05);
          bump += infl * infl * infl * b.strength;
        }

        const r = radius * (0.86 + warp * 0.46) * settle * (1 + bump);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }

      const path = new Path2D();
      const first: [number, number] = [(pts[0][0] + pts[N - 1][0]) / 2, (pts[0][1] + pts[N - 1][1]) / 2];
      path.moveTo(first[0], first[1]);
      for (let i = 0; i < N; i++) {
        const p0 = pts[i],
          p1 = pts[(i + 1) % N];
        const mid: [number, number] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
        path.quadraticCurveTo(p0[0], p0[1], mid[0], mid[1]);
      }
      path.closePath();
      return path;
    }

    let lastFrame = 0,
      breathPhaseN = 0;
    let renderNeuralRaf = 0;
    function renderNeural(ts: number) {
      renderNeuralRaf = requestAnimationFrame(renderNeural);
      if (!CW || !CH) return;
      const dt = Math.min((ts - lastFrame) / 1000 || 0.016, 0.05);
      lastFrame = ts;
      breathPhaseN += dt;

      const k = 1 - Math.pow(0.015, dt);
      for (const r of RDEF) {
        const c = actCurr[r.name],
          t = actTarget[r.name];
        c.mean += (t.mean - c.mean) * k;
        c.peak += (t.peak - c.peak) * k;
        c.firing += (t.firing - c.firing) * k;
      }
      globalDa += (targetDa - globalDa) * k;
      globalNe += (targetNe - globalNe) * k;

      RDEF.forEach((r) => {
        regionPulse[r.name] *= Math.pow(0.02, dt);
        if (regionPulse[r.name] < 0.004) regionPulse[r.name] = 0;
      });

      for (let i = links.length - 1; i >= 0; i--) {
        const lk = links[i];
        if (!lk.arrived) {
          lk.t += lk.speed * dt;
          if (lk.t >= 1) {
            lk.t = 1;
            lk.arrived = true;
            const dName = RDEF[lk.di].name;
            regionPulse[dName] = Math.min(1, (regionPulse[dName] || 0) + 0.45);
          }
        } else {
          lk.life -= dt * 1.6;
          if (lk.life <= 0) {
            links.splice(i, 1);
            continue;
          }
        }
      }

      RDEF.forEach((r, ri) => {
        const baseline = 0.1 + actCurr[r.name].mean * 0.55;
        if (Math.random() < baseline * dt * 2.4) igniteRegion(ri, 1 + ((Math.random() * 2) | 0));
      });

      let firingSum = 0;
      RDEF.forEach((r) => {
        firingSum += actCurr[r.name].firing;
      });
      const rawFiring = firingSum / RDEF.length;
      globalFiring += (rawFiring - globalFiring) * Math.min(1, dt * 6);
      document.documentElement.style.setProperty('--pulse', Math.min(1, globalFiring * 2.2).toFixed(3));

      updateRegionLegend();
      stepBubblePhysics(dt);

      nCtx.clearRect(0, 0, CW, CH);

      const moodCol = hexToRgb(getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

      nCtx.save();
      nCtx.globalAlpha = 0.5;
      nCtx.fillStyle = lightMode ? 'rgba(90,80,130,0.6)' : 'rgba(180,170,210,0.5)';
      for (let i = 0; i < 26; i++) {
        const sx = (i * 137.5) % CW;
        const sy = (i * 71.3 + Math.sin(breathPhaseN * 0.2 + i) * 8) % CH;
        nCtx.globalAlpha = 0.05 + 0.05 * Math.abs(Math.sin(breathPhaseN * 0.5 + i));
        nCtx.beginPath();
        nCtx.arc(sx, sy, 0.9, 0, Math.PI * 2);
        nCtx.fill();
      }
      nCtx.restore();

      if (outlinePath) {
        const outlineCol = lightMode ? moodCol.map((c) => Math.round(c * 0.55)) : moodCol;
        const outlineBase = lightMode ? 0.38 : 0.14;
        const fissureBase = lightMode ? 0.28 : 0.1;
        nCtx.save();
        nCtx.strokeStyle = `rgba(${outlineCol.join(',')},${(outlineBase + globalNe * 0.22).toFixed(3)})`;
        nCtx.lineWidth = lightMode ? 1.4 : 1.1;
        nCtx.stroke(outlinePath);
        nCtx.strokeStyle = `rgba(${outlineCol.join(',')},${fissureBase.toFixed(3)})`;
        nCtx.lineWidth = lightMode ? 1.0 : 0.8;
        if (fissurePath) nCtx.stroke(fissurePath);
        sulciPaths.forEach((p) => nCtx.stroke(p));
        if (brainstemPath) nCtx.stroke(brainstemPath);
        nCtx.restore();
      }

      nCtx.save();
      nCtx.globalCompositeOperation = neuralBlendMode();
      CONNECTIONS.forEach(([si, di], ci) => {
        const s = RDEF[si],
          d = RDEF[di];
        const ps = regionPos[s.name],
          pd = regionPos[d.name];
        const sx = ps.x,
          sy = ps.y,
          dx = pd.x,
          dy = pd.y;
        const seed = si * 13.7 + di * 4.3 + ci;
        const { mx, my } = perpWobble(sx, sy, dx, dy, seed, breathPhaseN, 14);
        const actAvg = (actCurr[s.name].mean + actCurr[d.name].mean) / 2;
        const alpha = (lightMode ? 0.1 : 0.06) + actAvg * (lightMode ? 0.4 : 0.22);
        const [cr, cg, cb] = regionCol(s);
        nCtx.strokeStyle = `rgba(${cr},${cg},${cb},${alpha.toFixed(3)})`;
        nCtx.lineWidth = 0.8;
        nCtx.beginPath();
        nCtx.moveTo(sx, sy);
        nCtx.quadraticCurveTo(mx, my, dx, dy);
        nCtx.stroke();
      });
      nCtx.restore();

      nCtx.save();
      nCtx.globalCompositeOperation = neuralBlendMode();
      RDEF.forEach((r, ri) => {
        const act = actCurr[r.name];
        const pulse = regionPulse[r.name] || 0;
        const pos = regionPos[r.name];
        const cx = pos.x,
          cy = pos.y;
        const breathe = 1 + 0.035 * Math.sin(breathPhaseN * 0.35 + ri * 1.7);
        const radius = (bubbleRadii[r.name] || r.rr * Math.min(CW, CH)) * breathe;
        const [cr, cg, cb] = regionCol(r);

        const bumps: { angle: number; strength: number }[] = [];
        links.forEach((lk) => {
          if (lk.life <= 0.02) return;
          let other: Region | null = null,
            strength = 0;
          if (lk.si === ri) {
            other = RDEF[lk.di];
            strength = (lk.arrived ? lk.life : lk.t) * 0.6;
          } else if (lk.di === ri) {
            other = RDEF[lk.si];
            strength = (lk.arrived ? lk.life : lk.t) * 0.6;
          }
          if (other) {
            const op = regionPos[other.name];
            const angle = Math.atan2(op.y - cy, op.x - cx);
            bumps.push({ angle, strength: strength * lk.strength });
          }
        });

        const auraR = radius * 1.55;
        const auraAlpha = (lightMode ? 0.09 : 0.045) + act.mean * (lightMode ? 0.4 : 0.25) + pulse * 0.2;
        const aura = nCtx.createRadialGradient(cx, cy, 0, cx, cy, auraR);
        aura.addColorStop(0, `rgba(${cr},${cg},${cb},${auraAlpha.toFixed(3)})`);
        aura.addColorStop(1, `rgba(${cr},${cg},${cb},0)`);
        nCtx.fillStyle = aura;
        nCtx.beginPath();
        nCtx.arc(cx, cy, auraR, 0, Math.PI * 2);
        nCtx.fill();

        const blobPath = buildBlobPath(cx, cy, radius, ri * 12.9898, breathPhaseN, bumps);

        const core = nCtx.createRadialGradient(cx - radius * 0.18, cy - radius * 0.22, radius * 0.05, cx, cy, radius * 1.05);
        const coreAlpha = (lightMode ? 0.24 : 0.16) + act.mean * (lightMode ? 0.5 : 0.36) + pulse * 0.26;
        core.addColorStop(0, `rgba(${cr},${cg},${cb},${Math.min(1, coreAlpha * 0.85).toFixed(3)})`);
        core.addColorStop(0.55, `rgba(${cr},${cg},${cb},${coreAlpha.toFixed(3)})`);
        core.addColorStop(1, `rgba(${cr},${cg},${cb},${Math.min(1, coreAlpha * 1.25).toFixed(3)})`);
        nCtx.fillStyle = core;
        nCtx.fill(blobPath);

        nCtx.save();
        nCtx.clip(blobPath);
        nCtx.strokeStyle = `rgba(${cr},${cg},${cb},${Math.min(1, 0.35 + act.mean * 0.5 + pulse * 0.5).toFixed(3)})`;
        nCtx.lineWidth = Math.max(1.2, radius * 0.09);
        nCtx.stroke(blobPath);
        nCtx.restore();
      });
      nCtx.restore();

      nCtx.save();
      nCtx.globalCompositeOperation = neuralBlendMode();
      links.forEach((lk) => {
        const ps = regionPos[RDEF[lk.si].name],
          pd = regionPos[RDEF[lk.di].name];
        const sx = ps.x,
          sy = ps.y,
          dx = pd.x,
          dy = pd.y;
        const { mx, my } = perpWobble(sx, sy, dx, dy, lk.seed, breathPhaseN * 1.6, 22);
        const head = lk.arrived ? 1 : lk.t;
        const alpha = (lk.arrived ? lk.life : Math.min(1, lk.t * 1.4)) * (0.55 + lk.strength * 0.4);
        let cr = (lk.scol[0] + (lk.dcol[0] - lk.scol[0]) * head) | 0;
        let cg = (lk.scol[1] + (lk.dcol[1] - lk.scol[1]) * head) | 0;
        let cb = (lk.scol[2] + (lk.dcol[2] - lk.scol[2]) * head) | 0;
        if (lightMode) {
          const mx2 = Math.max(cr, cg, cb) || 1;
          cr = Math.round(Math.min(255, (cr / mx2) * 150 + cr * 0.15));
          cg = Math.round(Math.min(255, (cg / mx2) * 150 + cg * 0.15));
          cb = Math.round(Math.min(255, (cb / mx2) * 150 + cb * 0.15));
        }
        const steps = 16;
        nCtx.beginPath();
        for (let s = 0; s <= steps; s++) {
          const u = (s / steps) * head,
            iu = 1 - u;
          const bx = iu * iu * sx + 2 * iu * u * mx + u * u * dx;
          const by = iu * iu * sy + 2 * iu * u * my + u * u * dy;
          s === 0 ? nCtx.moveTo(bx, by) : nCtx.lineTo(bx, by);
        }
        nCtx.strokeStyle = `rgba(${cr},${cg},${cb},${Math.min(1, alpha).toFixed(2)})`;
        nCtx.lineWidth = 2 + lk.strength * 1.5;
        nCtx.lineCap = 'round';
        nCtx.stroke();

        if (!lk.arrived) {
          const u = head,
            iu = 1 - u;
          const hx = iu * iu * sx + 2 * iu * u * mx + u * u * dx;
          const hy = iu * iu * sy + 2 * iu * u * my + u * u * dy;
          nCtx.fillStyle = `rgba(${cr},${cg},${cb},${Math.min(1, alpha * 1.5).toFixed(2)})`;
          nCtx.beginPath();
          nCtx.arc(hx, hy, 3, 0, Math.PI * 2);
          nCtx.fill();
        }
      });
      nCtx.restore();
    }

    function hexToRgb(hex: string) {
      hex = (hex || '#8fb8e0').replace('#', '').trim();
      if (hex.length === 3)
        hex = hex
          .split('')
          .map((c) => c + c)
          .join('');
      const n = parseInt(hex, 16);
      if (isNaN(n)) return [143, 184, 224];
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    // -----------------------------------------------------------------------
    // Chat / typing / thoughts
    // -----------------------------------------------------------------------
    const typingEl = (() => {
      const el = document.createElement('div');
      el.id = 'typing';
      el.innerHTML = '<div id="typing-inner"><div id="typing-ring"></div><span id="typing-text">Thinking</span></div>';
      return el;
    })();

    const TAG_RE = /^\[([a-zA-Z_]+)\]/;
    function addThought(text: string) {
      const m = text.match(TAG_RE);
      const tag = m ? m[1].toLowerCase() : 'plain';
      const body = m ? text.slice(m[0].length).trim() : text;
      const d = document.createElement('div');
      d.className = `thought t-${tag}`;
      d.innerHTML = `<span class="ttag">[${tag}]</span>${body}`;
      monologue.appendChild(d);
      if (monologue.children.length > 150) monologue.firstChild!.remove();
      panel.scrollTop = panel.scrollHeight;
    }

    let _thinking = false;
    function setThinking(on: boolean) {
      if (_thinking === on) return;
      _thinking = on;
      $('thinking-dot')!.classList.toggle('active', on);
      ($('thinking-label') as HTMLElement).style.opacity = on ? '1' : '0';
    }

    function addMsg(text: string, cls: string) {
      const d = document.createElement('div');
      d.className = 'msg ' + cls;
      d.textContent = text;
      if (cls === 'brain') d.style.setProperty('--msg-accent', currentMoodColor());
      log.appendChild(d);
      log.scrollTop = log.scrollHeight;
    }

    const THINK_PHRASES = ['Thinking', 'Synthesizing', 'Modeling', 'Reflecting', 'Weighing signals', 'Composing'];
    let thinkTick = 0,
      thinkInterval: ReturnType<typeof setInterval>;
    function showTyping() {
      if (!typingEl.parentNode) log.appendChild(typingEl);
      typingEl.classList.add('show');
      thinkTick = 0;
      clearInterval(thinkInterval);
      thinkInterval = setInterval(() => {
        thinkTick++;
        const phrase = THINK_PHRASES[Math.floor(thinkTick / 4) % THINK_PHRASES.length];
        typingEl.querySelector('#typing-text')!.textContent = phrase + '.'.repeat(thinkTick % 4);
      }, 380);
      log.scrollTop = log.scrollHeight;
    }
    function hideTyping() {
      typingEl.classList.remove('show');
      if (typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
      clearInterval(thinkInterval);
    }

    function spawnSparkles(originEl: HTMLElement) {
      const rect = originEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const colors = ['#ff6b6b', '#ffd166', '#6ee7b7', '#7ee8c1', '#8fb8e0', '#c9a6ff'];
      const count = 10;
      for (let i = 0; i < count; i++) {
        const s = document.createElement('div');
        s.className = 'sparkle';
        const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35;
        const dist = 24 + Math.random() * 22;
        s.style.setProperty('--dx', (Math.cos(angle) * dist).toFixed(1) + 'px');
        s.style.setProperty('--dy', (Math.sin(angle) * dist).toFixed(1) + 'px');
        s.style.color = colors[i % colors.length];
        s.style.background = colors[i % colors.length];
        s.style.left = cx + 'px';
        s.style.top = cy + 'px';
        document.body.appendChild(s);
        s.addEventListener('animationend', () => s.remove());
      }
    }

    function send() {
      const text = input.value.trim();
      if (!text || !ws || ws.readyState !== 1) return;
      addMsg(text, 'you');
      ws.send(JSON.stringify({ text }));
      input.value = '';
      input.style.height = '48px';
      showTyping();

      spawnSparkles(sendBtn as HTMLElement);
      sendBtn.classList.add('sending');
      setTimeout(() => sendBtn.classList.remove('sending'), 500);

      RDEF.forEach((r, ri) => {
        if (Math.random() < 0.6) igniteRegion(ri, 2 + ((Math.random() * 3) | 0));
      });
    }
    sendRef.current = send;

    function onInputKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    }
    function onInputInput() {
      input.style.height = '48px';
      input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    }
    input.addEventListener('keydown', onInputKeydown);
    input.addEventListener('input', onInputInput);

    const $ = (id: string) => document.getElementById(id);
    const lerped = { valence: 0, arousal: 0, drive: 0, ne: 0 };
    function lerp(a: number, b: number, t: number) {
      return a + (b - a) * t;
    }
    function applyState(mood?: string, neural?: Record<string, number>) {
      if (mood) currentMood = mood;
      if (neural) currentNeural = neural;
    }

    let animationLoopRaf = 0;
    function animationLoop() {
      const { valence, arousal, drive, norepinephrine: ne = 0 } = currentNeural;
      lerped.valence = lerp(lerped.valence, valence, 0.04);
      lerped.arousal = lerp(lerped.arousal, arousal, 0.04);
      lerped.drive = lerp(lerped.drive, drive, 0.04);
      lerped.ne = lerp(lerped.ne, ne, 0.06);

      updateBars();
      updateFace();
      updateGlow();
      updateConstellation();
      animationLoopRaf = requestAnimationFrame(animationLoop);
    }

    function updateBars() {
      const v = lerped.valence,
        a = lerped.arousal,
        d = lerped.drive,
        n = lerped.ne;
      ($('bar-valence') as HTMLElement).style.width = (((v + 1) / 2) * 100).toFixed(1) + '%';
      $('val-valence')!.textContent = v.toFixed(2);
      ($('bar-arousal') as HTMLElement).style.width = (Math.max(0, a) * 100).toFixed(1) + '%';
      $('val-arousal')!.textContent = a.toFixed(2);
      ($('bar-drive') as HTMLElement).style.width = (Math.max(0, d) * 100).toFixed(1) + '%';
      $('val-drive')!.textContent = d.toFixed(2);
      ($('bar-ne') as HTMLElement).style.width = (Math.max(0, n) * 100).toFixed(1) + '%';
      $('val-ne')!.textContent = n.toFixed(2);
    }

    function updateFace() {
      const v = lerped.valence,
        a = lerped.arousal,
        d = lerped.drive,
        n = lerped.ne;

      const moodY = 130 + v * -14 - 3;
      $('mouth')!.setAttribute('d', `M 82 130 Q 100 ${moodY.toFixed(1)} 118 130`);

      const excitement = a * Math.max(0, v);
      $('mouth')!.setAttribute('opacity', (0.8 - excitement * 0.55).toFixed(2));
      $('mouth-open')!.setAttribute('opacity', (excitement * 0.95).toFixed(2));
      $('mouth-open')!.setAttribute('ry', (4.5 + excitement * 5).toFixed(1));
      $('mouth-open')!.setAttribute('rx', (8 + excitement * 5).toFixed(1));

      const distress = a * Math.max(0, -v);
      const twitch = distress > 0.05 ? Math.sin(Date.now() / 220) * distress * 3 : 0;

      const browLift = a * -8;
      const furrow = v < 0 ? v * -6 : 0;
      const browLY = 66 + browLift + twitch;
      const browRY = 66 + browLift - twitch;
      const browLMidY = 58 + browLift - furrow;
      const browRMidY = 58 + browLift - furrow;

      $('brow-l')!.setAttribute('d', `M 55 ${browLY.toFixed(1)} Q 72 ${browLMidY.toFixed(1)} 89 ${browLY.toFixed(1)}`);
      $('brow-r')!.setAttribute('d', `M 111 ${browRY.toFixed(1)} Q 128 ${browRMidY.toFixed(1)} 145 ${browRY.toFixed(1)}`);

      const pupilR = 6.5 + a * 4;
      $('pupil-l')!.setAttribute('r', pupilR.toFixed(1));
      $('pupil-r')!.setAttribute('r', pupilR.toFixed(1));

      const eyeRY = excitement > 0.15 ? 16.5 + excitement * 3 : 16.5 - Math.max(0, v) * 3;
      $('eye-l')!.setAttribute('ry', eyeRY.toFixed(1));
      $('eye-r')!.setAttribute('ry', eyeRY.toFixed(1));

      const blushOp = 0.22 + Math.max(0, v) * 0.45;
      $('blush-l')!.setAttribute('opacity', blushOp.toFixed(3));
      $('blush-r')!.setAttribute('opacity', blushOp.toFixed(3));

      const irisOp = 0.15 + d * 0.5;
      $('iris-l-outer')!.setAttribute('opacity', irisOp.toFixed(3));
      $('iris-r-outer')!.setAttribute('opacity', irisOp.toFixed(3));

      $('scan')!.setAttribute('opacity', (n * 0.6).toFixed(3));

      const col = currentMoodColor();
      $('mood-label')!.textContent = currentMood.charAt(0).toUpperCase() + currentMood.slice(1);
      ($('mood-label') as HTMLElement).style.color = col;
      document.documentElement.style.setProperty('--accent', col);

      $('pupil-l')!.setAttribute('fill', col);
      $('pupil-r')!.setAttribute('fill', col);
      $('iris-l-outer')!.setAttribute('stroke', col);
      $('iris-r-outer')!.setAttribute('stroke', col);
      $('brow-l')!.setAttribute('stroke', col);
      $('brow-r')!.setAttribute('stroke', col);
      $('mouth')!.setAttribute('stroke', col);
      $('mouth-open')!.setAttribute('stroke', col);
      $('scan')!.setAttribute('stroke', col);
    }

    function updateGlow() {
      const col = currentMoodColor();
      const intensity = 0.08 + lerped.arousal * 0.18 + globalFiring * 0.22;
      ($('glow') as HTMLElement).style.background = `radial-gradient(circle, ${col}${Math.round(Math.min(1, intensity) * 255)
        .toString(16)
        .padStart(2, '0')} 0%, transparent 70%)`;
      ($('rainbow-ring') as HTMLElement).style.opacity = Math.min(1, 0.22 + lerped.arousal * 0.55 + globalFiring * 0.35).toFixed(2);
    }

    function updateConstellation() {
      const col = currentMoodColor();
      const a = lerped.arousal;
      document.querySelectorAll('#constellation circle').forEach((c, i) => {
        c.setAttribute('fill', col);
        const flicker = 0.4 + 0.6 * Math.abs(Math.sin(Date.now() / (900 + i * 130)));
        c.setAttribute('opacity', (0.3 + a * 0.5 * flicker).toFixed(2));
      });
      document.querySelectorAll('#constellation line').forEach((l) => {
        l.setAttribute('stroke', col);
        l.setAttribute('opacity', (0.12 + a * 0.28).toFixed(2));
      });
    }

    function blink() {
      if (!mounted) return;
      const el = $('eye-l')!,
        er = $('eye-r')!;
      const origRY = parseFloat(el.getAttribute('ry') || '14') || 14;
      el.setAttribute('ry', '1');
      er.setAttribute('ry', '1');
      setTimeout(() => {
        el.setAttribute('ry', String(origRY));
        er.setAttribute('ry', String(origRY));
      }, 120);
      const interval = 2500 + Math.random() * 3000 - lerped.arousal * 1500;
      blinkTimer = setTimeout(blink, Math.max(800, interval));
    }

    function saccade() {
      if (!mounted) return;
      const jitterX = (Math.random() - 0.5) * 6;
      const jitterY = (Math.random() - 0.5) * 4;
      ($('pupil-l') as unknown as SVGElement).style.transform = `translate(${jitterX}px, ${jitterY}px)`;
      ($('pupil-r') as unknown as SVGElement).style.transform = `translate(${jitterX}px, ${jitterY}px)`;
      setTimeout(() => {
        ($('pupil-l') as unknown as SVGElement).style.transform = '';
        ($('pupil-r') as unknown as SVGElement).style.transform = '';
      }, 220);
      const next = 1600 + Math.random() * 2600 - lerped.arousal * 800;
      setTimeout(saccade, Math.max(700, next));
    }

    let breathPhase = 0;
    function breathe() {
      breathPhase += 0.03;
      const bob = Math.sin(breathPhase) * (1 + lerped.arousal * 2);
      ($('avatar') as unknown as SVGElement).style.transform = `translateY(${bob.toFixed(2)}px)`;
      breathTimer = requestAnimationFrame(breathe);
    }

    // ---- boot ----
    resizeCanvas();
    connect();
    animationLoopRaf = requestAnimationFrame(animationLoop);
    renderNeuralRaf = requestAnimationFrame(renderNeural);
    const blinkStart = setTimeout(blink, 1500);
    const saccadeStart = setTimeout(saccade, 2000);
    breathe();

    return () => {
      mounted = false;
      window.removeEventListener('resize', resizeCanvas);
      input.removeEventListener('keydown', onInputKeydown);
      input.removeEventListener('input', onInputInput);
      clearInterval(thinkInterval);
      clearTimeout(blinkStart);
      clearTimeout(saccadeStart);
      if (blinkTimer) clearTimeout(blinkTimer);
      if (breathTimer) cancelAnimationFrame(breathTimer);
      cancelAnimationFrame(animationLoopRaf);
      cancelAnimationFrame(renderNeuralRaf);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div id="panel">
        <div id="avatar-wrap" aria-label="Live pet state avatar">
          <div id="rainbow-ring"></div>
          <div id="glow"></div>
          <svg id="constellation" viewBox="0 0 224 224" xmlns="http://www.w3.org/2000/svg">
            <line x1="20" y1="40" x2="55" y2="15" stroke="#8fb8e0" strokeWidth="1" />
            <line x1="204" y1="35" x2="170" y2="12" stroke="#8fb8e0" strokeWidth="1" />
            <line x1="10" y1="130" x2="30" y2="170" stroke="#8fb8e0" strokeWidth="1" />
            <line x1="214" y1="125" x2="196" y2="168" stroke="#8fb8e0" strokeWidth="1" />
            <line x1="70" y1="8" x2="112" y2="2" stroke="#8fb8e0" strokeWidth="1" />
            <line x1="112" y1="2" x2="154" y2="8" stroke="#8fb8e0" strokeWidth="1" />
            <circle cx="20" cy="40" r="2" fill="#8fb8e0" />
            <circle cx="55" cy="15" r="1.6" fill="#8fb8e0" />
            <circle cx="204" cy="35" r="2" fill="#8fb8e0" />
            <circle cx="170" cy="12" r="1.6" fill="#8fb8e0" />
            <circle cx="10" cy="130" r="1.6" fill="#8fb8e0" />
            <circle cx="30" cy="170" r="2" fill="#8fb8e0" />
            <circle cx="214" cy="125" r="1.6" fill="#8fb8e0" />
            <circle cx="196" cy="168" r="2" fill="#8fb8e0" />
            <circle cx="70" cy="8" r="1.6" fill="#8fb8e0" />
            <circle cx="112" cy="2" r="2" fill="#8fb8e0" />
            <circle cx="154" cy="8" r="1.6" fill="#8fb8e0" />
          </svg>

          <svg id="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <radialGradient id="faceGrad" cx="45%" cy="40%" r="60%">
                <stop id="face-stop-1" offset="0%" stopColor="#201830" />
                <stop id="face-stop-2" offset="100%" stopColor="#0c0714" />
              </radialGradient>
              <filter id="glow-filter" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="3" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            <circle id="head" cx="100" cy="100" r="78" fill="url(#faceGrad)" stroke="#2c2244" strokeWidth="2" />

            <circle id="iris-l-outer" cx="72" cy="92" r="19" fill="none" stroke="#8fb8e0" strokeWidth="1.2" opacity={0.3} />
            <circle id="iris-r-outer" cx="128" cy="92" r="19" fill="none" stroke="#8fb8e0" strokeWidth="1.2" opacity={0.3} />

            <ellipse id="eye-l" cx="72" cy="92" rx="16.5" ry="16.5" fill="#160f22" />
            <ellipse id="eye-r" cx="128" cy="92" rx="16.5" ry="16.5" fill="#160f22" />

            <circle id="pupil-l" cx="72" cy="92" r="8.5" fill="#8fb8e0" filter="url(#glow-filter)" />
            <circle id="pupil-r" cx="128" cy="92" r="8.5" fill="#8fb8e0" filter="url(#glow-filter)" />

            <circle cx="76" cy="87" r="3.2" fill="white" opacity={0.75} />
            <circle cx="132" cy="87" r="3.2" fill="white" opacity={0.75} />
            <circle cx="68" cy="97" r="1.4" fill="white" opacity={0.55} />
            <circle cx="124" cy="97" r="1.4" fill="white" opacity={0.55} />

            <path id="brow-l" d="M 55 66 Q 72 58 89 66" stroke="#8fb8e0" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity={0.75} />
            <path id="brow-r" d="M 111 66 Q 128 58 145 66" stroke="#8fb8e0" strokeWidth="3.4" fill="none" strokeLinecap="round" opacity={0.75} />

            <path id="mouth" d="M 82 130 Q 100 141 118 130" stroke="#8fb8e0" strokeWidth="3.2" fill="none" strokeLinecap="round" opacity={0.85} />
            <ellipse id="mouth-open" cx="100" cy="132" rx="9" ry="5" fill="#0b0710" stroke="#8fb8e0" strokeWidth="2" opacity={0} />

            <ellipse id="blush-l" cx="56" cy="114" rx="13" ry="7.5" fill="#f2a6c9" opacity={0.22} />
            <ellipse id="blush-r" cx="144" cy="114" rx="13" ry="7.5" fill="#f2a6c9" opacity={0.22} />

            <line id="scan" x1="22" y1="100" x2="178" y2="100" stroke="#8fb8e0" strokeWidth="1" opacity={0} strokeDasharray="4 6" />
          </svg>

          <div id="sparkle-field">
            <span className="twinkle" style={{ top: '4%', left: '80%' }}>
              &#10022;
            </span>
            <span className="twinkle" style={{ top: '86%', left: '8%' }}>
              &#10022;
            </span>
            <span className="twinkle" style={{ top: '80%', left: '88%' }}>
              &#10023;
            </span>
            <span className="twinkle" style={{ top: '0%', left: '12%' }}>
              &#10023;
            </span>
            <span className="twinkle" style={{ top: '46%', left: '-4%' }}>
              &#10084;
            </span>
          </div>
        </div>

        <div id="mood-label">Initialising</div>

        <div className="eyebrow">signal</div>

        <div id="neural">
          <div className="bar-row">
            <span className="bar-label">Valence</span>
            <div className="bar-track">
              <div className="bar-fill" id="bar-valence" style={{ width: '50%', background: '#c9a6ff' }}></div>
            </div>
            <span className="bar-val" id="val-valence">
              0.00
            </span>
          </div>
          <div className="bar-row">
            <span className="bar-label">Arousal</span>
            <div className="bar-track">
              <div className="bar-fill" id="bar-arousal" style={{ width: '0%', background: '#7ee8c1' }}></div>
            </div>
            <span className="bar-val" id="val-arousal">
              0.00
            </span>
          </div>
          <div className="bar-row">
            <span className="bar-label">Drive</span>
            <div className="bar-track">
              <div className="bar-fill" id="bar-drive" style={{ width: '0%', background: '#ffb86b' }}></div>
            </div>
            <span className="bar-val" id="val-drive">
              0.00
            </span>
          </div>
          <div className="bar-row">
            <span className="bar-label">Alertness</span>
            <div className="bar-track">
              <div className="bar-fill" id="bar-ne" style={{ width: '0%', background: '#ff8a65' }}></div>
            </div>
            <span className="bar-val" id="val-ne">
              0.00
            </span>
          </div>
        </div>

        <div className="eyebrow" style={{ marginTop: '2px' }}>
          regions
        </div>
        <div id="region-legend"></div>

        <div className="eyebrow" style={{ marginTop: '2px' }}>
          inner monologue
        </div>
        <div id="monologue-wrap">
          <div id="monologue"></div>
        </div>

        <div id="status-row">
          <div id="conn"></div>
          <span id="status-text">Connecting…</span>
          <div id="thinking-dot" style={{ marginLeft: 'auto' }}></div>
          <span id="thinking-label">processing</span>
        </div>
      </div>

      <div id="chat-col">
        <canvas id="neural-canvas"></canvas>
        <div id="neural-scrim"></div>
        <div id="neural-watermark">neural substrate — live</div>

        <header>
          <div id="header-left">
            <div id="pulse-dot"></div>
            Talos
          </div>
          <button id="theme-toggle" type="button" aria-label="Toggle light and dark mode" onClick={() => toggleThemeRef.current()}>
            <svg id="icon-moon" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
            </svg>
            <svg id="icon-sun" viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"></circle>
              <line x1="12" y1="1" x2="12" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="23"></line>
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
              <line x1="1" y1="12" x2="3" y2="12"></line>
              <line x1="21" y1="12" x2="23" y2="12"></line>
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
            </svg>
          </button>
        </header>

        <div id="log">
          <div className="msg system">Connecting to neural substrate…</div>
        </div>

        <footer>
          <div className="input-wrap">
            <textarea id="input" placeholder="Say something…" rows={1}></textarea>
          </div>
          <button id="send-btn" onClick={() => sendRef.current()} aria-label="Send message">
            <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
          </button>
        </footer>
      </div>

      <div id="world-col" style={{ borderLeft: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        <TalosWorldPage/>
      </div>
    </>
  );
}