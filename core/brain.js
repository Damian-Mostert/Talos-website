import { NeuralEngine } from './engine.js';

// ── Brain size setting ────────────────────────────────────────────────────────
// Adjust this to control total RAM used by the brain snapshot.
// 1.82 GB = baseline (2.42M neurons). Scale is linear.
// With 16GB RAM + Ollama 3.2 (~2GB): 4–6 GB is comfortable.
const BRAIN_SIZE_GB = Number(process.env.NEXT_PUBLIC_BRAIN_SIZE ?? 0.1);  // 1.82 GB = baseline (2.42M neurons). Scale is linear.
const SCALE = BRAIN_SIZE_GB / 1.82;

function s(n) { return Math.round(n * SCALE / 1000) * 1000; } // scale + round to nearest 1k

const REGIONS = {
    thalamus:     { size: s( 80_000), inhibRatio: 0.10, threshold: 0.15 },
    amygdala:     { size: s( 40_000), inhibRatio: 0.05, threshold: 0.12 },
    sensory:      { size: s(400_000), inhibRatio: 0.20, threshold: 0.25 },
    visual:       { size: s(100_000), inhibRatio: 0.15, threshold: 0.20 },
    association:  { size: s(600_000), inhibRatio: 0.20, threshold: 0.30 },
    hippocampus:  { size: s(160_000), inhibRatio: 0.15, threshold: 0.20 },
    temporal:     { size: s(200_000), inhibRatio: 0.10, threshold: 0.25 },
    prefrontal:   { size: s(300_000), inhibRatio: 0.10, threshold: 0.20 },
    motor:        { size: s(240_000), inhibRatio: 0.20, threshold: 0.35 },
    cerebellum:   { size: s(300_000), inhibRatio: 0.30, threshold: 0.30 },
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
        const MAX_CONNECTIONS = Number(process.env.NEXT_PUBLIC_BRAIN_MAX_CONNECTIONS ?? 50_000);
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
        // ── Thalamus: relay gate ────────────────────────────────────────────────────
        // All sensory/visual input arrives here first. PFC gates it top-down.
        this._wireRegions('visual',      'thalamus',     0.8, [0.5, 1.0]);
        this._wireRegions('sensory',     'thalamus',     0.8, [0.5, 1.0]);
        this._wireRegions('thalamus',    'visual',       0.3, [0.2, 0.5]);  // thalamocortical feedback
        this._wireRegions('thalamus',    'sensory',      0.3, [0.2, 0.5]);
        this._wireRegions('thalamus',    'association',  0.6, [0.4, 0.9]);  // relay → cortex
        this._wireRegions('thalamus',    'hippocampus',  0.4, [0.3, 0.7]);
        this._wireRegions('prefrontal',  'thalamus',     0.3, [0.2, 0.6]);  // PFC gates the relay
        // ── Amygdala: threat and salience detector ────────────────────────────────
        // Fast "low road": thalamus → amygdala (before cortex processes it)
        // Slow "high road": sensory cortex → amygdala (detailed evaluation)
        this._wireRegions('thalamus',    'amygdala',     0.6, [0.5, 1.0]);
        this._wireRegions('sensory',     'amygdala',     0.4, [0.3, 0.8]);
        this._wireRegions('visual',      'amygdala',     0.3, [0.3, 0.7]);
        this._wireRegions('amygdala',    'thalamus',     0.4, [0.4, 0.8]);  // amplify threat in relay
        this._wireRegions('amygdala',    'prefrontal',   0.4, [0.3, 0.7]);  // alert PFC
        this._wireRegions('amygdala',    'hippocampus',  0.5, [0.4, 0.9]);  // emotional memory encoding
        this._wireRegions('amygdala',    'motor',        0.3, [0.3, 0.7]);  // fight/flight motor bias
        this._wireRegions('prefrontal',  'amygdala',     0.3, [0.2, 0.5]);  // PFC suppresses amygdala
        this._wireRegions('hippocampus', 'amygdala',     0.3, [0.2, 0.5]);  // memory context modulates threat
        // ── Cortical feedforward ─────────────────────────────────────────────────────────────
        this._wireRegions('visual',      'association',  0.5, [0.3, 0.7]);
        this._wireRegions('sensory',     'association',  0.5, [0.3, 0.7]);
        this._wireRegions('association', 'hippocampus',  0.7, [0.4, 0.9]);
        this._wireRegions('hippocampus', 'association',  0.7, [0.4, 0.9]);
        this._wireRegions('hippocampus', 'temporal',     0.8, [0.5, 1.0]);
        this._wireRegions('temporal',    'hippocampus',  0.6, [0.3, 0.8]);
        this._wireRegions('temporal',    'association',  0.6, [0.3, 0.8]);
        this._wireRegions('association', 'prefrontal',   0.5, [0.3, 0.8]);
        this._wireRegions('prefrontal',  'association',  0.4, [0.2, 0.6]);
        this._wireRegions('prefrontal',  'motor',        0.4, [0.3, 0.8]);
        this._wireRegions('association', 'motor',        0.4, [0.3, 0.7]);
        this._wireRegions('motor',       'cerebellum',   0.5, [0.3, 0.7]);
        this._wireRegions('cerebellum',  'motor',        0.5, [0.3, 0.7]);
        this._wireRegions('cerebellum',  'sensory',      0.3, [0.2, 0.5]);
        this._wireRegions('sensory',     'motor',        0.3, [0.2, 0.6]);
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
            // Interoceptive needs route through thalamus → association
            const thalamus = this.layout.thalamus;
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
    // This is the ground truth mood. Consciousness reads this, not the other way around.
    //
    // valence  = dopamine level (positive/negative affect)
    // arousal  = mean absolute activation across sensory + association (how activated)
    // drive    = hippocampus activity (memory engagement = motivation to act)
    emotionalState() {
        this._tickNeeds();

        const sensoryMean = this.engine.meanAbs(this.layout.sensory.start,    this.layout.sensory.end,    8);
        const assocMean   = this.engine.meanAbs(this.layout.association.start, this.layout.association.end, 8);
        const hippMean    = this.engine.meanAbs(this.layout.hippocampus.start, this.layout.hippocampus.end, 4);
        const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
        const pressure = 1 - needAverage;

        // Arousal: how much is firing overall, plus a tonic floor for baseline wakefulness
        const rawArousal = Math.tanh((sensoryMean + assocMean) * 10 + pressure * 0.35) + 0.1;

        // Drive: hippocampus engagement — memory being activated = something matters,
        // but low needs also increase urgency to act.
        const rawDrive = Math.tanh(hippMean * 15 + pressure * 0.6);

        // Valence: dopamine is the direct signal, but unmet needs pull it down.
        const rawValence = Math.tanh(this.engine.dopamine + 0.2 - pressure * 0.7);

        // Smooth with previous state (emotional inertia — moods don't flip instantly)
        // Arousal uses faster smoothing so real activation registers promptly
        this._valence = this._valence * 0.7 + rawValence * 0.3;
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
        const { association, prefrontal, hippocampus, sensory, motor } = this.layout;
        return {
            Ω1: +this.engine.meanAbs(association.start, association.end, 8).toFixed(4),
            Ω2: +this.engine.meanAbs(prefrontal.start,  prefrontal.end,  4).toFixed(4),
            Ω3: +this.engine.meanAbs(hippocampus.start, hippocampus.end, 4).toFixed(4),
            Ω4: +this.engine.meanAbs(sensory.start,     sensory.end,     8).toFixed(4),
            Ω5: +this.engine.meanAbs(motor.start,       motor.end,       4).toFixed(4),
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

        // Tonic PFC drive: needs pressure + association peak.
        // PFC has baseline self-sustaining activity in a real brain — it doesn't
        // wait for association to overflow. Needs pressure is the floor.
        const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
        const needsPressure = 1 - needAverage;  // 0 = fully satisfied, 1 = desperate
        const assocPeak = this.engine.peakAbs(assoc.start, assoc.end);
        // Tonic floor must exceed PFC threshold (0.20) so PFC is always minimally active.
        // 0.30 baseline + needs pressure + association activity.
        const tonicSignal = 0.30 + needsPressure * 0.25 + assocPeak * 1.5;

        // Drive PFC with tonic signal — 8 seed neurons pulse and propagate into motor
        for (let i = 0; i < 8; i++) {
            this.engine.pulse(pfc.start + i * Math.floor(pfc.size / 8), tonicSignal);
        }

        const pfcStep = Math.max(4, Math.floor(pfc.size / 2000));
        const pfcLevel = Math.tanh(this.engine.meanAbs(pfc.start, pfc.end, pfcStep) * 8);

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

                    if (xWeight > 0) {
                        this.engine.inject(motor.start + xQuadrant, strength * xWeight);
                    }
                    if (yWeight > 0) {
                        this.engine.inject(motor.start + yQuadrant, strength * yWeight);
                    }
                    this.engine.inject(this.layout.association.start + 40, 0.4 + this.motorHint.intensity * 0.4);
                    this.engine.pulse(this.layout.prefrontal.start + 4, 0.5 + this.motorHint.intensity * 0.6);
                }
            }
        }

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