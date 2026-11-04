'use strict';

// Sensory pattern hashing. Mirrors soundPattern() from core/boot.js: a djb2
// hash of the text is spread into a fixed-size Uint32Array of neuron indices.

const SENSORY_SIZE = 400000;
const PATTERN_LENGTH = 200;
const _patternCache = new Map();

function soundPattern(text, size = SENSORY_SIZE) {
  const key = String(text);
  const cacheKey = `${size}\u0000${key}`;
  if (_patternCache.has(cacheKey)) return _patternCache.get(cacheKey);

  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = (Math.imul(h, 31) ^ key.charCodeAt(i)) >>> 0;
  }

  const indices = new Uint32Array(PATTERN_LENGTH);
  for (let j = 0; j < PATTERN_LENGTH; j++) {
    indices[j] = (Math.imul(h ^ j, 2654435761) >>> 0) % size;
  }

  _patternCache.set(cacheKey, indices);
  return indices;
}

// Deterministic hash used for detection labels in the native core.
function labelHash(label) {
  let hash = 5381;
  const text = String(label).toLowerCase();
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(i);
    hash = hash >>> 0;
  }
  return hash >>> 0;
}

module.exports = { soundPattern, labelHash, SENSORY_SIZE, PATTERN_LENGTH };
