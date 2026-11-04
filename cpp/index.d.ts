// Type definitions for neuropile

export interface BrainOptions {
  /** Model size in GB. Default 0.1. */
  sizeGB?: number;
  /** Explicit neuron count. Overrides sizeGB when > 0. */
  neurons?: number;
  /** Synapses reserved per neuron. Default 200. */
  synapsesPerNeuron?: number;
  /** Maximum sampled connections per wiring rule. Default 50000. */
  maxConnections?: number;
  /** Wire the region graph on construction. Default true. */
  wire?: boolean;
  /** Deterministic seed for the JS fallback. */
  seed?: number;
  /** Force the pure-JS core even when the native addon is available. */
  native?: boolean;
  /** Provide a pre-built core instead of constructing one. */
  core?: BrainCore;
  /** Options forwarded to the core when using the Brain wrapper. */
  coreOptions?: BrainOptions;

  // ── Growth ──────────────────────────────────────────────────────────────
  /** Initial neuron count. Alias for `neurons` that reads as growth intent. */
  startNeurons?: number;
  /** Hard cap on total neurons. Defaults to the initial size (no growth). */
  maxNeurons?: number;
  /** Grow automatically on tick. Defaults to true when maxNeurons > start. */
  autoGrow?: boolean;
  /** Neurons added per growth event. Defaults to ~1% of the initial brain. */
  growthBatch?: number;
  /** Ticks between automatic growth events. Default 100. 0 disables the timer. */
  growthInterval?: number;
  /** Synapses wired per direction for each new neuron. Default 8. */
  growthFanout?: number;
  /** Per-region growth multipliers, keyed by region name or given as an array. */
  growthProfile?: Record<string, number> | number[];
}

export interface Region {
  name: string;
  start: number;
  end: number;
  size: number;
  inhibRatio: number;
  threshold: number;
  /** Unscaled Talos base size for this region. Used to apportion growth. */
  baseSize?: number;
  /** Unscaled Talos base size for this region (JS core spelling). */
  base?: number;
}

export interface Needs {
  hunger: number;
  energy: number;
  joy: number;
}

export interface Body {
  x: number;
  y: number;
  heading: number;
  speed: number;
  energy: number;
  [key: string]: number;
}

export interface MotorState {
  moveX: number;
  moveY: number;
  lastAction: string | null;
}

export interface EmotionalState {
  valence: number;
  arousal: number;
  drive: number;
  norepinephrine: number;
  needs: Needs;
  body: Body;
}

export interface BehaviorState {
  valence: number;
  arousal: number;
  drive: number;
  curiosity: number;
  uncertainty: number;
  actionReadiness: number;
  patience: number;
  speechReadiness: number;
  researchDrive: number;
}

export interface MotorIntent {
  dx: number;
  dy: number;
  strength: number;
}

export interface Reafference {
  indices: number[];
  strength: number;
}

export interface MotorHint {
  x: number;
  y: number;
  intensity: number;
  hintMode?: string | null;
}

export interface WorldState {
  body?: Partial<Body> & { vx?: number; vy?: number };
  opticFlow?: { x?: number; y?: number; magnitude?: number };
  motorHint?: MotorHint;
  needs?: Partial<Needs>;
  detections?: Array<{ label?: string; w?: number; [key: string]: unknown }>;
  interaction?: {
    note?: string;
    hungerLevel?: number;
    x?: number;
    y?: number;
    [key: string]: unknown;
  };
}

export interface DecisionOptions {
  activeGoal?: { urgency?: number; [key: string]: unknown } | null;
  humanPresent?: boolean;
  pendingSelfSpeech?: boolean;
  tickCount?: number;
  lastSpokeTick?: number;
}

export interface BehaviorDecision extends BehaviorState {
  canSpeak: boolean;
  shouldResearch: boolean;
  shouldAct: boolean;
  responseMode: 'grounded' | 'speak' | 'quiet';
}

export interface NeuronMapEntry {
  mean: number;
  peak: number;
  firing: number;
}

export interface InternalState {
  [key: string]: number;
}

export interface MemoryNode {
  id: number;
  content: string;
  entities: string[];
  emotion: string;
  salience: number;
  dopamine: number;
  timestamp: number;
  accessed: number;
  accessCount: number;
  type: 'episodic' | 'semantic' | 'procedural' | 'utterance';
  turnId: number | null;
}

export interface RememberOptions {
  entities?: string[];
  emotion?: string;
  salience?: number;
  dopamine?: number;
  type?: MemoryNode['type'];
  turnId?: number | null;
  encodeNeural?: boolean;
  consolidate?: boolean;
  consolidateStrength?: number;
  strength?: number;
  concepts?: boolean;
  sensory?: Record<string, number>;
  conceptEmotion?: Partial<EmotionVector>;
}

export interface RecallOptions {
  emotion?: string;
  topN?: number;
  context?: 'conversation' | 'background' | 'introspect' | 'speech' | string;
  neural?: boolean;
  reafferenceTopN?: number;
}

export interface EmotionVector {
  valence: number;
  arousal: number;
  approach: number;
}

export interface ConceptSnapshot {
  label: string;
  activation: number;
  emotion: EmotionVector;
  topFeatures: string[];
}

export interface WorkingMemorySlot {
  content: string;
  entities: string[];
  type: string;
  strength: number;
  expiresAt: number;
}

export interface Focus {
  topic: string;
  entities: string[];
  source: string;
  strength: number;
  updatedAt: number;
}

export interface Belief {
  id: number;
  topic: string;
  claim: string;
  source: string;
  confidence: number;
  verified: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Deliberation {
  topic: string;
  evidenceCount: number;
  alternatives: Array<{
    claim: string;
    sources: string[];
    confidence: number;
    verified: boolean;
  }>;
  concluded: boolean;
  conclusion: { claim: string; verified: boolean; sources: string[] } | null;
}

export interface MetacognitionSummary {
  recent_accuracy: number | null;
  weights: Record<string, number>;
  last_decisions: Array<{
    intent: string;
    predicted: string;
    confidence: number;
    actual?: string;
    accuracy: number;
    error: Record<string, number>;
  }>;
}

export interface TurnMetrics {
  interrupted?: boolean;
  recalledSalience?: number;
  goalPushed?: boolean;
  goalResolved?: boolean;
}

export interface CoreSnapshot {
  version: number;
  options: BrainOptions;
  regions: Region[];
  engine: Record<string, unknown>;
  state: Record<string, unknown>;
}

export declare class NeuralEngine {
  constructor(neuronCount: number, synapsesPerNeuron?: number);
  readonly n: number;
  readonly activeCount: number;
  potential: Float32Array;
  threshold: Float32Array;
  decayRate: Float32Array;
  firedAt: Float64Array;
  inhibitory: Uint8Array;
  synapseTargets: Uint32Array;
  synapseWeights: Float32Array;
  synapseCounts: Uint32Array;
  dopamine: number;
  norepinephrine: number;
  setThreshold(start: number, end: number, value: number): void;
  setInhibitory(start: number, end: number): void;
  connect(src: number, dst: number, weight: number): void;
  receive(i: number, signal: number): void;
  inject(i: number, signal: number): void;
  pulse(i: number, signal: number): void;
  tick(): void;
  meanAbs(start: number, end: number, step?: number): number;
  peakAbs(start: number, end: number): number;
  activation(start: number, end: number): Float32Array;
  rebuildActiveSet(): void;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class BrainCore {
  constructor(options?: BrainOptions);
  readonly engine: NeuralEngine;
  readonly regions: Region[];
  readonly options: BrainOptions;
  readonly tickCount: number;
  readonly valence: number;
  readonly arousal: number;
  readonly drive: number;
  readonly needs: Needs;
  readonly body: Body;
  readonly motorState: MotorState;
  readonly __native?: boolean;

  readonly neuronCount: number;
  readonly maxNeurons: number;
  readonly canGrow: boolean;
  readonly growthProgress: number;
  readonly growthEvents: number;

  region(name: string): Region | null;
  tick(count?: number): number;
  reward(strength?: number): number;
  punish(strength?: number): number;
  setNeeds(needs?: Partial<Needs>): Needs;
  getNeeds(): Needs;
  getBody(): Body;
  getMotorState(): MotorState;
  setBody(body?: Partial<Body>): void;
  setMotorState(state?: Partial<MotorState>): void;
  setAffect(valence: number, arousal: number, drive: number): void;
  setLastFood(has: boolean, x: number, y: number): void;
  setMotorHint(active: boolean, x: number, y: number, intensity: number, hintMode?: string | null): void;
  setTickCount(value: number): void;
  move(dx?: number, dy?: number, intensity?: number): Body;
  integrateWorldState(state?: WorldState): EmotionalState;
  handleInteraction(kind: string, intensity?: number): Needs;
  amygdalaActivate(threatLevel?: number): number;
  startle(strength?: number): void;
  emotionalState(): EmotionalState;
  behaviorState(): BehaviorState;
  decideBehavior(options?: DecisionOptions): BehaviorDecision;
  actionSelection(): void;
  novelty(): number;
  reafference(topN?: number): Reafference;
  selfAwareness(): number;
  getMotorIntent(): MotorIntent;
  readInternalState(): InternalState;
  neuronMap(): Record<string, NeuronMapEntry>;
  thought(): Float32Array;
  perceive(input: ArrayLike<number>): void;
  perceiveDense(values: ArrayLike<number>): void;
  perceiveVisual(input: ArrayLike<number>): void;
  hear(input: ArrayLike<number>): void;
  hearDense(values: ArrayLike<number>): void;
  encode(input: ArrayLike<number>, strength?: number): void;
  encodeDense(values: ArrayLike<number>, strength?: number): void;
  consolidate(input: ArrayLike<number>, strength?: number): void;
  consolidateDense(values: ArrayLike<number>, strength?: number): void;
  motorQuadrantSize(): number;
  /** Add up to `count` neurons, capped by maxNeurons. Returns how many grew. */
  grow(count?: number): number;
  /** Grow toward a total neuron count. Returns how many grew. */
  growTo(target: number): number;
  /** Apply one automatic growth step if the cadence allows it. */
  maybeGrow(): number;
  start(hz?: number): this;
  stop(): this;
  snapshot(): CoreSnapshot;
  restore(snapshot: CoreSnapshot): this;
}

export declare class MemoryCortex {
  constructor(genome?: Genome | null);
  nodes: MemoryNode[];
  readonly size: number;
  encode(
    content: string,
    entities?: string[],
    emotion?: string,
    salience?: number,
    dopamine?: number,
    type?: MemoryNode['type'],
    turnId?: number | null,
  ): MemoryNode | undefined;
  recall(entities?: string[], emotion?: string, topN?: number, context?: string): MemoryNode[];
  recallByReafference(
    neuralIndices?: ArrayLike<number>,
    entities?: string[],
    emotion?: string,
    topN?: number,
    context?: string,
  ): MemoryNode[];
  recallFact(keyword: string): MemoryNode[];
  format(memories?: MemoryNode[]): string;
  decay(): void;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class ConceptNet {
  readonly size: number;
  activate(word: string, strength?: number, hopDepth?: number): unknown | null;
  learn(
    word: string | null,
    sensory?: Record<string, number>,
    emotion?: Partial<EmotionVector>,
    action?: string | null,
    strength?: number,
  ): unknown | null;
  associate(wordA: string, wordB: string, strength?: number): void;
  emotionOf(word: string): EmotionVector | null;
  activeConceptsSnapshot(topN?: number): ConceptSnapshot[];
  formatForLLM(): string | null;
  netEmotion(): EmotionVector;
  prune(): void;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class WorkingMemory {
  slots: WorkingMemorySlot[];
  focus: Focus | null;
  readonly size: number;
  hold(content: string, entities?: string[], type?: string, strength?: number): void;
  setFocus(topic: string, entities?: string[], source?: string, strength?: number): Focus | null;
  getFocus(): Focus | null;
  clearFocus(): void;
  rehearse(entities?: string[]): void;
  tick(): void;
  read(topN?: number): WorkingMemorySlot[];
  format(): string;
  flush(): void;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class Genome {
  get(key: string): number | null;
  set(key: string, value: number): boolean;
  meta(key: string): { value: number; min: number; max: number; step: number } | null;
  snapshot(): Record<string, number>;
  restore(snapshot: Record<string, number>): void;
  keys(): string[];
}

export declare class Metacognition {
  constructor(genome?: Genome | null);
  log: unknown[];
  weights: Record<string, number>;
  predict(neuralState: Record<string, number>, parsed: Record<string, unknown>, reafStrength: number): unknown;
  observe(record: unknown, neuralStateAfter: Record<string, number>, responseText: string): number;
  recentAccuracy(): number | null;
  summary(): MetacognitionSummary | null;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class Homeostasis {
  constructor(genome: Genome, meta: Metacognition, cortex: MemoryCortex);
  ledger: unknown[];
  recordTurn(metrics: TurnMetrics): void;
  evaluate(): string | null;
  ledgerSummary(n?: number): string | null;
}

export declare class BeliefStore {
  items: Belief[];
  record(input: {
    topic: string;
    claim: string;
    source?: string;
    confidence?: number;
    verified?: boolean;
  }): Belief | null;
  recall(topic: string, limit?: number): Belief[];
  best(topic: string): Belief | null;
  deliberate(topic: string): Deliberation;
  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
}

export declare class Brain {
  constructor(options?: BrainOptions);
  options: BrainOptions;
  genome: Genome;
  core: BrainCore;
  native: boolean;
  memory: MemoryCortex;
  concepts: ConceptNet;
  workingMemory: WorkingMemory;
  metacognition: Metacognition;
  homeostasis: Homeostasis;
  beliefs: BeliefStore;

  readonly engine: NeuralEngine;
  readonly regions: Region[];
  readonly tickCount: number;
  readonly valence: number;
  readonly arousal: number;
  readonly drive: number;
  readonly needs: Needs;
  readonly body: Body;
  readonly motorState: MotorState;
  readonly neuronCount: number;
  readonly maxNeurons: number;
  readonly canGrow: boolean;
  readonly growthProgress: number;
  readonly growthEvents: number;

  tick(count?: number): number;
  step(count?: number): number;

  /** Add up to `count` neurons, capped by maxNeurons. Returns how many grew. */
  grow(count?: number): number;
  /** Grow toward a total neuron count. Returns how many grew. */
  growTo(target: number): number;
  /** Apply one automatic growth step if the cadence allows it. */
  maybeGrow(): number;
  perceive(input: string | ArrayLike<number>, options?: Record<string, unknown>): EmotionalState;
  hear(text: string, options?: RememberOptions & { strength?: number }): EmotionalState;
  see(input: ArrayLike<number>): EmotionalState;

  remember(content: string, options?: RememberOptions): MemoryNode | undefined;
  recall(entities?: string | string[], options?: RecallOptions): MemoryNode[];
  recallFact(keyword: string): MemoryNode[];
  recallText(entities?: string | string[], options?: RecallOptions): string;
  forget(): this;

  activate(word: string, strength?: number): unknown | null;
  learn(
    word: string,
    sensory?: Record<string, number>,
    emotion?: Partial<EmotionVector>,
    action?: string | null,
    strength?: number,
  ): unknown | null;
  associate(wordA: string, wordB: string, strength?: number): EmotionVector | null;
  emotionOf(word: string): EmotionVector | null;
  activeConcepts(topN?: number): ConceptSnapshot[];
  netEmotion(): EmotionVector;

  hold(content: string, entities?: string[], type?: string, strength?: number): this;
  focus(topic: string, entities?: string[], source?: string, strength?: number): Focus | null;
  getFocus(): Focus | null;
  readWorkingMemory(topN?: number): WorkingMemorySlot[];
  rehearse(entities?: string[]): this;

  believe(claim: string, options?: Record<string, unknown>): Belief | null;
  believe(input: {
    topic: string;
    claim: string;
    source?: string;
    confidence?: number;
    verified?: boolean;
  }): Belief | null;
  beliefsAbout(topic: string, limit?: number): Belief[];
  deliberate(topic: string): Deliberation;

  predict(parsed?: Record<string, unknown>, reafStrength?: number): unknown;
  observe(record: unknown, responseText: string): number;
  recordTurn(metrics?: TurnMetrics): string | null;
  tune(): string | null;

  emotionalState(): EmotionalState;
  behaviorState(): BehaviorState;
  motorIntent(): MotorIntent;
  state(): Record<string, unknown>;
  context(): string;

  start(hz?: number): this;
  stop(): this;

  snapshot(): Record<string, unknown>;
  restore(snapshot: Record<string, unknown>): this;
  save(filePath: string, options?: { compress?: boolean }): string;
  load(filePath: string): Record<string, unknown>;
  saveAsync(filePath: string, options?: { compress?: boolean }): Promise<string>;
  loadAsync(filePath: string): Promise<Record<string, unknown>>;

  reward(strength?: number): number;
  punish(strength?: number): number;
  setNeeds(needs?: Partial<Needs>): Needs;
  getNeeds(): Needs;
  getBody(): Body;
  getMotorState(): MotorState;
  move(dx?: number, dy?: number, intensity?: number): Body;
  integrateWorldState(state?: WorldState): EmotionalState;
  handleInteraction(kind: string, intensity?: number): Needs;
  amygdalaActivate(threatLevel?: number): number;
  startle(strength?: number): void;
  decideBehavior(options?: DecisionOptions): BehaviorDecision;
  actionSelection(): void;
  novelty(): number;
  reafference(topN?: number): Reafference;
  selfAwareness(): number;
  getMotorIntent(): MotorIntent;
  readInternalState(): InternalState;
  neuronMap(): Record<string, NeuronMapEntry>;
  thought(): Float32Array;
  perceiveDense(values: ArrayLike<number>): void;
  perceiveVisual(input: ArrayLike<number>): void;
  hearDense(values: ArrayLike<number>): void;
  encode(input: ArrayLike<number>, strength?: number): void;
  encodeDense(values: ArrayLike<number>, strength?: number): void;
  consolidate(input: ArrayLike<number>, strength?: number): void;
  consolidateDense(values: ArrayLike<number>, strength?: number): void;
  motorQuadrantSize(): number;
  region(name: string): Region | null;
}

export declare function createCore(options?: BrainOptions): BrainCore;
export declare function soundPattern(text: string, size?: number): Uint32Array;
export declare function labelHash(label: string): number;
export declare function save(
  brain: Brain | Record<string, unknown>,
  filePath: string,
  options?: { compress?: boolean },
): string;
export declare function load(brain: Brain | null, filePath: string): Record<string, unknown>;

export declare const nativeAvailable: boolean;
export declare const nativeModule: {
  BrainCore: typeof BrainCore;
  NeuralEngine: typeof NeuralEngine;
  soundPattern: typeof soundPattern;
  native: boolean;
  version: string;
} | null;
export declare const nativeError: Error | null;
export declare const nativePath: string | null;
export declare const NativeBrainCore: typeof BrainCore | null;
export declare const NativeNeuralEngine: typeof NeuralEngine | null;
export declare const SENSORY_SIZE: number;
export declare const PATTERN_LENGTH: number;
export declare const VERSION: string;
export declare const persistence: {
  encodeValue(value: unknown): unknown;
  decodeValue(value: unknown): unknown;
  toSerializable(snapshot: unknown): unknown;
  fromSerializable(payload: unknown): unknown;
  save(brain: Brain | Record<string, unknown>, filePath: string, options?: { compress?: boolean }): string;
  load(brain: Brain | null, filePath: string): Record<string, unknown>;
  saveAsync(
    brain: Brain | Record<string, unknown>,
    filePath: string,
    options?: { compress?: boolean },
  ): Promise<string>;
  loadAsync(brain: Brain | null, filePath: string): Promise<Record<string, unknown>>;
};

declare const _default: {
  Brain: typeof Brain;
  BrainCore: typeof BrainCore;
  NativeBrainCore: typeof BrainCore | null;
  NeuralEngine: typeof NeuralEngine;
  NativeNeuralEngine: typeof NeuralEngine | null;
  MemoryCortex: typeof MemoryCortex;
  ConceptNet: typeof ConceptNet;
  WorkingMemory: typeof WorkingMemory;
  Genome: typeof Genome;
  Homeostasis: typeof Homeostasis;
  Metacognition: typeof Metacognition;
  BeliefStore: typeof BeliefStore;
  soundPattern: typeof soundPattern;
  labelHash: typeof labelHash;
  createCore: typeof createCore;
  nativeAvailable: typeof nativeAvailable;
  nativeModule: typeof nativeModule;
  nativeError: typeof nativeError;
  nativePath: typeof nativePath;
  SENSORY_SIZE: typeof SENSORY_SIZE;
  PATTERN_LENGTH: typeof PATTERN_LENGTH;
  VERSION: typeof VERSION;
  persistence: typeof persistence;
  save: typeof save;
  load: typeof load;
};

export default _default;
