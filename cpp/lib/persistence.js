'use strict';

// Snapshot persistence helpers. Snapshots contain typed arrays, Maps, and Sets,
// none of which survive JSON.stringify with their types intact. This module
// encodes them with explicit tags and restores them on load.

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const TYPED_ARRAYS = {
  Float32Array,
  Float64Array,
  Uint8Array,
  Uint16Array,
  Uint32Array,
  Int8Array,
  Int16Array,
  Int32Array,
  BigInt64Array,
  BigUint64Array,
};

function encodeValue(value) {
  if (value == null) return value;

  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return {
      __neuropileType: value.constructor.name,
      data: Buffer.from(value.buffer, value.byteOffset, value.byteLength).toString('base64'),
    };
  }

  if (value instanceof Map) {
    return {
      __neuropileType: 'Map',
      data: [...value.entries()].map(([k, v]) => [encodeValue(k), encodeValue(v)]),
    };
  }

  if (value instanceof Set) {
    return {
      __neuropileType: 'Set',
      data: [...value].map(encodeValue),
    };
  }

  if (Array.isArray(value)) {
    return value.map(encodeValue);
  }

  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = encodeValue(v);
    return out;
  }

  if (typeof value === 'bigint') {
    return { __neuropileType: 'BigInt', data: value.toString() };
  }

  return value;
}

function decodeValue(value) {
  if (value == null) return value;

  if (Array.isArray(value)) {
    return value.map(decodeValue);
  }

  if (typeof value === 'object') {
    // `__talosType` is the legacy tag written by earlier releases.
    const tag = value.__neuropileType || value.__talosType;
    if (tag) {
      if (tag === 'Map') return new Map((value.data || []).map(([k, v]) => [decodeValue(k), decodeValue(v)]));
      if (tag === 'Set') return new Set((value.data || []).map(decodeValue));
      if (tag === 'BigInt') return BigInt(value.data);
      const Ctor = TYPED_ARRAYS[tag];
      if (Ctor) {
        const buf = Buffer.from(value.data, 'base64');
        // Copy into a fresh, aligned buffer before constructing the view.
        const copy = new ArrayBuffer(buf.byteLength);
        new Uint8Array(copy).set(buf);
        return new Ctor(copy);
      }
    }

    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = decodeValue(v);
    return out;
  }

  return value;
}

function toSerializable(snapshot) {
  return {
    format: 'neuropile',
    version: 1,
    savedAt: new Date().toISOString(),
    data: encodeValue(snapshot),
  };
}

function fromSerializable(payload) {
  // `talos-brain` is the legacy format name written by earlier releases.
  if (!payload || (payload.format !== 'neuropile' && payload.format !== 'talos-brain')) {
    throw new Error('not a neuropile snapshot');
  }
  return decodeValue(payload.data);
}

function save(brain, filePath, options = {}) {
  const snapshot = typeof brain.snapshot === 'function' ? brain.snapshot() : brain;
  const payload = toSerializable(snapshot);
  const json = JSON.stringify(payload);
  const resolved = path.resolve(filePath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  if (options.compress === false) {
    fs.writeFileSync(resolved, json, 'utf8');
  } else {
    fs.writeFileSync(resolved, zlib.gzipSync(Buffer.from(json, 'utf8')));
  }
  return resolved;
}

function readPayload(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved);
  // gzip magic bytes 1f 8b
  const text = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
    ? zlib.gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  return JSON.parse(text);
}

function load(brain, filePath) {
  const payload = readPayload(filePath);
  const snapshot = fromSerializable(payload);
  if (brain && typeof brain.restore === 'function') brain.restore(snapshot);
  return snapshot;
}

async function saveAsync(brain, filePath, options = {}) {
  const snapshot = typeof brain.snapshot === 'function' ? brain.snapshot() : brain;
  const payload = toSerializable(snapshot);
  const json = JSON.stringify(payload);
  const resolved = path.resolve(filePath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
  if (options.compress === false) {
    await fs.promises.writeFile(resolved, json, 'utf8');
  } else {
    await fs.promises.writeFile(resolved, zlib.gzipSync(Buffer.from(json, 'utf8')));
  }
  return resolved;
}

async function loadAsync(brain, filePath) {
  const resolved = path.resolve(filePath);
  const raw = await fs.promises.readFile(resolved);
  const text = raw.length >= 2 && raw[0] === 0x1f && raw[1] === 0x8b
    ? zlib.gunzipSync(raw).toString('utf8')
    : raw.toString('utf8');
  const payload = JSON.parse(text);
  const snapshot = fromSerializable(payload);
  if (brain && typeof brain.restore === 'function') brain.restore(snapshot);
  return snapshot;
}

module.exports = {
  encodeValue,
  decodeValue,
  toSerializable,
  fromSerializable,
  save,
  load,
  saveAsync,
  loadAsync,
};
