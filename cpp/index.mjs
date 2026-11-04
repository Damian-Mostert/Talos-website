import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const mod = require('./index.js');

export const Brain = mod.Brain;
export const BrainCore = mod.BrainCore;
export const NativeBrainCore = mod.NativeBrainCore;
export const NeuralEngine = mod.NeuralEngine;
export const NativeNeuralEngine = mod.NativeNeuralEngine;
export const MemoryCortex = mod.MemoryCortex;
export const ConceptNet = mod.ConceptNet;
export const WorkingMemory = mod.WorkingMemory;
export const Genome = mod.Genome;
export const Homeostasis = mod.Homeostasis;
export const Metacognition = mod.Metacognition;
export const BeliefStore = mod.BeliefStore;
export const soundPattern = mod.soundPattern;
export const labelHash = mod.labelHash;
export const createCore = mod.createCore;
export const nativeAvailable = mod.nativeAvailable;
export const nativeModule = mod.nativeModule;
export const nativeError = mod.nativeError;
export const nativePath = mod.nativePath;
export const SENSORY_SIZE = mod.SENSORY_SIZE;
export const PATTERN_LENGTH = mod.PATTERN_LENGTH;
export const VERSION = mod.VERSION;
export const persistence = mod.persistence;
export const save = mod.save;
export const load = mod.load;

export default mod;
