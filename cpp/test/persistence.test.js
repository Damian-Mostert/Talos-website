'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { Brain, persistence } = require('..');

function tempFile(name) {
  return path.join(os.tmpdir(), `neuropile-${process.pid}-${Date.now()}-${name}.neuropile`);
}

test('encodeValue/decodeValue preserve typed arrays, Maps, and Sets', () => {
  const source = {
    f32: new Float32Array([1.5, -2, 0]),
    u32: new Uint32Array([0, 1, 4294967295]),
    map: new Map([['a', 1], ['b', 2]]),
    set: new Set(['x', 'y']),
    nested: { ok: true, list: [1, 2, 3] },
  };
  const encoded = JSON.parse(JSON.stringify(persistence.encodeValue(source)));
  const decoded = persistence.decodeValue(encoded);

  assert.ok(decoded.f32 instanceof Float32Array);
  assert.deepEqual([...decoded.f32], [1.5, -2, 0]);
  assert.ok(decoded.u32 instanceof Uint32Array);
  assert.deepEqual([...decoded.u32], [0, 1, 4294967295]);
  assert.ok(decoded.map instanceof Map);
  assert.equal(decoded.map.get('b'), 2);
  assert.ok(decoded.set instanceof Set);
  assert.ok(decoded.set.has('y'));
  assert.equal(decoded.nested.list[2], 3);
});

test('Brain save/load round-trips all cognitive layers (compressed)', () => {
  const file = tempFile('roundtrip');
  try {
    const brain = new Brain({ neurons: 3000, seed: 21, native: false });
    brain.hear('hello warm friend');
    brain.remember('fire is warm', { entities: ['fire'], type: 'semantic' });
    brain.hold('fire topic', ['fire'], 'input');
    brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.7 });
    brain.tick(4);

    const resolved = brain.save(file);
    assert.equal(resolved, path.resolve(file));
    assert.ok(fs.statSync(file).size > 0);

    // gzip magic bytes
    const head = fs.readFileSync(file).subarray(0, 2);
    assert.equal(head[0], 0x1f);
    assert.equal(head[1], 0x8b);

    const loaded = new Brain({ neurons: 3000, seed: 22, native: false });
    loaded.load(file);

    assert.equal(loaded.tickCount, brain.tickCount);
    assert.equal(loaded.memory.size, brain.memory.size);
    assert.equal(loaded.concepts.size, brain.concepts.size);
    assert.equal(loaded.workingMemory.size, brain.workingMemory.size);
    assert.equal(loaded.beliefs.items.length, brain.beliefs.items.length);
    assert.deepEqual(loaded.genome.snapshot(), brain.genome.snapshot());
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('uncompressed JSON snapshots still load', () => {
  const file = tempFile('json');
  try {
    const brain = new Brain({ neurons: 2000, seed: 23, native: false });
    brain.remember('plain json memory', { entities: ['json'] });
    brain.save(file, { compress: false });

    const raw = fs.readFileSync(file, 'utf8');
    assert.equal(JSON.parse(raw).format, 'neuropile');

    const loaded = new Brain({ neurons: 2000, seed: 24, native: false });
    loaded.load(file);
    assert.equal(loaded.memory.size, 1);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('legacy talos-brain snapshots still load', () => {
  const file = tempFile('legacy');
  try {
    const brain = new Brain({ neurons: 2000, seed: 23, native: false });
    brain.remember('a memory from before the rename', { entities: ['legacy'] });

    // Rewrite the payload in the old format, including the old value tag.
    const payload = persistence.toSerializable(brain.snapshot());
    payload.format = 'talos-brain';
    const legacy = JSON.parse(JSON.stringify(payload));
    const walk = (value) => {
      if (Array.isArray(value)) return value.forEach(walk);
      if (value && typeof value === 'object') {
        if (value.__neuropileType) {
          value.__talosType = value.__neuropileType;
          delete value.__neuropileType;
        }
        Object.values(value).forEach(walk);
      }
    };
    walk(legacy.data);
    fs.writeFileSync(file, JSON.stringify(legacy));

    const loaded = new Brain({ neurons: 2000, seed: 24, native: false });
    loaded.load(file);
    assert.equal(loaded.memory.size, 1);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});

test('async save/load works', async () => {
  const file = tempFile('async');
  try {
    const brain = new Brain({ neurons: 2000, seed: 25, native: false });
    brain.remember('async memory', { entities: ['async'] });
    await brain.saveAsync(file);

    const loaded = new Brain({ neurons: 2000, seed: 26, native: false });
    await loaded.loadAsync(file);
    assert.equal(loaded.memory.size, 1);
  } finally {
    if (fs.existsSync(file)) fs.unlinkSync(file);
  }
});
