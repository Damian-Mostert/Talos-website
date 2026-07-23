import { NeuralEngine } from './engine.js';

// ── Brain size setting ────────────────────────────────────────────────────────
// Adjust this to control total RAM used by the brain snapshot.
// 1.82 GB = baseline (2.42M neurons). Scale is linear.
// With 16GB RAM + Ollama 3.2 (~2GB): 4–6 GB is comfortable.

const BRAIN_SIZE_GB = Number(process.env.NEXT_PUBLIC_BRAIN_SIZE ?? 0.1);  // 1.82 GB = baseline (2.42M neurons). Scale is linear.
const SCALE = BRAIN_SIZE_GB / 1.82;

function s(n) { return Math.round(n * SCALE / 1000) * 1000; } // scale + round to nearest 1k

const REGIONS = {
    // ── Input & relay ──────────────────────────────────────────────────────
    thalamus:       { size: s( 80_000), inhibRatio: 0.10, threshold: 0.15 },
    // ── Limbic & drives ───────────────────────────────────────────────────
    hypothalamus:   { size: s( 50_000), inhibRatio: 0.05, threshold: 0.10 }, // hunger/thirst/drives
    amygdala:       { size: s( 40_000), inhibRatio: 0.05, threshold: 0.12 }, // salience/threat
    // ── Sensory cortices ──────────────────────────────────────────────────
    sensory:        { size: s(400_000), inhibRatio: 0.20, threshold: 0.25 },
    visual:         { size: s(100_000), inhibRatio: 0.15, threshold: 0.20 },
    // ── Memory ────────────────────────────────────────────────────────────
    hippocampus:    { size: s(160_000), inhibRatio: 0.15, threshold: 0.20 },
    temporal:       { size: s(200_000), inhibRatio: 0.10, threshold: 0.25 },
    // ── Association & executive ───────────────────────────────────────────
    association:    { size: s(600_000), inhibRatio: 0.20, threshold: 0.30 },
    prefrontal:     { size: s(300_000), inhibRatio: 0.10, threshold: 0.20 },
    acc:            { size: s(120_000), inhibRatio: 0.18, threshold: 0.26 }, // conflict/error/effort
    // ── Action selection ──────────────────────────────────────────────────
    basalGanglia:   { size: s(180_000), inhibRatio: 0.35, threshold: 0.32 }, // winner-take-all gating
    // ── Action ────────────────────────────────────────────────────────────
    motor:          { size: s(240_000), inhibRatio: 0.20, threshold: 0.35 },
    cerebellum:     { size: s(300_000), inhibRatio: 0.30, threshold: 0.30 },
    // ── Global neuromodulators ────────────────────────────────────────────
    vta:            { size: s( 20_000), inhibRatio: 0.05, threshold: 0.08 }, // dopamine source
    locusCoeruleus: { size: s( 15_000), inhibRatio: 0.05, threshold: 0.08 }, // norepinephrine source
    raphe:          { size: s( 15_000), inhibRatio: 0.05, threshold: 0.08 }, // serotonin → patience
};

export class Brain {
    constructor() {
        this.layout = {};
        let offset = 0;
        for (const [name, cfg] of Object.entries(REGIONS)) {
            this.layout[name] = { start: offset, end: offset + cfg.size, ...cfg };
            offset += cfg.size;
        }
        this.totalNeurons = offset;

        console.log(`Allocating ${(this.totalNeurons / 1e6).toFixed(2)}M neurons (BRAIN_SIZE_GB=${BRAIN_SIZE_GB})...`);
        this.engine = new NeuralEngine(this.totalNeurons, 200);
        console.log('Allocated.');

        this._applyRegionProperties();
        this._wire();
        this._alive = false;

        this._baseline    = new Float32Array(this.layout.association.size);
        this._baselineAlpha = 0.005;

        // Rolling per-neuron baseline for reafference() — mirrors the
        // approach _baseline/_baselineAlpha already use for novelty() above.
        // reafference() used to read raw |potential| directly, with no
        // baseline correction. Because association potentials stay
        // chronically elevated from continuous cross-region pulsing (visual/
        // sensory/thalamus/hippocampus/prefrontal all feed it every tick, and
        // nothing here decays it back toward zero), the raw magnitude of the
        // top-N neurons was reliably large enough that
        // tanh((sum/filled) * 5) clipped to 1.000 at 3 decimal places on
        // almost every call — regardless of whether anything about *this*
        // tick's reafference was actually novel. Tracking a slower-moving
        // baseline per neuron and reading the deviation from it (same trick
        // as novelty(), just scoped to reafference's own array so the two
        // don't fight over the same state) lets strength actually vary
        // instead of pinning at ceiling.
        this._reafBaseline = new Float32Array(this.layout.association.size);
        this._reafBaselineAlpha = 0.02;

        // Emotional state — updated by emotionalState() each cycle
        this._valence  = 0;   // -1 (negative) to +1 (positive)
        this._arousal  = 0;   // 0 (calm) to 1 (activated)
        this._drive    = 0;   // 0 (passive) to 1 (motivated)

        // Survival needs: hunger, energy, and joy are first-class drives.
        this.needs = { hunger: 0.5, energy: 0.5, joy: 0.5 };

        // Body state — the animal is embodied in a world with a position.
        this.body = { x: 0.5, y: 0.48, heading: 0, speed: 0.0, energy: 0.5 };
        this.motorState = { moveX: 0, moveY: 0, lastAction: null };
    }

    _applyRegionProperties() {
        for (const [, r] of Object.entries(this.layout)) {
            this.engine.setThreshold(r.start, r.end, r.threshold);
            const inhibEnd = r.start + Math.floor(r.size * r.inhibRatio);
            this.engine.setInhibitory(r.start, inhibEnd);
        }
    }

    _wireRegions(srcName, dstName, density, weightRange = [0.1, 0.8]) {
        const src = this.layout[srcName];
        const dst = this.layout[dstName];
        const [wMin, wMax] = weightRange;
        // wiring phases that freeze the process when creating a new brain from scratch.
        const MAX_CONNECTIONS = Number(process.env.NEXT_PUBLIC_BRAIN_MAX_CONNECTIONS ?? 50_000) / ((window.innerWidth < 1000) ? 3:1);
        const sampleSize = Math.min(MAX_CONNECTIONS, Math.floor(src.size * density));
        for (let k = 0; k < sampleSize; k++) {
            const i = src.start + Math.floor(Math.random() * src.size);
            const j = dst.start + Math.floor(Math.random() * dst.size);
            const w = wMin + Math.random() * (wMax - wMin);
            this.engine.connect(i, j, w);
        }
    }

    _wire() {
        console.log('Wiring regions...');
        // ── Thalamus ──────────────────────────────────────────────────────────────
        this._wireRegions('visual',         'thalamus',       0.8, [0.5, 1.0]);
        this._wireRegions('sensory',        'thalamus',       0.8, [0.5, 1.0]);
        this._wireRegions('thalamus',       'visual',         0.3, [0.2, 0.5]);
        this._wireRegions('thalamus',       'sensory',        0.3, [0.2, 0.5]);
        this._wireRegions('thalamus',       'association',    0.6, [0.4, 0.9]);
        this._wireRegions('thalamus',       'hippocampus',    0.4, [0.3, 0.7]);
        this._wireRegions('prefrontal',     'thalamus',       0.3, [0.2, 0.6]);
        // ── Hypothalamus: drives → thalamus, amygdala, VTA ───────────────────────
        this._wireRegions('hypothalamus',   'thalamus',       0.5, [0.4, 0.9]);
        this._wireRegions('hypothalamus',   'amygdala',       0.4, [0.3, 0.8]);
        this._wireRegions('hypothalamus',   'prefrontal',     0.3, [0.2, 0.6]);
        this._wireRegions('hypothalamus',   'vta',            0.4, [0.3, 0.8]);
        this._wireRegions('prefrontal',     'hypothalamus',   0.2, [0.1, 0.4]);
        // ── Amygdala ──────────────────────────────────────────────────────────────
        this._wireRegions('thalamus',       'amygdala',       0.6, [0.5, 1.0]);
        this._wireRegions('sensory',        'amygdala',       0.4, [0.3, 0.8]);
        this._wireRegions('visual',         'amygdala',       0.3, [0.3, 0.7]);
        this._wireRegions('amygdala',       'thalamus',       0.4, [0.4, 0.8]);
        this._wireRegions('amygdala',       'prefrontal',     0.4, [0.3, 0.7]);
        this._wireRegions('amygdala',       'acc',            0.4, [0.3, 0.7]);
        this._wireRegions('amygdala',       'hippocampus',    0.5, [0.4, 0.9]);
        this._wireRegions('amygdala',       'motor',          0.3, [0.3, 0.7]);
        this._wireRegions('amygdala',       'locusCoeruleus', 0.4, [0.3, 0.8]);
        this._wireRegions('prefrontal',     'amygdala',       0.3, [0.2, 0.5]);
        this._wireRegions('hippocampus',    'amygdala',       0.3, [0.2, 0.5]);
        // ── Cortical feedforward ──────────────────────────────────────────────────
        this._wireRegions('visual',         'association',    0.5, [0.3, 0.7]);
        this._wireRegions('sensory',        'association',    0.5, [0.3, 0.7]);
        this._wireRegions('association',    'hippocampus',    0.7, [0.4, 0.9]);
        this._wireRegions('hippocampus',    'association',    0.7, [0.4, 0.9]);
        this._wireRegions('hippocampus',    'temporal',       0.8, [0.5, 1.0]);
        this._wireRegions('temporal',       'hippocampus',    0.6, [0.3, 0.8]);
        this._wireRegions('temporal',       'association',    0.6, [0.3, 0.8]);
        this._wireRegions('association',    'prefrontal',     0.5, [0.3, 0.8]);
        this._wireRegions('prefrontal',     'association',    0.4, [0.2, 0.6]);
        this._wireRegions('prefrontal',     'motor',          0.4, [0.3, 0.8]);
        this._wireRegions('association',    'motor',          0.4, [0.3, 0.7]);
        this._wireRegions('motor',          'cerebellum',     0.5, [0.3, 0.7]);
        this._wireRegions('cerebellum',     'motor',          0.5, [0.3, 0.7]);
        this._wireRegions('cerebellum',     'sensory',        0.3, [0.2, 0.5]);
        this._wireRegions('sensory',        'motor',          0.3, [0.2, 0.6]);
        // ── ACC: conflict monitor ─────────────────────────────────────────────────
        this._wireRegions('association',    'acc',            0.4, [0.3, 0.7]);
        this._wireRegions('prefrontal',     'acc',            0.3, [0.2, 0.6]);
        this._wireRegions('acc',            'prefrontal',     0.5, [0.4, 0.8]);
        this._wireRegions('acc',            'basalGanglia',   0.4, [0.3, 0.7]);
        this._wireRegions('acc',            'association',    0.3, [0.2, 0.5]);
        this._wireRegions('acc',            'locusCoeruleus', 0.3, [0.2, 0.6]);
        // ── Basal ganglia: winner-take-all gating ─────────────────────────────────
        this._wireRegions('prefrontal',     'basalGanglia',   0.5, [0.4, 0.9]);
        this._wireRegions('association',    'basalGanglia',   0.4, [0.3, 0.7]);
        this._wireRegions('hippocampus',    'basalGanglia',   0.3, [0.2, 0.6]);
        this._wireRegions('basalGanglia',   'motor',          0.5, [0.4, 0.9]);
        this._wireRegions('basalGanglia',   'prefrontal',     0.3, [0.2, 0.5]);
        this._wireRegions('basalGanglia',   'thalamus',       0.4, [0.3, 0.7]);
        this._wireRegions('vta',            'basalGanglia',   0.5, [0.4, 0.9]);
        // ── Neuromodulator nuclei ─────────────────────────────────────────────────
        this._wireRegions('hippocampus',    'vta',            0.3, [0.2, 0.6]);
        this._wireRegions('prefrontal',     'vta',            0.2, [0.1, 0.4]);
        this._wireRegions('vta',            'prefrontal',     0.4, [0.3, 0.7]);
        this._wireRegions('vta',            'hippocampus',    0.4, [0.3, 0.7]);
        this._wireRegions('vta',            'association',    0.3, [0.2, 0.5]);
        this._wireRegions('locusCoeruleus', 'thalamus',       0.4, [0.3, 0.7]);
        this._wireRegions('locusCoeruleus', 'prefrontal',     0.3, [0.2, 0.6]);
        this._wireRegions('locusCoeruleus', 'association',    0.3, [0.2, 0.5]);
        this._wireRegions('prefrontal',     'raphe',          0.2, [0.1, 0.4]);
        this._wireRegions('raphe',          'amygdala',       0.3, [0.2, 0.5]);
        this._wireRegions('raphe',          'prefrontal',     0.3, [0.2, 0.5]);
        this._wireRegions('raphe',          'association',    0.2, [0.1, 0.4]);
        this._wireRegions('raphe',          'basalGanglia',   0.2, [0.1, 0.4]);
        console.log('Wiring done.');
    }

    reward(strength = 1.0) {
        this.engine.dopamine = Math.min(this.engine.dopamine + strength, 3.0);
    }

    punish(strength = 1.0) {
        this.engine.dopamine = Math.max(this.engine.dopamine - strength, -1.0);
    }

    setNeeds(needs = {}) {
        this.needs = {
            hunger: Math.max(0, Math.min(1, Number(needs.hunger ?? this.needs.hunger) || 0)),
            energy: Math.max(0, Math.min(1, Number(needs.energy ?? this.needs.energy) || 0)),
            joy:    Math.max(0, Math.min(1, Number(needs.joy    ?? this.needs.joy)    || 0)),
        };
        return this.getNeeds();
    }

    getNeeds() {
        return { ...this.needs };
    }

    getBody() {
        return { ...this.body };
    }

    move(dx = 0, dy = 0, intensity = 1.0) {
        const speed = Math.max(0, Math.min(1, intensity));
        const step = 0.10 * speed;
        this.body.x = Math.max(0, Math.min(1, this.body.x + dx * step));
        this.body.y = Math.max(0, Math.min(1, this.body.y + dy * step));
        this.body.heading = Math.atan2(dy, dx) || this.body.heading;
        this.body.speed = Math.sqrt(dx * dx + dy * dy) * speed;
        this.body.energy = Math.max(0, this.body.energy - 0.01 * speed);
        this.needs.energy = Math.max(0, this.needs.energy - 0.01 * speed);
        this.needs.joy = Math.max(0, this.needs.joy - 0.003 * speed);
        this.motorState = { moveX: dx, moveY: dy, lastAction: 'move' };

        const motor = this.layout.motor;
        const cereb = this.layout.cerebellum;
        const sensory = this.layout.sensory;
        const qSize = this.motorQuadrantSize();

        // Motor command — fire the quadrant matching actual direction
        const rightQ = dx > 0 ? 0 : 1;
        const downQ  = dy > 0 ? 2 : 3;
        this.engine.pulse(motor.start + rightQ * qSize, 1.8 * speed);
        this.engine.pulse(motor.start + downQ  * qSize, 1.8 * speed);

        // Efference copy → cerebellum
        this.engine.pulse(cereb.start,     1.4 * speed);
        this.engine.inject(cereb.start + 8, 1.2 * speed);

        // Proprioception → sensory
        this.engine.pulse(sensory.start + 64, 1.6 * speed * Math.abs(dx));
        this.engine.pulse(sensory.start + 72, 1.6 * speed * Math.abs(dy));
        this.engine.inject(sensory.start + 80, 1.2 * speed);

        this.reward(0.06 * speed);
        return this.getBody();
    }

    _tickNeeds() {
        this.needs.hunger = Math.max(0, Math.min(1, this.needs.hunger - 0.002));
        this.needs.energy = Math.max(0, Math.min(1, this.needs.energy - 0.0015));
        this.needs.joy    = Math.max(0, Math.min(1, this.needs.joy - 0.0018));
    }

    integrateWorldState(state = {}) {
        if (state.body) {
            this.body = { ...this.body, ...state.body };
            const { x, y, heading = 0, speed = 0, vx = 0, vy = 0 } = this.body;
            const thalamus = this.layout.thalamus;
            const motor    = this.layout.motor;
            const borderX  = x < 0.12 || x > 0.88 ? 1.3 : 0;
            const borderY  = y < 0.12 || y > 0.88 ? 1.3 : 0;
            const bodySignal = 2.6 + Math.max(0, speed) * 1.8;
            // Body state enters via thalamus — it relays to sensory/association
            this.engine.pulse(thalamus.start + 0,  bodySignal * (0.9 + Math.abs(x - 0.5) * 1.4 + borderX));
            this.engine.pulse(thalamus.start + 8,  bodySignal * (0.9 + Math.abs(y - 0.5) * 1.4 + borderY));
            this.engine.pulse(thalamus.start + 16, bodySignal * (0.8 + Math.abs(heading) * 0.4 + borderX + borderY));
            // Do not route body state directly into motor quadrants; movement should come from explicit motor hints.

            const motionSignal = 1.8 + Math.min(1.5, Math.hypot(vx, vy) * 8);
            this.engine.pulse(this.layout.sensory.start + 88, motionSignal * 1.8);
            this.engine.inject(this.layout.sensory.start + 96, motionSignal * 1.2);
            this.engine.inject(this.layout.association.start + 12, motionSignal * 0.8);
            this.engine.pulse(thalamus.start + 48, motionSignal * 0.7);
            // Do not inject motion back into motor quadrant directly.
        }

        if (state.opticFlow && typeof state.opticFlow === 'object') {
            const flowX = Number(state.opticFlow.x || 0);
            const flowY = Number(state.opticFlow.y || 0);
            const flowMag = Math.min(1, Math.hypot(flowX, flowY, Number(state.opticFlow.magnitude || 0)));
            if (flowMag > 0.02) {
                const flowDir = Math.atan2(flowY, flowX);
                const visualSize = this.layout.visual.size;
                const quadrant = Math.floor(((flowDir + Math.PI) / (Math.PI / 2)) % 4);
                const qStep = Math.max(8, Math.floor(visualSize / 16));
                const baseIdx = this.layout.visual.start + quadrant * qStep;
                this.engine.pulse(baseIdx, 1.4 + flowMag * 2.0);
                this.engine.inject(this.layout.visual.start + ((quadrant + 2) % 4) * qStep, 0.9 + flowMag * 1.1);
                this.engine.pulse(this.layout.sensory.start + 112, 1.0 + flowMag * 1.3);
                this.engine.inject(this.layout.association.start + 24, 0.7 + flowMag * 0.8);
                this.engine.pulse(thalamus.start + 56, 0.5 + flowMag * 0.8);
            }
        }

        if (state.motorHint && typeof state.motorHint === 'object' && typeof state.motorHint.x === 'number' && typeof state.motorHint.y === 'number') {
            const x = Number(state.motorHint.x);
            const y = Number(state.motorHint.y);
            const intensity = Math.max(0, Math.min(1, Number(state.motorHint.intensity || 1)));
            if (x === 0 && y === 0) {
                this.motorHint = null;
            } else {
                this.motorHint = {
                    x,
                    y,
                    intensity,
                    hintMode: state.motorHint.hintMode || null
                };
            }
        } else {
            this.motorHint = null;
        }

        if (state.needs) {
            this.setNeeds(state.needs);
            const needSignal = 2.4 + (1 - (this.needs.hunger + this.needs.energy + this.needs.joy) / 3) * 1.8;
            // Needs route through hypothalamus first, then thalamus → cortex
            const thalamus = this.layout.thalamus;
            const hypo     = this.layout.hypothalamus;
            this.engine.pulse(hypo.start,      needSignal * (1.0 + (this.needs.hunger < 0.4 ? 1.2 : 0)));
            this.engine.pulse(hypo.start + 8,  needSignal * (1.0 + (this.needs.energy < 0.3 ? 0.9 : 0)));
            this.engine.pulse(hypo.start + 16, needSignal * (1.0 + (this.needs.joy    < 0.3 ? 0.7 : 0)));
            this.engine.pulse(thalamus.start + 24, needSignal * (1.0 + (this.needs.hunger < 0.4 ? 0.8 : 0)));
            this.engine.pulse(thalamus.start + 32, needSignal * (1.0 + (this.needs.energy < 0.3 ? 0.6 : 0)));
            this.engine.pulse(thalamus.start + 40, needSignal * (1.0 + (this.needs.joy < 0.3 ? 0.5 : 0)));
            // Interoception: pain/hunger also hits sensory cortex directly
            if (this.needs.hunger < 0.4) {
                const pain = (0.4 - this.needs.hunger) * 4.0;
                this.engine.pulse(this.layout.sensory.start + 32, pain * 2.2);
                this.engine.inject(this.layout.sensory.start + 40, pain * 1.8);
                // Hunger is mildly threatening — amygdala activates proportionally
                this.amygdalaActivate(pain * 0.2);
            }
            if (this.needs.energy < 0.3) {
                const fatigue = (0.3 - this.needs.energy) * 4.0;
                this.engine.pulse(this.layout.sensory.start + 48, fatigue * 2.0);
            }
            if (this.needs.joy < 0.3) {
                const distress = (0.3 - this.needs.joy) * 4.0;
                this.engine.pulse(this.layout.sensory.start + 56, distress * 1.8);
                this.punish(distress * 0.05);
            }
            // Motor homing: when hungry, bias motor toward last food location
            if (this.needs.hunger < 0.5 && this._lastFoodX != null) {
                const toFoodX = this._lastFoodX - this.body.x;
                const toFoodY = this._lastFoodY - this.body.y;
                const hunger  = 1 - this.needs.hunger;
                const qSize   = this.motorQuadrantSize();
                const motor   = this.layout.motor;
                this.engine.inject(motor.start + (toFoodX > 0 ? 0 : qSize),         hunger * 1.2);
                this.engine.inject(motor.start + (toFoodY > 0 ? qSize*2 : qSize*3), hunger * 1.2);
            }
        }

        if (Array.isArray(state.detections) && state.detections.length > 0) {
            const { start, size } = this.layout.visual;
            const thalamus = this.layout.thalamus;
            const stride = Math.max(64, Math.floor(size / 256));
            for (const det of state.detections) {
                const label = String(det.label || 'object').toLowerCase();
                let hash = 5381;
                for (let i = 0; i < label.length; i++) {
                    hash = ((hash << 5) + hash) ^ label.charCodeAt(i);
                    hash = hash >>> 0;
                }
                const idx = start + (hash % Math.max(1, size - stride));
                const value = 2.4 + (det.w || 0.2) * 0.8;
                this.engine.pulse(idx, value);
                this.engine.pulse(idx + stride, value * 0.8);
                this.engine.inject(start + Math.floor(size * 0.1) + (hash % 128), value * 0.6);
                // Visual input also hits thalamus (thalamocortical pathway)
                this.engine.pulse(thalamus.start + (hash % 32), value * 0.7);
            }
            const hasSalient = state.detections.some(d =>
                d.label === 'self' || d.label === 'violet-glow' ||
                d.label === 'cyan-light' || d.label === 'warm-glow'
            );
            if (hasSalient) {
                this.reward(0.08);
                // Positive salience — mild amygdala activation (curiosity, not threat)
                this.amygdalaActivate(0.15);
            }
        }

        if (state.interaction?.note) {
            const note = (state.interaction.note || '').toLowerCase();
            const isFood    = note.includes('feed') || note.includes('food');
            const isPoke    = note.includes('poke');
            const isAverse  = note.includes('aversive');
            const isDanger  = note.includes('danger') || note.includes('hurt');
            const motor     = this.layout.motor;

            if (isFood) {
                const hungerLevel = state.interaction.hungerLevel ?? this.needs.hunger;
                const rawReward = 0.3 + (1 - hungerLevel) * 1.4;
                this.needs.hunger = Math.min(1, this.needs.hunger + 0.28);
                this.needs.joy    = Math.min(1, this.needs.joy + 0.06);
                this.reward(rawReward);
                if (state.interaction.x != null) {
                    this._lastFoodX = state.interaction.x;
                    this._lastFoodY = state.interaction.y;
                }
                // Food: thalamus relays to sensory/association; low-threat amygdala (salience only)
                this.engine.pulse(this.layout.thalamus.start, 2.8);
                this.engine.pulse(this.layout.association.start, 2.5);
                this.engine.inject(this.layout.association.start + 8, 1.8);
                this.amygdalaActivate(0.1);
            } else if (isPoke || isAverse || isDanger) {
                // Poke/danger: amygdala fires hard — it decides the NE magnitude
                this.amygdalaActivate(0.8);
                this.punish(0.4);
                this.needs.energy = Math.max(0, this.needs.energy - 0.05);
                this.needs.joy    = Math.max(0, this.needs.joy    - 0.04);
                const sensory = this.layout.sensory;
                const assoc   = this.layout.association;
                this.engine.pulse(sensory.start + 0, 2.5);
                this.engine.pulse(sensory.start + 8, 2.2);
                this.engine.inject(assoc.start + 0,  2.1);
                this.engine.inject(assoc.start + 8,  1.9);
                const qSize = this.motorQuadrantSize();
                const px = state.interaction.x ?? 0.5;
                const py = state.interaction.y ?? 0.5;
                const awayX = this.body.x < px ? -1 : 1;
                const awayY = this.body.y < py ? -1 : 1;
                this.engine.inject(motor.start + (awayX > 0 ? 0 : qSize),         1.8);
                this.engine.inject(motor.start + (awayY > 0 ? qSize*2 : qSize*3), 1.8);
            } else {
                this.handleInteraction(note, 1.0);
                const sensory = this.layout.sensory;
                const assoc   = this.layout.association;
                this.engine.pulse(sensory.start, 1.9);
                this.engine.inject(assoc.start,  1.7);
                this.engine.inject(this.layout.motor.start + 24, 0.6);
            }
        }

        const motor = this.layout.motor;
        const qSize = this.motorQuadrantSize();
        // Spread tonic motor tone evenly across all four direction quadrants
        // so the right quadrant does not receive a constant head-start.
        this.engine.inject(motor.start + 0 * qSize, 0.18);
        this.engine.inject(motor.start + 1 * qSize, 0.18);
        this.engine.inject(motor.start + 2 * qSize, 0.18);
        this.engine.inject(motor.start + 3 * qSize, 0.18);
        return this.emotionalState();
    }

    handleInteraction(kind, intensity = 1.0) {
        this._tickNeeds();
        const strength = Math.max(0.1, Math.min(1.0, intensity));

        switch (kind) {
            case 'feed':
                this.needs.hunger = Math.min(1, this.needs.hunger + 0.28 * strength);
                this.needs.joy = Math.min(1, this.needs.joy + 0.08 * strength);
                this.reward(0.7 + 0.2 * strength);
                break;
            case 'rest':
                this.needs.energy = Math.min(1, this.needs.energy + 0.3 * strength);
                this.needs.joy = Math.min(1, this.needs.joy + 0.04 * strength);
                this.reward(0.45 + 0.15 * strength);
                break;
            case 'play':
            case 'poke':
                this.needs.joy = Math.min(1, this.needs.joy + 0.18 * strength);
                this.needs.energy = Math.max(0, this.needs.energy - 0.04 * strength);
                this.reward(0.25 + 0.1 * strength);
                break;
            case 'danger':
                this.needs.energy = Math.max(0, this.needs.energy - 0.08 * strength);
                this.needs.joy = Math.max(0, this.needs.joy - 0.06 * strength);
                this.punish(0.2 + 0.1 * strength);
                break;
            default:
                this.needs.joy = Math.max(0, this.needs.joy - 0.02 * strength);
                this.punish(0.05 * strength);
                break;
        }

        return this.getNeeds();
    }

    // Amygdala-gated startle — the amygdala decides NE magnitude, not the raw stimulus.
    // threatLevel: 0 = neutral/curious, 1 = maximum threat
    amygdalaActivate(threatLevel = 0.5) {
        const amyg = this.layout.amygdala;
        this.engine.pulse(amyg.start,     threatLevel * 2.5);
        this.engine.pulse(amyg.start + 8, threatLevel * 2.0);
        // Read actual amygdala firing to scale NE — the brain decides how scared to be
        const amygLevel = this.engine.meanAbs(amyg.start, amyg.end, 2);
        if (amygLevel > 0.001) {
            this.startle(Math.min(1.0, amygLevel * 80 * threatLevel));
        }
        return amygLevel;
    }

    // Salience interrupt — norepinephrine spike. Called by amygdalaActivate() for
    // threat, or directly for physical events (poke, collision).
    startle(strength = 1.0) {
        this.engine.norepinephrine = Math.min(this.engine.norepinephrine + strength, 3.0);
        // NE transiently raises firing thresholds — filters out weak background noise
        const boost = strength * 0.1;
        const { sensory, association } = this.layout;
        const sStep = Math.max(5, Math.floor(sensory.size / 2000));
        const aStep = Math.max(5, Math.floor(association.size / 2000));
        for (let i = sensory.start; i < sensory.end; i += sStep) {
            this.engine.threshold[i] = Math.min(this.engine.threshold[i] + boost, 2.0);
        }
        for (let i = association.start; i < association.end; i += aStep) {
            this.engine.threshold[i] = Math.min(this.engine.threshold[i] + boost, 2.0);
        }
    }

    // ── Emotional state — reads actual region activations ─────────────────────
    emotionalState() {
        this._tickNeeds();

        const sensoryMean = this.engine.meanAbs(this.layout.sensory.start,      this.layout.sensory.end,      8);
        const assocMean   = this.engine.meanAbs(this.layout.association.start,   this.layout.association.end,  8);
        const hippMean    = this.engine.meanAbs(this.layout.hippocampus.start,   this.layout.hippocampus.end,  4);
        const hypothMean  = this.engine.meanAbs(this.layout.hypothalamus.start,  this.layout.hypothalamus.end, 2);
        const accMean     = this.engine.meanAbs(this.layout.acc.start,           this.layout.acc.end,          2);
        const rapheMean   = this.engine.meanAbs(this.layout.raphe.start,         this.layout.raphe.end,        2);

        const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
        const pressure = 1 - needAverage;

        // Hypothalamus drives urgency — unmet needs amplify pressure signal
        const hypothPressure = Math.tanh(hypothMean * 20 + pressure * 0.5);

        // Arousal: sensory + association activity, floored by wakefulness
        const rawArousal = Math.tanh((sensoryMean + assocMean) * 10 + hypothPressure * 0.35) + 0.1;

        // Drive: hippocampus engagement + hypothalamic pressure
        const rawDrive = Math.tanh(hippMean * 15 + hypothPressure * 0.6);

        // Valence: dopamine minus need pressure, modulated by serotonin (raphe)
        // Raphe (serotonin) stabilises valence — high raphe = less volatile mood
        const serotoninStability = Math.tanh(rapheMean * 30);
        const rawValence = Math.tanh(this.engine.dopamine + 0.2 - pressure * 0.7 * (1 - serotoninStability * 0.3));

        // ACC conflict signal — high ACC = uncertainty/effort, slightly negative valence
        const conflictPenalty = Math.tanh(accMean * 25) * 0.15;

        this._valence = this._valence * 0.7 + (rawValence - conflictPenalty) * 0.3;
        this._arousal = this._arousal * 0.6 + rawArousal * 0.4;
        this._drive   = this._drive   * 0.8 + rawDrive   * 0.2;

        return {
            valence:        this._valence,
            arousal:        this._arousal,
            drive:          this._drive,
            norepinephrine: Math.tanh(this.engine.norepinephrine),
            needs:          this.getNeeds(),
            body:           this.getBody(),
        };
    }

    behaviorState() {
        const emotional = this.emotionalState();
        const { hypothalamus, acc, basalGanglia, vta, raphe, prefrontal, association } = this.layout;
        const hypoMean = this.engine.meanAbs(hypothalamus.start, hypothalamus.end, 2);
        const accMean = this.engine.meanAbs(acc.start, acc.end, 2);
        const bgMean = this.engine.meanAbs(basalGanglia.start, basalGanglia.end, 4);
        const vtaMean = this.engine.meanAbs(vta.start, vta.end, 2);
        const rapheMean = this.engine.meanAbs(raphe.start, raphe.end, 2);
        const pfcMean = this.engine.meanAbs(prefrontal.start, prefrontal.end, 8);
        const assocMean = this.engine.meanAbs(association.start, association.end, 8);
        const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
        const pressure = 1 - needAverage;
        const curiosity = Math.max(0, Math.min(1, Math.tanh(hypoMean * 24 + pressure * 0.4 + assocMean * 2 + (1 - Math.abs(emotional.valence)) * 0.2)));
        const uncertainty = Math.max(0, Math.min(1, Math.tanh(accMean * 22 + emotional.arousal * 0.5 + (1 - Math.abs(emotional.valence)) * 0.25)));
        const actionReadiness = Math.max(0, Math.min(1, Math.tanh(bgMean * 24 + vtaMean * 16 + emotional.drive * 0.8 + pfcMean * 1.4)));
        const patience = Math.max(0, Math.min(1, 0.45 + Math.tanh(rapheMean * 24) * 0.45 + (1 - emotional.arousal) * 0.1));
        const speechReadiness = Math.max(0, Math.min(1, 0.1 + emotional.drive * 0.2 + emotional.valence * 0.12 + actionReadiness * 0.16 - uncertainty * 0.18 - emotional.arousal * 0.15 + pfcMean * 0.04));
        const researchDrive = Math.max(0, Math.min(1, curiosity * 0.45 + uncertainty * 0.35 + pressure * 0.2 + emotional.drive * 0.2));

        return {
            valence: emotional.valence,
            arousal: emotional.arousal,
            drive: emotional.drive,
            curiosity,
            uncertainty,
            actionReadiness,
            patience,
            speechReadiness,
            researchDrive,
        };
    }

    decideBehavior(options = {}) {
        const state = this.behaviorState();
        const activeGoal = options.activeGoal || null;
        const hasUrgentGoal = !!activeGoal && (activeGoal.urgency || 0) > 0.55;
        const shouldResearch = Boolean(
            activeGoal && (
                hasUrgentGoal ||
                state.uncertainty > 0.28 ||
                state.researchDrive > 0.34 ||
                options.humanPresent === true
            )
        );
        const gap = Math.max(0, (options.tickCount || 0) - (options.lastSpokeTick || 0));
        const canSpeak = Boolean(
            options.pendingSelfSpeech &&
            options.humanPresent === true &&
            gap >= 60 &&
            state.speechReadiness > 0.22 &&
            state.drive > 0.1 &&
            state.arousal < 0.85 &&
            (hasUrgentGoal || state.valence > -0.05)
        );
        return {
            ...state,
            activeGoal,
            canSpeak,
            shouldResearch,
            shouldAct: Boolean(activeGoal && state.actionReadiness > 0.3),
            responseMode: shouldResearch ? 'grounded' : canSpeak ? 'speak' : 'quiet',
        };
    }

    // ── Basal ganglia: winner-take-all action selection ───────────────────────
    // Reads competing action signals from PFC/association, suppresses losers.
    // This is what prevents everything activating simultaneously.
    actionSelection() {
        const bg  = this.layout.basalGanglia;
        const pfc = this.layout.prefrontal;
        const acc = this.layout.acc;

        // Read current BG activation — reflects competing action proposals
        const bgMean = this.engine.meanAbs(bg.start, bg.end, 4);
        if (bgMean < 0.001) return;

        // BG inhibits motor cortex proportional to its own activation
        // (indirect pathway — suppresses all but the winning action)
        const inhibStrength = Math.tanh(bgMean * 40) * 0.25;
        const pot = this.engine.potential;
        const motor = this.layout.motor;
        const step = Math.max(4, Math.floor(motor.size / 500));
        for (let i = motor.start; i < motor.end; i += step) {
            pot[i] *= (1 - inhibStrength);
        }

        // ACC monitors conflict — high BG variance = competing actions = conflict
        const bgPeak = this.engine.peakAbs(bg.start, bg.end);
        const conflict = Math.max(0, bgPeak - bgMean * 2);
        if (conflict > 0.01) {
            this.engine.pulse(acc.start,     conflict * 1.5);
            this.engine.pulse(acc.start + 8, conflict * 1.2);
        }

        // VTA fires when BG selects a high-value action (dopamine prediction)
        const vta = this.layout.vta;
        if (bgPeak > 0.05) {
            this.engine.pulse(vta.start, bgPeak * 1.2);
        }
    }

    novelty() {
        const { start, end, size } = this.layout.association;
        const pot   = this.engine.potential;
        const base  = this._baseline;
        const alpha = this._baselineAlpha;
        const step  = Math.max(4, Math.floor(size / 2000));
        let diff = 0, count = 0;
        for (let i = start; i < end; i += step) {
            const idx = i - start;
            const v   = pot[i];
            const d   = v - base[idx];
            diff += d < 0 ? -d : d;
            base[idx] = base[idx] * (1 - alpha) + v * alpha;
            count++;
        }
        return Math.tanh(diff / count);
    }

    // Receive visual input directly into the visual cortex region
    perceiveVisual(input) {
        const { start, size } = this.layout.visual;
        if (input instanceof Uint32Array) {
            for (let i = 0; i < input.length; i++) {
                this.engine.pulse(start + (input[i] % size), 2.0);
            }
        }
    }

    perceive(input) {
        const { start } = this.layout.sensory;
        if (input instanceof Uint32Array) {
            for (let i = 0; i < input.length; i++) {
                this.engine.inject(start + input[i], 1.2);
            }
        } else {
            const len = Math.min(input.length, this.layout.sensory.size);
            for (let i = 0; i < len; i++) {
                if (input[i] > 0) this.engine.inject(start + i, input[i]);
            }
        }
    }

    // External speech arrives via thalamus → amygdala (alerting) → sensory.
    // This is the anatomically correct path for auditory input — distinct from
    // perceive() (internal thought) which bypasses thalamus entirely.
    // The thalamic pulse is stronger than perceive()'s inject so the brain
    // can feel the difference between "I thought this" and "something arrived."
    hear(input) {
        const thalamus = this.layout.thalamus;
        const sensory  = this.layout.sensory;
        const amygdala = this.layout.amygdala;
        if (!(input instanceof Uint32Array)) return;
        // Route through thalamus first — the relay gate
        for (let i = 0; i < input.length; i++) {
            this.engine.pulse(thalamus.start + (input[i] % thalamus.size), 2.2);
        }
        // Thalamus → sensory cortex (stronger than internal perceive)
        for (let i = 0; i < input.length; i++) {
            this.engine.pulse(sensory.start + (input[i] % sensory.size), 1.8);
        }
        // Mild amygdala alerting — novelty/attention, not threat
        this.engine.pulse(amygdala.start,     0.6);
        this.engine.pulse(amygdala.start + 8, 0.4);
    }

    // Encode a concept directly into hippocampus — this is how learning sticks
    encode(input, strength = 1.0) {
        const { start, size } = this.layout.hippocampus;
        if (input instanceof Uint32Array) {
            for (let i = 0; i < input.length; i++) {
                this.engine.receive(start + (input[i] % size), strength);
            }
        } else {
            const len = Math.min(input.length, size);
            for (let i = 0; i < len; i++) {
                if (input[i] > 0) this.engine.receive(start + i, input[i] * strength);
            }
        }
    }

    // Consolidate into temporal cortex — long-term memory storage
    consolidate(input, strength = 1.0) {
        const { start, size } = this.layout.temporal;
        if (input instanceof Uint32Array) {
            for (let i = 0; i < input.length; i++) {
                this.engine.receive(start + (input[i] % size), strength);
            }
        } else {
            const len = Math.min(input.length, size);
            for (let i = 0; i < len; i++) {
                if (input[i] > 0) this.engine.receive(start + i, input[i] * strength);
            }
        }
    }

    thought() {
        const { start, end } = this.layout.association;
        return this.engine.activation(start, end);
    }

    // Deviation-from-baseline version of reafference. topN neurons are picked
    // by |potential − rolling baseline| rather than raw |potential| — see the
    // _reafBaseline/_reafBaselineAlpha comment in the constructor for why raw
    // magnitude was saturating strength at ~1.000 on nearly every call. The
    // baseline itself decays slowly (alpha = 0.02, faster than novelty()'s
    // 0.005 since reafference is meant to track shorter-timescale settling,
    // not long-run drift), so a genuinely elevated-but-stable region reads as
    // low reafference once it's been elevated for a while, while an actual
    // fresh spike still reads as high.
    reafference(topN = 20) {
        const { start, end, size } = this.layout.association;
        const step   = Math.max(1, Math.floor(size / 10000));
        const pot    = this.engine.potential;
        const base   = this._reafBaseline;
        const alpha  = this._reafBaselineAlpha;
        const topIdx = new Int32Array(topN).fill(-1);
        const topVal = new Float32Array(topN);
        let minVal = 0, minPos = 0, filled = 0;

        for (let i = start; i < end; i += step) {
            const idx = i - start;
            const raw = pot[i];
            const dev = raw - base[idx];
            const v   = dev < 0 ? -dev : dev;
            // Update the baseline every sampled neuron regardless of whether
            // it makes the top-N this tick — otherwise unsampled ticks would
            // let stale baselines drift further from reality every time a
            // neuron happens not to be novel enough to be tracked.
            base[idx] = base[idx] * (1 - alpha) + raw * alpha;
            if (v === 0) continue;
            if (filled < topN) {
                topIdx[filled] = idx;
                topVal[filled] = v;
                filled++;
                if (filled === topN) {
                    minVal = topVal[0]; minPos = 0;
                    for (let k = 1; k < topN; k++) if (topVal[k] < minVal) { minVal = topVal[k]; minPos = k; }
                }
            } else if (v > minVal) {
                topIdx[minPos] = idx;
                topVal[minPos] = v;
                minVal = topVal[0]; minPos = 0;
                for (let k = 1; k < topN; k++) if (topVal[k] < minVal) { minVal = topVal[k]; minPos = k; }
            }
        }
        let sum = 0;
        const indices = [];
        for (let k = 0; k < filled; k++) { sum += topVal[k]; indices.push(topIdx[k]); }
        return { indices, strength: Math.tanh((filled > 0 ? sum / filled : 0) * 5) };
    }

    // Raw region measurements — opaque values the LLM must report, not interpret.
    // Named Ω1–Ω5 so the LLM has no prior associations to project onto them.
    readInternalState() {
        const { association, prefrontal, hippocampus, sensory, motor, acc, basalGanglia, hypothalamus } = this.layout;
        const pfcStep   = Math.max(1, Math.floor((prefrontal.end   - prefrontal.start)   / 500));
        const assocStep = Math.max(1, Math.floor((association.end  - association.start)  / 500));
        const hippStep  = Math.max(1, Math.floor((hippocampus.end  - hippocampus.start)  / 500));
        const sensStep  = Math.max(1, Math.floor((sensory.end      - sensory.start)      / 500));
        const motorStep = Math.max(1, Math.floor((motor.end        - motor.start)        / 500));
        const accStep   = Math.max(1, Math.floor((acc.end          - acc.start)          / 500));
        const bgStep    = Math.max(1, Math.floor((basalGanglia.end - basalGanglia.start) / 500));
        const hypoStep  = Math.max(1, Math.floor((hypothalamus.end - hypothalamus.start) / 500));
        return {
            Ω1: +this.engine.meanAbs(association.start,  association.end,  assocStep).toFixed(4),
            Ω2: +this.engine.meanAbs(prefrontal.start,   prefrontal.end,   pfcStep).toFixed(4),
            Ω3: +this.engine.meanAbs(hippocampus.start,  hippocampus.end,  hippStep).toFixed(4),
            Ω4: +this.engine.meanAbs(sensory.start,      sensory.end,      sensStep).toFixed(4),
            Ω5: +this.engine.meanAbs(motor.start,        motor.end,        motorStep).toFixed(4),
            Ω_acc:  +this.engine.meanAbs(acc.start,          acc.end,          accStep).toFixed(4),
            Ω_bg:   +this.engine.meanAbs(basalGanglia.start, basalGanglia.end, bgStep).toFixed(4),
            Ω_hypo: +this.engine.meanAbs(hypothalamus.start, hypothalamus.end, hypoStep).toFixed(4),
            Ω_da: +this.engine.dopamine.toFixed(3),
            Ω_ne: +this.engine.norepinephrine.toFixed(3),
        };
    }

    // Motor quadrant layout (consistent across write and read):
    //   Q0 = right  (motor.start + 0*qSize)
    //   Q1 = left   (motor.start + 1*qSize)
    //   Q2 = down   (motor.start + 2*qSize)
    //   Q3 = up     (motor.start + 3*qSize)
    // PFC writes intent here; consciousness reads it back to derive dx/dy.
    // Hebbian learning then strengthens whichever quadrant fired when reward came.
    motorQuadrantSize() {
        return Math.floor(this.layout.motor.size / 4);
    }

    // Read motor region activations and convert to a normalized intent vector
    getMotorIntent() {
        const motor = this.layout.motor;
        const qSize = this.motorQuadrantSize();
        // Sample sparsely across quadrants to reduce CPU cost (step proportional to quadrant size)
        const sampleStep = Math.max(8, Math.floor(qSize / 32));
        const right = this.engine.meanAbs(motor.start,              motor.start + qSize,     sampleStep);
        const left  = this.engine.meanAbs(motor.start + qSize,      motor.start + qSize * 2, sampleStep);
        const down  = this.engine.meanAbs(motor.start + qSize * 2,  motor.start + qSize * 3, sampleStep);
        const up    = this.engine.meanAbs(motor.start + qSize * 3,  motor.end,               sampleStep);

        let dx = right - left;
        let dy = down - up;
        const mag = Math.hypot(dx, dy);
        const strength = Math.tanh(mag * 6); // scale into 0..1 with saturation
        if (mag > 0) { dx /= mag; dy /= mag; } else { dx = 0; dy = 0; }
        return { dx, dy, strength };
    }

    selfAwareness() {
        const assoc  = this.layout.association;
        const pfc    = this.layout.prefrontal;
        const motor  = this.layout.motor;
        const visual = this.layout.visual;

        const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
        const needsPressure = 1 - needAverage;
        const assocPeak = this.engine.peakAbs(assoc.start, assoc.end);

        // Scale tonic signal to brain size — small brains have fewer neurons
        // so the same 8-neuron pulse gets diluted much more by meanAbs.
        // Compensate by raising the signal so PFC stays above its threshold (0.20)
        // regardless of how many neurons are in the region.
        const pfcSize = pfc.end - pfc.start;
        const sizeCompensation = Math.max(1.0, Math.sqrt(300_000 / Math.max(1, pfcSize)));
        const tonicSignal = (0.30 + needsPressure * 0.25 + assocPeak * 1.5) * sizeCompensation;

        // Pulse more seed neurons proportional to region size so the signal
        // isn't diluted to nothing when the region is small.
        const seedCount = Math.max(8, Math.min(64, Math.floor(pfcSize / 500)));
        const seedStep  = Math.max(1, Math.floor(pfcSize / seedCount));
        for (let i = 0; i < seedCount; i++) {
            this.engine.pulse(pfc.start + i * seedStep, tonicSignal);
        }

        const pfcStep  = Math.max(1, Math.floor(pfcSize / 2000));
        // meanAbs is inversely proportional to region size — a small brain
        // produces a proportionally smaller mean even with the same total
        // energy injected. Scale the tanh gain to compensate so pfcLevel
        // lands in a useful range regardless of BRAIN_SIZE_GB.
        const pfcGain  = 8 * sizeCompensation;
        const pfcLevel = Math.tanh(this.engine.meanAbs(pfc.start, pfc.end, pfcStep) * pfcGain);

        // Top-down inhibition of sensory/association (attention gating)
        if (pfcLevel > 0.05) {
            const mul = 1 - pfcLevel * 0.12;
            const pot = this.engine.potential;
            for (let i = this.layout.sensory.start; i < this.layout.sensory.end; i += 20) pot[i] *= mul;
            for (let i = assoc.start; i < assoc.end; i += 20) pot[i] *= mul;

            if (this.motorHint) {
                const visualMean = this.engine.meanAbs(visual.start, visual.end, 8);
                const motorSignal = pfcLevel * (0.3 + visualMean * 1.0 + needsPressure * 0.4);
                const qSize = this.motorQuadrantSize();
                const dx = this.motorHint.x;
                const dy = this.motorHint.y;
                const mag = Math.hypot(dx, dy);
                if (mag > 0.01) {
                    const normX = dx / mag;
                    const normY = dy / mag;
                    const xQuadrant = normX >= 0 ? 0 : qSize;
                    const yQuadrant = normY >= 0 ? qSize * 2 : qSize * 3;
                    const xWeight = Math.min(1, Math.abs(normX));
                    const yWeight = Math.min(1, Math.abs(normY));
                    const strength = motorSignal * this.motorHint.intensity;
                    if (xWeight > 0) this.engine.inject(motor.start + xQuadrant, strength * xWeight);
                    if (yWeight > 0) this.engine.inject(motor.start + yQuadrant, strength * yWeight);
                    this.engine.inject(this.layout.association.start + 40, 0.4 + this.motorHint.intensity * 0.4);
                    this.engine.pulse(this.layout.prefrontal.start + 4, 0.5 + this.motorHint.intensity * 0.6);
                }
            }
        }

        // Basal ganglia action selection runs every tick alongside PFC
        this.actionSelection();

        return pfcLevel;
    }

    start(hz = 10) {
        if (this._alive) return;
        this._alive = true;
        this._pulse = setInterval(() => this.engine.tick(), 1000 / hz);
        console.log(`Brain alive at ${hz}hz`);
    }

    stop() {
        clearInterval(this._pulse);
        this._alive = false;
    }
}