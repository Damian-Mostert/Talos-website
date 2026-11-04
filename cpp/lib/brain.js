'use strict';

// Pure-JavaScript BrainCore. Direct port of the neural/limbic parts of
// core/brain.js, with the same method names as the native BrainCore in
// addon.cpp. The high-level Brain in index.js can use either implementation.

const { NeuralEngine } = require('./engine');

const BASE_REGIONS = [
  ['thalamus', 80000, 0.10, 0.15],
  ['hypothalamus', 50000, 0.05, 0.10],
  ['amygdala', 40000, 0.05, 0.12],
  ['sensory', 400000, 0.20, 0.25],
  ['visual', 100000, 0.15, 0.20],
  ['hippocampus', 160000, 0.15, 0.20],
  ['temporal', 200000, 0.10, 0.25],
  ['association', 600000, 0.20, 0.30],
  ['prefrontal', 300000, 0.10, 0.20],
  ['acc', 120000, 0.18, 0.26],
  ['basalGanglia', 180000, 0.35, 0.32],
  ['motor', 240000, 0.20, 0.35],
  ['cerebellum', 300000, 0.30, 0.30],
  ['vta', 20000, 0.05, 0.08],
  ['locusCoeruleus', 15000, 0.05, 0.08],
  ['raphe', 15000, 0.05, 0.08],
];

const WIRING = [
  ['visual', 'thalamus', 0.8, 0.5, 1.0],
  ['sensory', 'thalamus', 0.8, 0.5, 1.0],
  ['thalamus', 'visual', 0.3, 0.2, 0.5],
  ['thalamus', 'sensory', 0.3, 0.2, 0.5],
  ['thalamus', 'association', 0.6, 0.4, 0.9],
  ['thalamus', 'hippocampus', 0.4, 0.3, 0.7],
  ['prefrontal', 'thalamus', 0.3, 0.2, 0.6],
  ['hypothalamus', 'thalamus', 0.5, 0.4, 0.9],
  ['hypothalamus', 'amygdala', 0.4, 0.3, 0.8],
  ['hypothalamus', 'prefrontal', 0.3, 0.2, 0.6],
  ['hypothalamus', 'vta', 0.4, 0.3, 0.8],
  ['prefrontal', 'hypothalamus', 0.2, 0.1, 0.4],
  ['thalamus', 'amygdala', 0.6, 0.5, 1.0],
  ['sensory', 'amygdala', 0.4, 0.3, 0.8],
  ['visual', 'amygdala', 0.3, 0.3, 0.7],
  ['amygdala', 'thalamus', 0.4, 0.4, 0.8],
  ['amygdala', 'prefrontal', 0.4, 0.3, 0.7],
  ['amygdala', 'acc', 0.4, 0.3, 0.7],
  ['amygdala', 'hippocampus', 0.5, 0.4, 0.9],
  ['amygdala', 'motor', 0.3, 0.3, 0.7],
  ['amygdala', 'locusCoeruleus', 0.4, 0.3, 0.8],
  ['prefrontal', 'amygdala', 0.3, 0.2, 0.5],
  ['hippocampus', 'amygdala', 0.3, 0.2, 0.5],
  ['visual', 'association', 0.5, 0.3, 0.7],
  ['sensory', 'association', 0.5, 0.3, 0.7],
  ['association', 'hippocampus', 0.7, 0.4, 0.9],
  ['hippocampus', 'association', 0.7, 0.4, 0.9],
  ['hippocampus', 'temporal', 0.8, 0.5, 1.0],
  ['temporal', 'hippocampus', 0.6, 0.3, 0.8],
  ['temporal', 'association', 0.6, 0.3, 0.8],
  ['association', 'prefrontal', 0.5, 0.3, 0.8],
  ['prefrontal', 'association', 0.4, 0.2, 0.6],
  ['prefrontal', 'motor', 0.4, 0.3, 0.8],
  ['association', 'motor', 0.4, 0.3, 0.7],
  ['motor', 'cerebellum', 0.5, 0.3, 0.7],
  ['cerebellum', 'motor', 0.5, 0.3, 0.7],
  ['cerebellum', 'sensory', 0.3, 0.2, 0.5],
  ['sensory', 'motor', 0.3, 0.2, 0.6],
  ['association', 'acc', 0.4, 0.3, 0.7],
  ['prefrontal', 'acc', 0.3, 0.2, 0.6],
  ['acc', 'prefrontal', 0.5, 0.4, 0.8],
  ['acc', 'basalGanglia', 0.4, 0.3, 0.7],
  ['acc', 'association', 0.3, 0.2, 0.5],
  ['acc', 'locusCoeruleus', 0.3, 0.2, 0.6],
  ['prefrontal', 'basalGanglia', 0.5, 0.4, 0.9],
  ['association', 'basalGanglia', 0.4, 0.3, 0.7],
  ['hippocampus', 'basalGanglia', 0.3, 0.2, 0.6],
  ['basalGanglia', 'motor', 0.5, 0.4, 0.9],
  ['basalGanglia', 'prefrontal', 0.3, 0.2, 0.5],
  ['basalGanglia', 'thalamus', 0.4, 0.3, 0.7],
  ['vta', 'basalGanglia', 0.5, 0.4, 0.9],
  ['hippocampus', 'vta', 0.3, 0.2, 0.6],
  ['prefrontal', 'vta', 0.2, 0.1, 0.4],
  ['vta', 'prefrontal', 0.4, 0.3, 0.7],
  ['vta', 'hippocampus', 0.4, 0.3, 0.7],
  ['vta', 'association', 0.3, 0.2, 0.5],
  ['locusCoeruleus', 'thalamus', 0.4, 0.3, 0.7],
  ['locusCoeruleus', 'prefrontal', 0.3, 0.2, 0.6],
  ['locusCoeruleus', 'association', 0.3, 0.2, 0.5],
  ['prefrontal', 'raphe', 0.2, 0.1, 0.4],
  ['raphe', 'amygdala', 0.3, 0.2, 0.5],
  ['raphe', 'prefrontal', 0.3, 0.2, 0.5],
  ['raphe', 'association', 0.2, 0.1, 0.4],
  ['raphe', 'basalGanglia', 0.2, 0.1, 0.4],
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function scaledSize(base, scale) {
  return Math.max(4, Math.round((base * scale) / 1000) * 1000);
}

class BrainCore {
  constructor(options = {}) {
    this.options = {
      sizeGB: options.sizeGB != null ? Number(options.sizeGB) : 0.1,
      useExplicitNeurons: options.neurons != null && Number(options.neurons) > 0,
      neurons: options.neurons != null ? Math.max(0, Math.floor(Number(options.neurons))) : 0,
      useStartNeurons: options.startNeurons != null && Number(options.startNeurons) > 0,
      startNeurons: options.startNeurons != null ? Math.max(0, Math.floor(Number(options.startNeurons))) : 0,
      maxNeurons: options.maxNeurons != null ? Math.max(0, Math.floor(Number(options.maxNeurons))) : 0,
      autoGrow: options.autoGrow == null ? null : Boolean(options.autoGrow),
      growthBatch: options.growthBatch != null ? Math.max(0, Math.floor(Number(options.growthBatch))) : 0,
      growthInterval: options.growthInterval != null ? Math.max(0, Math.floor(Number(options.growthInterval))) : null,
      growthFanout: options.growthFanout != null ? Math.max(0, Math.floor(Number(options.growthFanout))) : 0,
      growthProfile: Array.isArray(options.growthProfile) ? options.growthProfile.slice() : null,
      synapsesPerNeuron: options.synapsesPerNeuron != null ? Math.max(1, Math.floor(options.synapsesPerNeuron)) : 200,
      maxConnections: options.maxConnections != null ? Math.max(1, Math.floor(options.maxConnections)) : 50000,
      wire: options.wire !== false,
      seed: options.seed != null ? Number(options.seed) >>> 0 : 0,
      hasSeed: options.seed != null,
    };

    this._random = this.options.hasSeed ? mulberry32(this.options.seed) : Math.random;

    const baseTotal = BASE_REGIONS.reduce((sum, [, size]) => sum + size, 0);
    const scale = this.options.useStartNeurons && this.options.startNeurons > 0
      ? this.options.startNeurons / baseTotal
      : this.options.useExplicitNeurons && this.options.neurons > 0
        ? this.options.neurons / baseTotal
        : this.options.sizeGB / 1.82;

    this.layout = {};
    let offset = 0;
    for (const [name, base, inhibRatio, threshold] of BASE_REGIONS) {
      const size = scaledSize(base, scale);
      this.layout[name] = { name, start: offset, end: offset + size, size, inhibRatio, threshold, base };
      offset += size;
    }
    this.totalNeurons = offset;
    this.engine = new NeuralEngine(this.totalNeurons, this.options.synapsesPerNeuron);

    // Growth defaults. maxNeurons is clamped to the initial size so an
    // explicit cap can never shrink the brain.
    if (!(this.options.maxNeurons > 0) || this.options.maxNeurons < offset) {
      this.options.maxNeurons = offset;
    }
    if (this.options.autoGrow == null) {
      this.options.autoGrow = this.options.maxNeurons > offset;
    }
    if (!(this.options.growthBatch > 0)) {
      this.options.growthBatch = Math.max(1, Math.floor(offset / 100));
    }
    if (this.options.growthInterval == null) {
      this.options.growthInterval = 100;
    }
    if (!(this.options.growthFanout > 0)) {
      this.options.growthFanout = 8;
    }
    this._growthEvents = 0;
    this._lastGrowthTick = 0;

    this._applyRegionProperties();
    if (this.options.wire) this._wire();

    this._baseline = new Float32Array(this.layout.association.size);
    this._baselineAlpha = 0.005;
    this._reafBaseline = new Float32Array(this.layout.association.size);
    this._reafBaselineAlpha = 0.02;

    this._valence = 0;
    this._arousal = 0;
    this._drive = 0;
    this._tickCount = 0;

    this.needs = { hunger: 0.5, energy: 0.5, joy: 0.5 };
    this.body = { x: 0.5, y: 0.48, heading: 0, speed: 0, energy: 0.5 };
    this.motorState = { moveX: 0, moveY: 0, lastAction: null };
    this.motorHint = null;

    this._lastFoodX = null;
    this._lastFoodY = null;
    this._alive = false;
    this._pulse = null;
  }

  get regions() {
    return Object.values(this.layout);
  }

  get tickCount() {
    return this._tickCount;
  }

  get valence() {
    return this._valence;
  }

  get arousal() {
    return this._arousal;
  }

  get drive() {
    return this._drive;
  }

  get neuronCount() {
    return this.totalNeurons;
  }

  get maxNeurons() {
    return this.options.maxNeurons;
  }

  get canGrow() {
    return this.totalNeurons < this.options.maxNeurons;
  }

  get growthProgress() {
    if (!(this.options.maxNeurons > 0)) return 1;
    return Math.max(0, Math.min(1, this.totalNeurons / this.options.maxNeurons));
  }

  get growthEvents() {
    return this._growthEvents;
  }

  get baseline() {
    return this._baseline;
  }

  get reafBaseline() {
    return this._reafBaseline;
  }

  region(name) {
    return this.layout[name] || null;
  }

  _applyRegionProperties() {
    for (const r of this.regions) {
      this.engine.setThreshold(r.start, r.end, r.threshold);
      const inhibEnd = r.start + Math.floor(r.size * r.inhibRatio);
      this.engine.setInhibitory(r.start, inhibEnd);
    }
  }

  _wireRegions(srcName, dstName, density, weightRange = [0.1, 0.8]) {
    const src = this.layout[srcName];
    const dst = this.layout[dstName];
    if (!src || !dst || src.size === 0 || dst.size === 0) return;
    const [wMin, wMax] = weightRange;
    const sampleSize = Math.min(this.options.maxConnections, Math.floor(src.size * density));
    for (let k = 0; k < sampleSize; k++) {
      const i = src.start + Math.floor(this._random() * src.size);
      const j = dst.start + Math.floor(this._random() * dst.size);
      const w = wMin + this._random() * (wMax - wMin);
      this.engine.connect(i, j, w);
    }
  }

  _wire() {
    for (const [src, dst, density, wMin, wMax] of WIRING) {
      this._wireRegions(src, dst, density, [wMin, wMax]);
    }
  }

  // ── Growth ───────────────────────────────────────────────────────────────

  _growthWeights() {
    const defaults = [0.8, 0.4, 0.7, 1.4, 1.2, 3.0, 1.6, 2.6, 2.2, 1.2, 1.0, 1.0, 1.0, 0.3, 0.2, 0.2];
    const custom = Array.isArray(this.options.growthProfile) &&
      this.options.growthProfile.length === this.regions.length;
    return this.regions.map((region, i) => {
      const multiplier = custom ? Number(this.options.growthProfile[i]) : defaults[i];
      return Math.max(0, multiplier || 0) * region.base;
    });
  }

  _distributeGrowth(count) {
    const weights = this._growthWeights();
    const total = weights.reduce((sum, w) => sum + w, 0);
    const additions = new Array(weights.length).fill(0);
    if (weights.length === 0 || count === 0) return additions;
    if (total <= 0) {
      additions[0] = count;
      return additions;
    }

    const remainders = new Array(weights.length).fill(0);
    let assigned = 0;
    for (let i = 0; i < weights.length; i++) {
      const exact = count * (weights[i] / total);
      additions[i] = Math.floor(exact);
      remainders[i] = exact - additions[i];
      assigned += additions[i];
    }

    let left = count - assigned;
    while (left > 0) {
      let best = 0;
      let bestRemainder = -1;
      for (let i = 0; i < remainders.length; i++) {
        if (remainders[i] > bestRemainder) {
          bestRemainder = remainders[i];
          best = i;
        }
      }
      additions[best]++;
      remainders[best] = -1;
      left--;
    }
    return additions;
  }

  _wireNewNeurons(oldRegions, additions) {
    const fanout = this.options.growthFanout || 8;

    for (let idx = 0; idx < this.regions.length; idx++) {
      if (additions[idx] === 0) continue;
      const oldRegion = oldRegions[idx];
      const region = this.layout[this.regions[idx].name];
      const newStart = region.start + oldRegion.size;
      const newEnd = region.end;
      if (newStart >= newEnd) continue;

      for (let neuron = newStart; neuron < newEnd; neuron++) {
        // Local recurrent connections so the newborn is not isolated.
        for (let k = 0; k < fanout; k++) {
          const dst = region.start + Math.floor(this._random() * region.size);
          if (dst === neuron) continue;
          this.engine.connect(neuron, dst, 0.1 + this._random() * 0.4);
        }
        for (let k = 0; k < fanout; k++) {
          const src = region.start + Math.floor(this._random() * region.size);
          if (src === neuron) continue;
          this.engine.connect(src, neuron, 0.1 + this._random() * 0.4);
        }

        // Long-range connections follow the same wiring table as the original
        // brain, so a grown region keeps its role in the circuit.
        for (const [srcName, dstName, , wMin, wMax] of WIRING) {
          if (srcName === region.name) {
            const dstRegion = this.layout[dstName];
            if (dstRegion && dstRegion.size > 0) {
              for (let k = 0; k < fanout; k++) {
                const dst = dstRegion.start + Math.floor(this._random() * dstRegion.size);
                this.engine.connect(neuron, dst, wMin + this._random() * (wMax - wMin));
              }
            }
          }
          if (dstName === region.name) {
            const srcRegion = this.layout[srcName];
            if (srcRegion && srcRegion.size > 0) {
              for (let k = 0; k < fanout; k++) {
                const src = srcRegion.start + Math.floor(this._random() * srcRegion.size);
                this.engine.connect(src, neuron, wMin + this._random() * (wMax - wMin));
              }
            }
          }
        }
      }
    }
  }

  grow(count) {
    const remaining = this.totalNeurons < this.options.maxNeurons
      ? this.options.maxNeurons - this.totalNeurons
      : 0;
    const requested = count == null ? this.options.growthBatch : Math.floor(count);
    const add = Math.max(0, Math.min(requested, remaining));
    if (add === 0) return 0;

    const additions = this._distributeGrowth(add);
    let actualAdd = 0;
    for (const value of additions) actualAdd += value;
    if (actualAdd === 0) return 0;

    const oldRegions = this.regions.map(r => ({ ...r }));
    const oldEngine = this.engine;

    const newLayout = {};
    const remap = new Uint32Array(this.totalNeurons);
    let offset = 0;
    for (let idx = 0; idx < oldRegions.length; idx++) {
      const oldRegion = oldRegions[idx];
      const size = oldRegion.size + additions[idx];
      newLayout[oldRegion.name] = {
        ...oldRegion,
        start: offset,
        end: offset + size,
        size,
      };
      for (let o = 0; o < oldRegion.size; o++) {
        remap[oldRegion.start + o] = offset + o;
      }
      offset += size;
    }

    const next = new NeuralEngine(offset, oldEngine.synapseCapacity);
    next.remapFrom(oldEngine, remap);

    this.engine = next;
    this.layout = newLayout;
    this.totalNeurons = offset;

    this._applyRegionProperties();
    this._wireNewNeurons(oldRegions, additions);

    const assocSize = this.layout.association.size;
    const baseline = new Float32Array(assocSize);
    baseline.set(this._baseline.subarray(0, Math.min(this._baseline.length, assocSize)));
    this._baseline = baseline;
    const reafBaseline = new Float32Array(assocSize);
    reafBaseline.set(this._reafBaseline.subarray(0, Math.min(this._reafBaseline.length, assocSize)));
    this._reafBaseline = reafBaseline;

    this._growthEvents++;
    return actualAdd;
  }

  growTo(target) {
    const wanted = Math.max(0, Math.floor(target));
    if (wanted <= this.totalNeurons) return 0;
    return this.grow(wanted - this.totalNeurons);
  }

  maybeGrow() {
    if (!this.options.autoGrow) return 0;
    if (this.totalNeurons >= this.options.maxNeurons) return 0;
    if (!(this.options.growthInterval > 0)) return 0;
    if (this._tickCount < this._lastGrowthTick + this.options.growthInterval) return 0;
    this._lastGrowthTick = this._tickCount;
    return this.grow(this.options.growthBatch);
  }

  _setRegions(regions) {
    this.layout = {};
    let offset = 0;
    for (const region of regions) {
      const copy = {
        name: region.name,
        start: region.start != null ? region.start : offset,
        end: region.end != null ? region.end : offset + (region.size || 0),
        size: region.size != null ? region.size : (region.end - region.start),
        inhibRatio: region.inhibRatio || 0,
        threshold: region.threshold != null ? region.threshold : 1,
        base: region.base != null ? region.base : (region.baseSize != null ? region.baseSize : (region.size || 0)),
      };
      this.layout[copy.name] = copy;
      offset = copy.end;
    }
    this.totalNeurons = offset;

    const assocSize = this.layout.association ? this.layout.association.size : 0;
    this._baseline = new Float32Array(assocSize);
    this._reafBaseline = new Float32Array(assocSize);
  }

  tick(count = 1) {
    const n = Math.max(1, Math.floor(count));
    for (let i = 0; i < n; i++) {
      this.engine.tick();
      this._tickCount++;
    }
    this.maybeGrow();
    return this._tickCount;
  }

  reward(strength = 1.0) {
    this.engine.dopamine = Math.min(this.engine.dopamine + strength, 3.0);
    return this.engine.dopamine;
  }

  punish(strength = 1.0) {
    this.engine.dopamine = Math.max(this.engine.dopamine - strength, -1.0);
    return this.engine.dopamine;
  }

  setNeeds(needs = {}) {
    this.needs = {
      hunger: clamp(Number(needs.hunger ?? this.needs.hunger) || 0, 0, 1),
      energy: clamp(Number(needs.energy ?? this.needs.energy) || 0, 0, 1),
      joy: clamp(Number(needs.joy ?? this.needs.joy) || 0, 0, 1),
    };
    return this.getNeeds();
  }

  getNeeds() {
    return { ...this.needs };
  }

  getBody() {
    return { ...this.body };
  }

  getMotorState() {
    return { ...this.motorState };
  }

  setBody(body = {}) {
    this.body = { ...this.body, ...body };
  }

  setMotorState(state = {}) {
    this.motorState = { ...this.motorState, ...state };
  }

  setAffect(valence, arousal, drive) {
    this._valence = Number(valence) || 0;
    this._arousal = Number(arousal) || 0;
    this._drive = Number(drive) || 0;
  }

  setLastFood(has, x, y) {
    this._lastFoodX = has ? x : null;
    this._lastFoodY = has ? y : null;
  }

  setMotorHint(active, x, y, intensity, hintMode) {
    this.motorHint = active ? { x, y, intensity, hintMode } : null;
  }

  setTickCount(value) {
    this._tickCount = Math.max(0, Math.floor(Number(value) || 0));
  }

  move(dx = 0, dy = 0, intensity = 1.0) {
    const speed = clamp(intensity, 0, 1);
    const step = 0.10 * speed;
    this.body.x = clamp(this.body.x + dx * step, 0, 1);
    this.body.y = clamp(this.body.y + dy * step, 0, 1);
    if (dx !== 0 || dy !== 0) this.body.heading = Math.atan2(dy, dx);
    this.body.speed = Math.sqrt(dx * dx + dy * dy) * speed;
    this.body.energy = clamp(this.body.energy - 0.01 * speed, 0, 1);
    this.needs.energy = clamp(this.needs.energy - 0.01 * speed, 0, 1);
    this.needs.joy = clamp(this.needs.joy - 0.003 * speed, 0, 1);
    this.motorState = { moveX: dx, moveY: dy, lastAction: 'move' };

    const motor = this.layout.motor;
    const cereb = this.layout.cerebellum;
    const sensory = this.layout.sensory;
    const qSize = this.motorQuadrantSize();

    const rightQ = dx > 0 ? 0 : 1;
    const downQ = dy > 0 ? 2 : 3;
    this.engine.pulse(motor.start + rightQ * qSize, 1.8 * speed);
    this.engine.pulse(motor.start + downQ * qSize, 1.8 * speed);

    this.engine.pulse(cereb.start, 1.4 * speed);
    this.engine.inject(cereb.start + 8, 1.2 * speed);

    this.engine.pulse(sensory.start + 64, 1.6 * speed * Math.abs(dx));
    this.engine.pulse(sensory.start + 72, 1.6 * speed * Math.abs(dy));
    this.engine.inject(sensory.start + 80, 1.2 * speed);

    this.reward(0.06 * speed);
    return this.getBody();
  }

  _tickNeeds() {
    this.needs.hunger = clamp(this.needs.hunger - 0.002, 0, 1);
    this.needs.energy = clamp(this.needs.energy - 0.0015, 0, 1);
    this.needs.joy = clamp(this.needs.joy - 0.0018, 0, 1);
  }

  integrateWorldState(state = {}) {
    const thalamus = this.layout.thalamus;
    const sensory = this.layout.sensory;
    const visual = this.layout.visual;
    const assoc = this.layout.association;
    const motor = this.layout.motor;
    const hypo = this.layout.hypothalamus;

    if (state.body) {
      this.body = { ...this.body, ...state.body };
      const { x, y, heading = 0, speed = 0, vx = 0, vy = 0 } = this.body;
      const borderX = x < 0.12 || x > 0.88 ? 1.3 : 0;
      const borderY = y < 0.12 || y > 0.88 ? 1.3 : 0;
      const bodySignal = 2.6 + Math.max(0, speed) * 1.8;
      this.engine.pulse(thalamus.start + 0, bodySignal * (0.9 + Math.abs(x - 0.5) * 1.4 + borderX));
      this.engine.pulse(thalamus.start + 8, bodySignal * (0.9 + Math.abs(y - 0.5) * 1.4 + borderY));
      this.engine.pulse(thalamus.start + 16, bodySignal * (0.8 + Math.abs(heading) * 0.4 + borderX + borderY));

      const motionSignal = 1.8 + Math.min(1.5, Math.hypot(vx, vy) * 8);
      this.engine.pulse(sensory.start + 88, motionSignal * 1.8);
      this.engine.inject(sensory.start + 96, motionSignal * 1.2);
      this.engine.inject(assoc.start + 12, motionSignal * 0.8);
      this.engine.pulse(thalamus.start + 48, motionSignal * 0.7);
    }

    if (state.opticFlow && typeof state.opticFlow === 'object') {
      const flowX = Number(state.opticFlow.x || 0);
      const flowY = Number(state.opticFlow.y || 0);
      const flowMag = Math.min(1, Math.hypot(flowX, flowY, Number(state.opticFlow.magnitude || 0)));
      if (flowMag > 0.02) {
        const flowDir = Math.atan2(flowY, flowX);
        const visualSize = visual.size;
        const quadrant = ((Math.floor((flowDir + Math.PI) / (Math.PI / 2)) % 4) + 4) % 4;
        const qStep = Math.max(8, Math.floor(visualSize / 16));
        const baseIdx = visual.start + quadrant * qStep;
        this.engine.pulse(baseIdx, 1.4 + flowMag * 2.0);
        this.engine.inject(visual.start + ((quadrant + 2) % 4) * qStep, 0.9 + flowMag * 1.1);
        this.engine.pulse(sensory.start + 112, 1.0 + flowMag * 1.3);
        this.engine.inject(assoc.start + 24, 0.7 + flowMag * 0.8);
        this.engine.pulse(thalamus.start + 56, 0.5 + flowMag * 0.8);
      }
    }

    if (state.motorHint && typeof state.motorHint === 'object' &&
        typeof state.motorHint.x === 'number' && typeof state.motorHint.y === 'number') {
      const x = Number(state.motorHint.x);
      const y = Number(state.motorHint.y);
      const intensity = clamp(Number(state.motorHint.intensity || 1), 0, 1);
      if (x === 0 && y === 0) {
        this.motorHint = null;
      } else {
        this.motorHint = {
          x,
          y,
          intensity,
          hintMode: state.motorHint.hintMode || null,
        };
      }
    } else {
      this.motorHint = null;
    }

    if (state.needs) {
      this.setNeeds(state.needs);
      const needSignal = 2.4 + (1 - (this.needs.hunger + this.needs.energy + this.needs.joy) / 3) * 1.8;
      this.engine.pulse(hypo.start, needSignal * (1.0 + (this.needs.hunger < 0.4 ? 1.2 : 0)));
      this.engine.pulse(hypo.start + 8, needSignal * (1.0 + (this.needs.energy < 0.3 ? 0.9 : 0)));
      this.engine.pulse(hypo.start + 16, needSignal * (1.0 + (this.needs.joy < 0.3 ? 0.7 : 0)));
      this.engine.pulse(thalamus.start + 24, needSignal * (1.0 + (this.needs.hunger < 0.4 ? 0.8 : 0)));
      this.engine.pulse(thalamus.start + 32, needSignal * (1.0 + (this.needs.energy < 0.3 ? 0.6 : 0)));
      this.engine.pulse(thalamus.start + 40, needSignal * (1.0 + (this.needs.joy < 0.3 ? 0.5 : 0)));

      if (this.needs.hunger < 0.4) {
        const pain = (0.4 - this.needs.hunger) * 4.0;
        this.engine.pulse(sensory.start + 32, pain * 2.2);
        this.engine.inject(sensory.start + 40, pain * 1.8);
        this.amygdalaActivate(pain * 0.2);
      }
      if (this.needs.energy < 0.3) {
        const fatigue = (0.3 - this.needs.energy) * 4.0;
        this.engine.pulse(sensory.start + 48, fatigue * 2.0);
      }
      if (this.needs.joy < 0.3) {
        const distress = (0.3 - this.needs.joy) * 4.0;
        this.engine.pulse(sensory.start + 56, distress * 1.8);
        this.punish(distress * 0.05);
      }
      if (this.needs.hunger < 0.5 && this._lastFoodX != null) {
        const toFoodX = this._lastFoodX - this.body.x;
        const toFoodY = this._lastFoodY - this.body.y;
        const hunger = 1 - this.needs.hunger;
        const qSize = this.motorQuadrantSize();
        this.engine.inject(motor.start + (toFoodX > 0 ? 0 : qSize), hunger * 1.2);
        this.engine.inject(motor.start + (toFoodY > 0 ? qSize * 2 : qSize * 3), hunger * 1.2);
      }
    }

    if (Array.isArray(state.detections) && state.detections.length > 0) {
      const stride = Math.max(64, Math.floor(visual.size / 256));
      const span = Math.max(1, visual.size - stride);
      for (const det of state.detections) {
        const label = String(det.label || 'object').toLowerCase();
        let hash = 5381;
        for (let i = 0; i < label.length; i++) {
          hash = ((hash << 5) + hash) ^ label.charCodeAt(i);
          hash = hash >>> 0;
        }
        const idx = visual.start + (hash % span);
        const value = 2.4 + (det.w || 0.2) * 0.8;
        this.engine.pulse(idx, value);
        this.engine.pulse(idx + stride, value * 0.8);
        this.engine.inject(visual.start + Math.floor(visual.size * 0.1) + (hash % 128), value * 0.6);
        this.engine.pulse(thalamus.start + (hash % 32), value * 0.7);
      }
      const hasSalient = state.detections.some(d =>
        d.label === 'self' || d.label === 'violet-glow' ||
        d.label === 'cyan-light' || d.label === 'warm-glow');
      if (hasSalient) {
        this.reward(0.08);
        this.amygdalaActivate(0.15);
      }
    }

    if (state.interaction && state.interaction.note) {
      const note = String(state.interaction.note || '').toLowerCase();
      const isFood = note.includes('feed') || note.includes('food');
      const isPoke = note.includes('poke');
      const isAverse = note.includes('aversive');
      const isDanger = note.includes('danger') || note.includes('hurt');

      if (isFood) {
        const hungerLevel = state.interaction.hungerLevel ?? this.needs.hunger;
        const rawReward = 0.3 + (1 - hungerLevel) * 1.4;
        this.needs.hunger = Math.min(1, this.needs.hunger + 0.28);
        this.needs.joy = Math.min(1, this.needs.joy + 0.06);
        this.reward(rawReward);
        if (state.interaction.x != null) {
          this._lastFoodX = state.interaction.x;
          this._lastFoodY = state.interaction.y;
        }
        this.engine.pulse(thalamus.start, 2.8);
        this.engine.pulse(assoc.start, 2.5);
        this.engine.inject(assoc.start + 8, 1.8);
        this.amygdalaActivate(0.1);
      } else if (isPoke || isAverse || isDanger) {
        this.amygdalaActivate(0.8);
        this.punish(0.4);
        this.needs.energy = Math.max(0, this.needs.energy - 0.05);
        this.needs.joy = Math.max(0, this.needs.joy - 0.04);
        this.engine.pulse(sensory.start + 0, 2.5);
        this.engine.pulse(sensory.start + 8, 2.2);
        this.engine.inject(assoc.start + 0, 2.1);
        this.engine.inject(assoc.start + 8, 1.9);
        const qSize = this.motorQuadrantSize();
        const px = state.interaction.x ?? 0.5;
        const py = state.interaction.y ?? 0.5;
        const awayX = this.body.x < px ? -1 : 1;
        const awayY = this.body.y < py ? -1 : 1;
        this.engine.inject(motor.start + (awayX > 0 ? 0 : qSize), 1.8);
        this.engine.inject(motor.start + (awayY > 0 ? qSize * 2 : qSize * 3), 1.8);
      } else {
        this.handleInteraction(note, 1.0);
        this.engine.pulse(sensory.start, 1.9);
        this.engine.inject(assoc.start, 1.7);
        this.engine.inject(motor.start + 24, 0.6);
      }
    }

    const qSize = this.motorQuadrantSize();
    this.engine.inject(motor.start + 0 * qSize, 0.18);
    this.engine.inject(motor.start + 1 * qSize, 0.18);
    this.engine.inject(motor.start + 2 * qSize, 0.18);
    this.engine.inject(motor.start + 3 * qSize, 0.18);

    return this.emotionalState();
  }

  handleInteraction(kind, intensity = 1.0) {
    this._tickNeeds();
    const strength = clamp(intensity, 0.1, 1.0);

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

  amygdalaActivate(threatLevel = 0.5) {
    const amyg = this.layout.amygdala;
    this.engine.pulse(amyg.start, threatLevel * 2.5);
    this.engine.pulse(amyg.start + 8, threatLevel * 2.0);
    const amygLevel = this.engine.meanAbs(amyg.start, amyg.end, 2);
    if (amygLevel > 0.001) {
      this.startle(Math.min(1.0, amygLevel * 80 * threatLevel));
    }
    return amygLevel;
  }

  startle(strength = 1.0) {
    this.engine.norepinephrine = Math.min(this.engine.norepinephrine + strength, 3.0);
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

  emotionalState() {
    this._tickNeeds();
    const l = this.layout;
    const sensoryMean = this.engine.meanAbs(l.sensory.start, l.sensory.end, 8);
    const assocMean = this.engine.meanAbs(l.association.start, l.association.end, 8);
    const hippMean = this.engine.meanAbs(l.hippocampus.start, l.hippocampus.end, 4);
    const hypothMean = this.engine.meanAbs(l.hypothalamus.start, l.hypothalamus.end, 2);
    const accMean = this.engine.meanAbs(l.acc.start, l.acc.end, 2);
    const rapheMean = this.engine.meanAbs(l.raphe.start, l.raphe.end, 2);

    const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
    const pressure = 1 - needAverage;
    const hypothPressure = Math.tanh(hypothMean * 20 + pressure * 0.5);
    const rawArousal = Math.tanh((sensoryMean + assocMean) * 10 + hypothPressure * 0.35) + 0.1;
    const rawDrive = Math.tanh(hippMean * 15 + hypothPressure * 0.6);
    const serotoninStability = Math.tanh(rapheMean * 30);
    const rawValence = Math.tanh(this.engine.dopamine + 0.2 - pressure * 0.7 * (1 - serotoninStability * 0.3));
    const conflictPenalty = Math.tanh(accMean * 25) * 0.15;

    this._valence = this._valence * 0.7 + (rawValence - conflictPenalty) * 0.3;
    this._arousal = this._arousal * 0.6 + rawArousal * 0.4;
    this._drive = this._drive * 0.8 + rawDrive * 0.2;

    return {
      valence: this._valence,
      arousal: this._arousal,
      drive: this._drive,
      norepinephrine: Math.tanh(this.engine.norepinephrine),
      needs: this.getNeeds(),
      body: this.getBody(),
    };
  }

  behaviorState() {
    const emotional = this.emotionalState();
    const l = this.layout;
    const hypoMean = this.engine.meanAbs(l.hypothalamus.start, l.hypothalamus.end, 2);
    const accMean = this.engine.meanAbs(l.acc.start, l.acc.end, 2);
    const bgMean = this.engine.meanAbs(l.basalGanglia.start, l.basalGanglia.end, 4);
    const vtaMean = this.engine.meanAbs(l.vta.start, l.vta.end, 2);
    const rapheMean = this.engine.meanAbs(l.raphe.start, l.raphe.end, 2);
    const pfcMean = this.engine.meanAbs(l.prefrontal.start, l.prefrontal.end, 8);
    const assocMean = this.engine.meanAbs(l.association.start, l.association.end, 8);
    const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
    const pressure = 1 - needAverage;

    const curiosity = clamp(Math.tanh(hypoMean * 24 + pressure * 0.4 + assocMean * 2 + (1 - Math.abs(emotional.valence)) * 0.2), 0, 1);
    const uncertainty = clamp(Math.tanh(accMean * 22 + emotional.arousal * 0.5 + (1 - Math.abs(emotional.valence)) * 0.25), 0, 1);
    const actionReadiness = clamp(Math.tanh(bgMean * 24 + vtaMean * 16 + emotional.drive * 0.8 + pfcMean * 1.4), 0, 1);
    const patience = clamp(0.45 + Math.tanh(rapheMean * 24) * 0.45 + (1 - emotional.arousal) * 0.1, 0, 1);
    const speechReadiness = clamp(0.1 + emotional.drive * 0.2 + emotional.valence * 0.12 + actionReadiness * 0.16 - uncertainty * 0.18 - emotional.arousal * 0.15 + pfcMean * 0.04, 0, 1);
    const researchDrive = clamp(curiosity * 0.45 + uncertainty * 0.35 + pressure * 0.2 + emotional.drive * 0.2, 0, 1);

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
    const shouldResearch = Boolean(activeGoal && (
      hasUrgentGoal ||
      state.uncertainty > 0.28 ||
      state.researchDrive > 0.34 ||
      options.humanPresent === true
    ));
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
      canSpeak,
      shouldResearch,
      shouldAct: Boolean(activeGoal && state.actionReadiness > 0.3),
      responseMode: shouldResearch ? 'grounded' : canSpeak ? 'speak' : 'quiet',
    };
  }

  actionSelection() {
    const bg = this.layout.basalGanglia;
    const acc = this.layout.acc;
    const motor = this.layout.motor;
    const bgMean = this.engine.meanAbs(bg.start, bg.end, 4);
    if (bgMean < 0.001) return;

    const inhibStrength = Math.tanh(bgMean * 40) * 0.25;
    const pot = this.engine.potential;
    const step = Math.max(4, Math.floor(motor.size / 500));
    for (let i = motor.start; i < motor.end; i += step) {
      pot[i] *= 1 - inhibStrength;
    }

    const bgPeak = this.engine.peakAbs(bg.start, bg.end);
    const conflict = Math.max(0, bgPeak - bgMean * 2);
    if (conflict > 0.01) {
      this.engine.pulse(acc.start, conflict * 1.5);
      this.engine.pulse(acc.start + 8, conflict * 1.2);
    }

    if (bgPeak > 0.05) {
      this.engine.pulse(this.layout.vta.start, bgPeak * 1.2);
    }
  }

  novelty() {
    const { start, end, size } = this.layout.association;
    const pot = this.engine.potential;
    const base = this._baseline;
    const alpha = this._baselineAlpha;
    const step = Math.max(4, Math.floor(size / 2000));
    let diff = 0;
    let count = 0;
    for (let i = start; i < end; i += step) {
      const idx = i - start;
      const v = pot[i];
      const d = v - base[idx];
      diff += d < 0 ? -d : d;
      base[idx] = base[idx] * (1 - alpha) + v * alpha;
      count++;
    }
    return count === 0 ? 0 : Math.tanh(diff / count);
  }

  perceiveVisual(input) {
    const { start, size } = this.layout.visual;
    if (!input || size === 0) return;
    for (let i = 0; i < input.length; i++) {
      this.engine.pulse(start + (input[i] % size), 2.0);
    }
  }

  perceive(input) {
    const { start, size } = this.layout.sensory;
    if (!input || size === 0) return;
    if (input instanceof Uint32Array || input instanceof Int32Array) {
      for (let i = 0; i < input.length; i++) {
        this.engine.inject(start + (input[i] % size), 1.2);
      }
    } else {
      const len = Math.min(input.length, size);
      for (let i = 0; i < len; i++) {
        if (input[i] > 0) this.engine.inject(start + i, input[i]);
      }
    }
  }

  perceiveDense(values) {
    const { start, size } = this.layout.sensory;
    const len = Math.min(values.length, size);
    for (let i = 0; i < len; i++) {
      if (values[i] > 0) this.engine.inject(start + i, values[i]);
    }
  }

  hear(input) {
    const thalamus = this.layout.thalamus;
    const sensory = this.layout.sensory;
    const amygdala = this.layout.amygdala;
    if (!input) return;
    for (let i = 0; i < input.length; i++) {
      this.engine.pulse(thalamus.start + (input[i] % thalamus.size), 2.2);
    }
    for (let i = 0; i < input.length; i++) {
      this.engine.pulse(sensory.start + (input[i] % sensory.size), 1.8);
    }
    this.engine.pulse(amygdala.start, 0.6);
    this.engine.pulse(amygdala.start + 8, 0.4);
  }

  hearDense(values) {
    const thalamus = this.layout.thalamus;
    const sensory = this.layout.sensory;
    const amygdala = this.layout.amygdala;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v <= 0) continue;
      this.engine.pulse(thalamus.start + (i % thalamus.size), 2.2 * v);
      this.engine.pulse(sensory.start + (i % sensory.size), 1.8 * v);
    }
    this.engine.pulse(amygdala.start, 0.6);
    this.engine.pulse(amygdala.start + 8, 0.4);
  }

  encode(input, strength = 1.0) {
    const { start, size } = this.layout.hippocampus;
    if (!input) return;
    if (input instanceof Uint32Array || input instanceof Int32Array) {
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

  encodeDense(values, strength = 1.0) {
    const { start, size } = this.layout.hippocampus;
    const len = Math.min(values.length, size);
    for (let i = 0; i < len; i++) {
      if (values[i] > 0) this.engine.receive(start + i, values[i] * strength);
    }
  }

  consolidate(input, strength = 1.0) {
    const { start, size } = this.layout.temporal;
    if (!input) return;
    if (input instanceof Uint32Array || input instanceof Int32Array) {
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

  consolidateDense(values, strength = 1.0) {
    const { start, size } = this.layout.temporal;
    const len = Math.min(values.length, size);
    for (let i = 0; i < len; i++) {
      if (values[i] > 0) this.engine.receive(start + i, values[i] * strength);
    }
  }

  thought() {
    const { start, end } = this.layout.association;
    return this.engine.activation(start, end).slice();
  }

  reafference(topN = 20) {
    const { start, end, size } = this.layout.association;
    const step = Math.max(1, Math.floor(size / 10000));
    const pot = this.engine.potential;
    const base = this._reafBaseline;
    const alpha = this._reafBaselineAlpha;
    const topIdx = new Int32Array(topN).fill(-1);
    const topVal = new Float32Array(topN);
    let minVal = 0;
    let minPos = 0;
    let filled = 0;

    for (let i = start; i < end; i += step) {
      const idx = i - start;
      const raw = pot[i];
      const dev = raw - base[idx];
      const v = dev < 0 ? -dev : dev;
      base[idx] = base[idx] * (1 - alpha) + raw * alpha;
      if (v === 0) continue;
      if (filled < topN) {
        topIdx[filled] = idx;
        topVal[filled] = v;
        filled++;
        if (filled === topN) {
          minVal = topVal[0];
          minPos = 0;
          for (let k = 1; k < topN; k++) {
            if (topVal[k] < minVal) {
              minVal = topVal[k];
              minPos = k;
            }
          }
        }
      } else if (v > minVal) {
        topIdx[minPos] = idx;
        topVal[minPos] = v;
        minVal = topVal[0];
        minPos = 0;
        for (let k = 1; k < topN; k++) {
          if (topVal[k] < minVal) {
            minVal = topVal[k];
            minPos = k;
          }
        }
      }
    }

    let sum = 0;
    const indices = [];
    for (let k = 0; k < filled; k++) {
      sum += topVal[k];
      indices.push(topIdx[k]);
    }
    return { indices, strength: Math.tanh((filled > 0 ? sum / filled : 0) * 5) };
  }

  readInternalState() {
    const l = this.layout;
    const step = r => Math.max(1, Math.floor((r.end - r.start) / 500));
    return {
      'Ω1': +this.engine.meanAbs(l.association.start, l.association.end, step(l.association)).toFixed(4),
      'Ω2': +this.engine.meanAbs(l.prefrontal.start, l.prefrontal.end, step(l.prefrontal)).toFixed(4),
      'Ω3': +this.engine.meanAbs(l.hippocampus.start, l.hippocampus.end, step(l.hippocampus)).toFixed(4),
      'Ω4': +this.engine.meanAbs(l.sensory.start, l.sensory.end, step(l.sensory)).toFixed(4),
      'Ω5': +this.engine.meanAbs(l.motor.start, l.motor.end, step(l.motor)).toFixed(4),
      'Ω_acc': +this.engine.meanAbs(l.acc.start, l.acc.end, step(l.acc)).toFixed(4),
      'Ω_bg': +this.engine.meanAbs(l.basalGanglia.start, l.basalGanglia.end, step(l.basalGanglia)).toFixed(4),
      'Ω_hypo': +this.engine.meanAbs(l.hypothalamus.start, l.hypothalamus.end, step(l.hypothalamus)).toFixed(4),
      'Ω_da': +this.engine.dopamine.toFixed(3),
      'Ω_ne': +this.engine.norepinephrine.toFixed(3),
    };
  }

  neuronMap() {
    const out = {};
    const pot = this.engine.potential;
    for (const r of this.regions) {
      const regionSize = r.end - r.start;
      if (regionSize === 0) {
        out[r.name] = { mean: 0, peak: 0, firing: 0 };
        continue;
      }
      const step = Math.max(1, Math.floor(regionSize / 500));
      let sum = 0;
      let peak = 0;
      let firingCount = 0;
      let count = 0;
      for (let i = r.start; i < r.end; i += step) {
        const v = Math.abs(pot[i]);
        sum += v;
        if (v > peak) peak = v;
        if (v >= r.threshold) firingCount++;
        count++;
      }
      const mean = count > 0 ? sum / count : 0;
      out[r.name] = {
        mean: Math.tanh((mean / r.threshold) * 3),
        peak: Math.tanh((peak / r.threshold) * 2),
        firing: count > 0 ? firingCount / count : 0,
      };
    }
    return out;
  }

  motorQuadrantSize() {
    return Math.floor(this.layout.motor.size / 4);
  }

  getMotorIntent() {
    const motor = this.layout.motor;
    const qSize = this.motorQuadrantSize();
    const sampleStep = Math.max(8, Math.floor(qSize / 32));
    const right = this.engine.meanAbs(motor.start, motor.start + qSize, sampleStep);
    const left = this.engine.meanAbs(motor.start + qSize, motor.start + qSize * 2, sampleStep);
    const down = this.engine.meanAbs(motor.start + qSize * 2, motor.start + qSize * 3, sampleStep);
    const up = this.engine.meanAbs(motor.start + qSize * 3, motor.end, sampleStep);

    let dx = right - left;
    let dy = down - up;
    const mag = Math.hypot(dx, dy);
    const strength = Math.tanh(mag * 6);
    if (mag > 0) {
      dx /= mag;
      dy /= mag;
    } else {
      dx = 0;
      dy = 0;
    }
    return { dx, dy, strength };
  }

  selfAwareness() {
    const assoc = this.layout.association;
    const pfc = this.layout.prefrontal;
    const motor = this.layout.motor;
    const visual = this.layout.visual;

    const needAverage = (this.needs.hunger + this.needs.energy + this.needs.joy) / 3;
    const needsPressure = 1 - needAverage;
    const assocPeak = this.engine.peakAbs(assoc.start, assoc.end);

    const pfcSize = pfc.end - pfc.start;
    const sizeCompensation = Math.max(1.0, Math.sqrt(300000 / Math.max(1, pfcSize)));
    const tonicSignal = (0.30 + needsPressure * 0.25 + assocPeak * 1.5) * sizeCompensation;

    const seedCount = Math.max(8, Math.min(64, Math.floor(pfcSize / 500)));
    const seedStep = Math.max(1, Math.floor(pfcSize / seedCount));
    for (let i = 0; i < seedCount; i++) {
      this.engine.pulse(pfc.start + i * seedStep, tonicSignal);
    }

    const pfcStep = Math.max(1, Math.floor(pfcSize / 2000));
    const pfcGain = 8 * sizeCompensation;
    const pfcLevel = Math.tanh(this.engine.meanAbs(pfc.start, pfc.end, pfcStep) * pfcGain);

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
          this.engine.inject(assoc.start + 40, 0.4 + this.motorHint.intensity * 0.4);
          this.engine.pulse(this.layout.prefrontal.start + 4, 0.5 + this.motorHint.intensity * 0.6);
        }
      }
    }

    this.actionSelection();
    return pfcLevel;
  }

  start(hz = 10) {
    if (this._alive) return this;
    this._alive = true;
    this._pulse = setInterval(() => this.tick(), 1000 / hz);
    if (this._pulse.unref) this._pulse.unref();
    return this;
  }

  stop() {
    if (this._pulse) clearInterval(this._pulse);
    this._pulse = null;
    this._alive = false;
    return this;
  }

  snapshot() {
    return {
      version: 1,
      options: { ...this.options },
      regions: this.regions.map(r => ({ ...r })),
      engine: this.engine.snapshot(),
      state: {
        tickCount: this._tickCount,
        valence: this._valence,
        arousal: this._arousal,
        drive: this._drive,
        needs: this.getNeeds(),
        body: this.getBody(),
        motorState: this.getMotorState(),
        lastFood: this._lastFoodX == null ? null : [this._lastFoodX, this._lastFoodY],
        motorHint: this.motorHint ? { ...this.motorHint } : null,
        baseline: this._baseline.slice(),
        reafBaseline: this._reafBaseline.slice(),
        growthEvents: this._growthEvents,
        lastGrowthTick: this._lastGrowthTick,
      },
    };
  }

  restore(snapshot) {
    if (!snapshot || !snapshot.engine) throw new Error('restore(snapshot) expects a brain snapshot');

    if (snapshot.options) {
      const o = snapshot.options;
      if (o.startNeurons != null) this.options.startNeurons = o.startNeurons;
      if (o.useStartNeurons != null) this.options.useStartNeurons = o.useStartNeurons;
      if (o.maxNeurons != null) this.options.maxNeurons = o.maxNeurons;
      if (o.autoGrow != null) this.options.autoGrow = o.autoGrow;
      if (o.growthBatch != null) this.options.growthBatch = o.growthBatch;
      if (o.growthInterval != null) this.options.growthInterval = o.growthInterval;
      if (o.growthFanout != null) this.options.growthFanout = o.growthFanout;
      if (o.growthProfile != null) this.options.growthProfile = o.growthProfile;
    }

    // A grown snapshot can be larger than this freshly built core, so rebuild
    // the layout and engine at the snapshot's size before copying state in.
    if (Array.isArray(snapshot.regions) && snapshot.regions.length > 0) {
      this._setRegions(snapshot.regions);
    }
    const capacity = snapshot.engine.synapseCapacity || this.options.synapsesPerNeuron;
    if (!this.engine ||
        this.engine.n !== snapshot.engine.n ||
        this.engine.synapseCapacity !== capacity) {
      this.engine = new NeuralEngine(snapshot.engine.n, capacity);
    }
    this.engine.restore(snapshot.engine);
    this.totalNeurons = snapshot.engine.n;

    const state = snapshot.state || {};
    this.setTickCount(state.tickCount || 0);
    this.setAffect(state.valence || 0, state.arousal || 0, state.drive || 0);
    if (state.needs) this.setNeeds(state.needs);
    if (state.body) this.setBody(state.body);
    if (state.motorState) this.setMotorState(state.motorState);
    if (Array.isArray(state.lastFood)) this.setLastFood(true, state.lastFood[0], state.lastFood[1]);
    else this.setLastFood(false, 0, 0);
    if (state.motorHint) {
      this.setMotorHint(true, state.motorHint.x, state.motorHint.y, state.motorHint.intensity, state.motorHint.hintMode);
    } else {
      this.setMotorHint(false, 0, 0, 1, null);
    }
    if (state.baseline) {
      this._baseline.set(Array.prototype.slice.call(state.baseline, 0, this._baseline.length));
    }
    if (state.reafBaseline) {
      this._reafBaseline.set(Array.prototype.slice.call(state.reafBaseline, 0, this._reafBaseline.length));
    }
    this._growthEvents = state.growthEvents || 0;
    this._lastGrowthTick = state.lastGrowthTick || 0;
    return this;
  }
}

module.exports = { BrainCore, BASE_REGIONS, WIRING };
