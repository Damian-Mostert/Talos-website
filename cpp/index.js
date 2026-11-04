'use strict';

// neuropile - a native C++ spiking-neuron core with a Node.js API.
//
// The package loads the compiled N-API addon when it is available. If the
// addon cannot be loaded (no compiler, unsupported platform, or
// `{ native: false }`), it transparently falls back to a pure-JavaScript port
// with the same API. Both paths share the cognitive layers below.

const path = require('node:path');

const { NeuralEngine } = require('./lib/engine');
const { BrainCore: JsBrainCore, BASE_REGIONS } = require('./lib/brain');
const { MemoryCortex } = require('./lib/memory');
const { ConceptNet } = require('./lib/concepts');
const { WorkingMemory } = require('./lib/working-memory');
const { Genome } = require('./lib/genome');
const { Homeostasis } = require('./lib/homeostasis');
const { Metacognition } = require('./lib/metacognition');
const { BeliefStore } = require('./lib/beliefs');
const { soundPattern, labelHash, SENSORY_SIZE, PATTERN_LENGTH } = require('./lib/patterns');
const persistence = require('./lib/persistence');

const VERSION = require('./package.json').version;

function loadNative() {
  const candidates = [
    path.join(__dirname, 'build', 'Release', 'neuropile_core.node'),
    path.join(__dirname, 'build', 'Debug', 'neuropile_core.node'),
    path.join(__dirname, 'prebuilds', `${process.platform}-${process.arch}`, 'neuropile_core.node'),
    // Older builds of this addon shipped under the previous name.
    path.join(__dirname, 'build', 'Release', 'talos_core.node'),
    path.join(__dirname, 'build', 'Debug', 'talos_core.node'),
  ];

  let lastError = null;
  for (const candidate of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const mod = require(candidate);
      return { module: mod, path: candidate, error: null };
    } catch (err) {
      lastError = err;
    }
  }
  return { module: null, path: null, error: lastError };
}

const nativeLoad = loadNative();
const nativeModule = nativeLoad.module;
const nativeAvailable = Boolean(nativeModule && typeof nativeModule.BrainCore === 'function');
const nativeError = nativeLoad.error;
const nativePath = nativeLoad.path;

// The raw native core has no timer of its own. Add the same start/stop
// lifecycle the JS core provides without keeping the event loop alive.
if (nativeAvailable) {
  const timers = new WeakMap();
  const proto = nativeModule.BrainCore.prototype;
  if (typeof proto.start !== 'function') {
    proto.start = function start(hz = 10) {
      if (timers.has(this)) return this;
      const timer = setInterval(() => this.tick(), 1000 / hz);
      if (timer.unref) timer.unref();
      timers.set(this, timer);
      return this;
    };
  }
  if (typeof proto.stop !== 'function') {
    proto.stop = function stop() {
      const timer = timers.get(this);
      if (timer) clearInterval(timer);
      timers.delete(this);
      return this;
    };
  }
}

// Pick the core implementation. Explicit `native: false` forces the JS port.
function normalizeCoreOptions(options = {}) {
  const out = { ...options };
  if (out.growthProfile && !Array.isArray(out.growthProfile)) {
    out.growthProfile = BASE_REGIONS.map(([name]) => {
      const value = out.growthProfile[name];
      return value == null ? 1 : Number(value);
    });
  }
  return out;
}

function createCore(options = {}) {
  const normalized = normalizeCoreOptions(options);
  const useNative = normalized.native !== false && nativeAvailable;
  const Core = useNative ? nativeModule.BrainCore : JsBrainCore;
  const core = new Core(normalized);
  core.__native = useNative;
  return core;
}

const CORE_PROXY_METHODS = [
  'reward', 'punish', 'setNeeds', 'getNeeds', 'getBody', 'getMotorState', 'move',
  'integrateWorldState', 'handleInteraction', 'amygdalaActivate', 'startle',
  'emotionalState', 'behaviorState', 'decideBehavior', 'actionSelection', 'novelty',
  'reafference', 'selfAwareness', 'getMotorIntent', 'readInternalState', 'neuronMap',
  'thought', 'perceive', 'perceiveDense', 'perceiveVisual', 'hear', 'hearDense',
  'encode', 'encodeDense', 'consolidate', 'consolidateDense', 'motorQuadrantSize',
  'region',
];

class Brain {
  constructor(options = {}) {
    const coreOptions = normalizeCoreOptions(options.coreOptions || options);
    this.options = { ...coreOptions };
    this.genome = new Genome();

    this.core = options.core || createCore(coreOptions);
    this.native = Boolean(
      this.core.__native ||
      (nativeAvailable && this.core instanceof nativeModule.BrainCore),
    );

    this.memory = new MemoryCortex(this.genome);
    this.concepts = new ConceptNet();
    this.workingMemory = new WorkingMemory();
    this.metacognition = new Metacognition(this.genome);
    this.homeostasis = new Homeostasis(this.genome, this.metacognition, this.memory);
    this.beliefs = new BeliefStore();

    this._alive = false;
    this._timer = null;
    this._turn = 0;
  }

  // ── Neural substrate ───────────────────────────────────────────────────────

  get engine() { return this.core.engine; }
  get regions() { return this.core.regions; }
  get tickCount() { return this.core.tickCount; }
  get valence() { return this.core.valence; }
  get arousal() { return this.core.arousal; }
  get drive() { return this.core.drive; }
  get needs() { return this.core.needs; }
  get body() { return this.core.body; }
  get motorState() { return this.core.motorState; }
  get neuronCount() { return this.core.neuronCount; }
  get maxNeurons() { return this.core.maxNeurons; }
  get canGrow() { return this.core.canGrow; }
  get growthProgress() { return this.core.growthProgress; }
  get growthEvents() { return this.core.growthEvents; }

  // ── Growth ─────────────────────────────────────────────────────────────────
  // grow() adds neurons up to the maxNeurons cap; growTo() targets a total.
  // Growth is automatic on tick when autoGrow is enabled (the default when a
  // maxNeurons larger than the start size is supplied).
  grow(count) {
    return this.core.grow(count);
  }

  growTo(target) {
    return this.core.growTo(target);
  }

  maybeGrow() {
    return this.core.maybeGrow();
  }

  tick(count = 1) {
    const result = this.core.tick(count);
    this.workingMemory.tick();
    return result;
  }

  step(count = 1) {
    return this.tick(count);
  }

  // ── Perception ─────────────────────────────────────────────────────────────

  // Perceive a stimulus. Strings are treated as words (heard + grounded);
  // typed arrays are sent to the sensory region; plain arrays may be sparse
  // indices or a dense vector (auto-detected).
  perceive(input, options = {}) {
    if (typeof input === 'string') return this.hear(input, options);

    const channel = options.channel || 'sensory';
    if (channel === 'visual') {
      this.core.perceiveVisual(input);
    } else if (channel === 'audio') {
      this.core.hear(input);
    } else if (input && (input instanceof Uint32Array || input instanceof Int32Array)) {
      this.core.perceive(input);
    } else {
      this.core.perceive(input);
    }

    if (options.encode) {
      this.core.encode(input, options.encodeStrength ?? 0.8);
    }
    return this.emotionalState();
  }

  // Hear a word or sentence: hash it into a sensory pattern, drive the
  // thalamus/sensory/amygdala, and activate matching concepts.
  hear(text, options = {}) {
    const words = String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
    for (const word of words) {
      const pattern = soundPattern(word);
      this.core.hear(pattern);
      this.concepts.activate(word, options.strength ?? 1.0);
    }

    // Encode the whole utterance as an episodic trace unless disabled.
    if (options.remember !== false && words.length > 0) {
      this.remember(text, {
        entities: options.entities || words,
        emotion: options.emotion || 'neutral',
        salience: options.salience ?? 0.45,
        type: 'utterance',
        encodeNeural: options.encodeNeural !== false,
      });
    }

    return this.emotionalState();
  }

  see(input) {
    return this.perceive(input, { channel: 'visual' });
  }

  // ── Memory ─────────────────────────────────────────────────────────────────

  remember(content, options = {}) {
    const node = this.memory.encode(
      content,
      options.entities || [],
      options.emotion || 'neutral',
      options.salience ?? 0.5,
      options.dopamine ?? 0,
      options.type || 'semantic',
      options.turnId ?? null,
    );

    if (node && options.encodeNeural !== false) {
      const pattern = soundPattern(content);
      this.core.encode(pattern, options.strength ?? 0.7);
      if (options.consolidate) this.core.consolidate(pattern, options.consolidateStrength ?? 0.5);
    }

    if (node && options.concepts !== false) {
      const words = String(content).toLowerCase().match(/[a-z0-9']+/g) || [];
      for (const word of words) {
        this.concepts.learn(word, options.sensory || {}, options.conceptEmotion || {}, null, options.salience ?? 0.5);
      }
    }

    return node;
  }

  recall(entities = [], options = {}) {
    const query = typeof entities === 'string' ? [entities] : entities;
    const emotion = options.emotion || 'neutral';
    const topN = options.topN ?? 8;
    const context = options.context || 'conversation';

    if (options.neural !== false) {
      const reaf = this.core.reafference(options.reafferenceTopN ?? 20);
      const nodes = this.memory.recallByReafference(reaf.indices, query, emotion, topN, context);
      if (nodes.length > 0 || reaf.indices.length === 0) return nodes;
    }
    return this.memory.recall(query, emotion, topN, context);
  }

  recallFact(keyword) {
    return this.memory.recallFact(keyword);
  }

  recallText(entities = [], options = {}) {
    return this.memory.format(this.recall(entities, options));
  }

  forget() {
    this.memory.decay();
    this.concepts.prune();
    return this;
  }

  // ── Concepts ───────────────────────────────────────────────────────────────

  activate(word, strength = 1.0) {
    return this.concepts.activate(word, strength);
  }

  learn(word, sensory = {}, emotion = {}, action = null, strength = 0.5) {
    const concept = this.concepts.learn(word, sensory, emotion, action, strength);

    // Ground the word in the neural substrate too.
    const pattern = soundPattern(word || String(sensory));
    this.core.perceive(pattern);
    this.core.encode(pattern, strength);

    return concept;
  }

  associate(wordA, wordB, strength = 0.3) {
    this.concepts.associate(wordA, wordB, strength);
    const a = soundPattern(wordA);
    const b = soundPattern(wordB);
    this.core.encode(a, strength);
    this.core.encode(b, strength);
    return this.concepts.emotionOf(wordA);
  }

  emotionOf(word) {
    return this.concepts.emotionOf(word);
  }

  activeConcepts(topN = 8) {
    return this.concepts.activeConceptsSnapshot(topN);
  }

  netEmotion() {
    return this.concepts.netEmotion();
  }

  // ── Working memory ─────────────────────────────────────────────────────────

  hold(content, entities = [], type = 'thought', strength = 1.0) {
    this.workingMemory.hold(content, entities, type, strength);
    return this;
  }

  focus(topic, entities = [], source = 'thought', strength = 1.0) {
    return this.workingMemory.setFocus(topic, entities, source, strength);
  }

  getFocus() {
    return this.workingMemory.getFocus();
  }

  readWorkingMemory(topN) {
    return this.workingMemory.read(topN);
  }

  rehearse(entities = []) {
    this.workingMemory.rehearse(entities);
    return this;
  }

  // ── Beliefs ────────────────────────────────────────────────────────────────

  believe(claim, options = {}) {
    if (typeof claim === 'object' && claim !== null) {
      return this.beliefs.record(claim);
    }
    return this.beliefs.record({ ...options, claim });
  }

  beliefsAbout(topic, limit = 3) {
    return this.beliefs.recall(topic, limit);
  }

  deliberate(topic) {
    return this.beliefs.deliberate(topic);
  }

  // ── Metacognition / homeostasis ────────────────────────────────────────────

  predict(parsed = {}, reafStrength = 0) {
    const neuralState = {
      valence: this.core.valence,
      arousal: this.core.arousal,
      drive: this.core.drive,
      norepinephrine: this.core.emotionalState().norepinephrine,
    };
    return this.metacognition.predict(neuralState, parsed, reafStrength);
  }

  observe(record, responseText) {
    const state = this.core.emotionalState();
    const delta = this.metacognition.observe(record, {
      valence: state.valence,
      arousal: state.arousal,
      norepinephrine: state.norepinephrine,
    }, responseText);
    if (delta > 0) this.core.reward(delta);
    else if (delta < 0) this.core.punish(-delta);
    return delta;
  }

  recordTurn(metrics = {}) {
    this._turn++;
    this.homeostasis.recordTurn(metrics);
    if (this._turn % 20 === 0) return this.homeostasis.evaluate();
    return null;
  }

  tune() {
    return this.homeostasis.evaluate();
  }

  // ── Composite state ────────────────────────────────────────────────────────

  emotionalState() {
    return this.core.emotionalState();
  }

  behaviorState() {
    return this.core.behaviorState();
  }

  motorIntent() {
    return this.core.getMotorIntent();
  }

  state() {
    return {
      tick: this.core.tickCount,
      native: this.native,
      neurons: this.core.neuronCount,
      maxNeurons: this.core.maxNeurons,
      growthProgress: this.core.growthProgress,
      growthEvents: this.core.growthEvents,
      emotion: this.core.emotionalState(),
      behavior: this.core.behaviorState(),
      motorIntent: this.core.getMotorIntent(),
      concepts: this.concepts.activeConceptsSnapshot(8),
      netEmotion: this.concepts.netEmotion(),
      workingMemory: this.workingMemory.read(),
      focus: this.workingMemory.getFocus(),
      memorySize: this.memory.size,
      conceptSize: this.concepts.size,
      beliefs: this.beliefs.items.length,
      internal: this.core.readInternalState(),
    };
  }

  // Compact, model-ready context block. This is data, not prose.
  context() {
    const emotion = this.core.emotionalState();
    const behavior = this.core.behaviorState();
    const concepts = this.concepts.formatForLLM();
    const working = this.workingMemory.format();
    const memories = this.memory.format(this.recall([], { topN: 5 }));
    const ledger = this.homeostasis.ledgerSummary(3);
    const meta = this.metacognition.summary();

    return [
      `NEURAL tick=${this.core.tickCount} native=${this.native} neurons=${this.core.neuronCount}/${this.core.maxNeurons}`,
      `AFFECT valence=${emotion.valence.toFixed(3)} arousal=${emotion.arousal.toFixed(3)} drive=${emotion.drive.toFixed(3)} ne=${emotion.norepinephrine.toFixed(3)}`,
      `BEHAVIOR curiosity=${behavior.curiosity.toFixed(2)} uncertainty=${behavior.uncertainty.toFixed(2)} action=${behavior.actionReadiness.toFixed(2)} speech=${behavior.speechReadiness.toFixed(2)}`,
      `NEEDS hunger=${emotion.needs.hunger.toFixed(2)} energy=${emotion.needs.energy.toFixed(2)} joy=${emotion.needs.joy.toFixed(2)}`,
      `CONCEPTS ${concepts || '(none active)'}`,
      `WORKING MEMORY\n${working}`,
      `MEMORIES\n${memories}`,
      ledger ? `GENOME LEDGER\n${ledger}` : null,
      meta ? `METACOGNITION accuracy=${meta.recent_accuracy}` : null,
    ].filter(Boolean).join('\n');
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  start(hz = 10) {
    if (this._alive) return this;
    this._alive = true;
    this._timer = setInterval(() => this.tick(), 1000 / hz);
    if (this._timer.unref) this._timer.unref();
    return this;
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
    this._alive = false;
    return this;
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  snapshot() {
    return {
      version: 1,
      options: { ...this.options },
      core: this.core.snapshot(),
      genome: this.genome.snapshot(),
      memory: this.memory.snapshot(),
      concepts: this.concepts.snapshot(),
      workingMemory: this.workingMemory.snapshot(),
      metacognition: this.metacognition.snapshot(),
      beliefs: this.beliefs.snapshot(),
      homeostasis: {
        ledger: JSON.parse(JSON.stringify(this.homeostasis.ledger)),
        turnCount: this.homeostasis._turnCount,
      },
    };
  }

  restore(snapshot) {
    if (!snapshot) return this;
    if (snapshot.core) this.core.restore(snapshot.core);
    if (snapshot.genome) this.genome.restore(snapshot.genome);
    if (snapshot.memory) this.memory.restore(snapshot.memory);
    if (snapshot.concepts) this.concepts.restore(snapshot.concepts);
    if (snapshot.workingMemory) this.workingMemory.restore(snapshot.workingMemory);
    if (snapshot.metacognition) this.metacognition.restore(snapshot.metacognition);
    if (snapshot.beliefs) this.beliefs.restore(snapshot.beliefs);
    if (snapshot.homeostasis) {
      this.homeostasis.ledger = snapshot.homeostasis.ledger || [];
      this.homeostasis._turnCount = snapshot.homeostasis.turnCount || 0;
    }
    return this;
  }

  save(filePath, options) {
    return persistence.save(this, filePath, options);
  }

  load(filePath) {
    return persistence.load(this, filePath);
  }

  async saveAsync(filePath, options) {
    return persistence.saveAsync(this, filePath, options);
  }

  async loadAsync(filePath) {
    return persistence.loadAsync(this, filePath);
  }
}

// Pass-through methods that do not need extra cognitive bookkeeping.
for (const name of CORE_PROXY_METHODS) {
  if (typeof Brain.prototype[name] === 'function') continue;
  Brain.prototype[name] = function proxyCoreMethod(...args) {
    return this.core[name](...args);
  };
}

module.exports = {
  Brain,
  BrainCore: JsBrainCore,
  NativeBrainCore: nativeAvailable ? nativeModule.BrainCore : null,
  NeuralEngine,
  NativeNeuralEngine: nativeAvailable ? nativeModule.NeuralEngine : null,
  MemoryCortex,
  ConceptNet,
  WorkingMemory,
  Genome,
  Homeostasis,
  Metacognition,
  BeliefStore,
  soundPattern,
  labelHash,
  createCore,
  nativeAvailable,
  nativeModule,
  nativeError,
  nativePath,
  SENSORY_SIZE,
  PATTERN_LENGTH,
  VERSION,
  persistence,
  save: persistence.save,
  load: persistence.load,
};
