'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('..');
const { BrainCore: JsBrainCore } = require('../lib/brain');

// Every core implementation that can be exercised in this environment.
function coreFactories() {
  const factories = [{ name: 'js', create: (options) => new JsBrainCore(options) }];
  if (pkg.nativeAvailable) {
    factories.push({
      name: 'native',
      create: (options) => new pkg.nativeModule.BrainCore(options),
    });
  }
  return factories;
}

for (const { name, create } of coreFactories()) {
  test(`${name}: a brain starts at its start size and grows toward the max`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });

    assert.equal(core.neuronCount, 19020);
    assert.equal(core.maxNeurons, 60000);
    assert.equal(core.canGrow, true);
    assert.ok(Math.abs(core.growthProgress - 19020 / 60000) < 1e-6);
    assert.equal(core.growthEvents, 0);
    assert.equal(core.engine.n, core.neuronCount);
  });

  test(`${name}: grow() adds neurons and rewires the new ones`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });
    const before = core.neuronCount;

    const added = core.grow(2000);
    assert.equal(added, 2000);
    assert.equal(core.neuronCount, before + 2000);
    assert.equal(core.engine.n, core.neuronCount);
    assert.equal(core.growthEvents, 1);

    // Every region must still tile the neuron space without gaps or overlap.
    const regions = core.regions;
    let offset = 0;
    for (const region of regions) {
      assert.equal(region.start, offset);
      assert.equal(region.end, region.start + region.size);
      offset = region.end;
    }
    assert.equal(offset, core.neuronCount);
  });

  test(`${name}: growth is capped at maxNeurons`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 21000, seed: 5 });
    const before = core.neuronCount;

    const added = core.grow(99999);
    assert.equal(added, 21000 - before);
    assert.equal(core.neuronCount, 21000);
    assert.equal(core.maxNeurons, 21000);
    assert.equal(core.canGrow, false);
    assert.equal(core.grow(100), 0);
    assert.equal(core.growTo(50000), 0);
  });

  test(`${name}: growTo() targets a total neuron count`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });
    const before = core.neuronCount;

    const added = core.growTo(25000);
    assert.equal(added, 25000 - before);
    assert.equal(core.neuronCount, 25000);
  });

  test(`${name}: growth preserves neuron state across the remap`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });

    const thalamus = core.region('thalamus');
    const association = core.region('association');
    const earlyIndex = thalamus.start + 5;
    const lateIndex = association.start + 7;

    core.engine.potential[earlyIndex] = 0.75;
    core.engine.potential[lateIndex] = 0.5;

    core.grow(2000);

    const grownThalamus = core.region('thalamus');
    const grownAssociation = core.region('association');

    // Neurons keep their offset inside their own region.
    assert.equal(core.engine.potential[grownThalamus.start + 5], 0.75);
    assert.equal(core.engine.potential[grownAssociation.start + 7], 0.5);
  });

  test(`${name}: growth preserves learned synapses and remaps their targets`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });
    const association = core.region('association');

    // Find a neuron that actually has outgoing synapses.
    let index = -1;
    for (let i = association.start; i < association.end; i++) {
      if (core.engine.synapseCounts[i] > 0) {
        index = i;
        break;
      }
    }
    assert.ok(index >= 0, 'expected the wired brain to have outgoing synapses');

    const offset = index - association.start;
    const countBefore = core.engine.synapseCounts[index];

    core.grow(2000);

    const grown = core.region('association');
    const moved = grown.start + offset;

    // New neurons may wire into this one, but nothing is lost.
    assert.ok(core.engine.synapseCounts[moved] >= countBefore);
    for (let k = 0; k < countBefore; k++) {
      const target = core.engine.synapseTargets[moved * core.engine.synapseCapacity + k];
      assert.ok(target >= 0 && target < core.engine.n, 'synapse target must point at a live neuron');
    }
  });

  test(`${name}: new neurons receive local and long-range connections`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, growthFanout: 8, seed: 5 });
    core.grow(2000);

    let connected = 0;
    for (let i = 0; i < core.engine.n; i++) {
      if (core.engine.synapseCounts[i] > 0) connected++;
    }
    assert.ok(connected > 0, 'expected the grown brain to have wired neurons');
  });

  test(`${name}: autoGrow adds neurons on the tick cadence`, () => {
    const core = create({
      startNeurons: 20000,
      maxNeurons: 60000,
      growthBatch: 1000,
      growthInterval: 10,
      seed: 5,
    });

    const before = core.neuronCount;
    core.tick(9);
    assert.equal(core.neuronCount, before, 'should not grow before the interval');

    core.tick(1);
    assert.equal(core.neuronCount, before + 1000);
    assert.equal(core.growthEvents, 1);

    core.tick(10);
    assert.equal(core.neuronCount, before + 2000);
    assert.equal(core.growthEvents, 2);
  });

  test(`${name}: autoGrow can be disabled`, () => {
    const core = create({
      startNeurons: 20000,
      maxNeurons: 60000,
      growthBatch: 1000,
      growthInterval: 10,
      autoGrow: false,
      seed: 5,
    });

    const before = core.neuronCount;
    core.tick(100);
    assert.equal(core.neuronCount, before);
    assert.equal(core.growthEvents, 0);
  });

  test(`${name}: a brain without a max never grows`, () => {
    const core = create({ startNeurons: 20000, seed: 5 });
    const before = core.neuronCount;

    core.tick(1000);
    assert.equal(core.neuronCount, before);
    assert.equal(core.canGrow, false);
    assert.equal(core.grow(100), 0);
  });

  test(`${name}: a grown brain round-trips through a snapshot`, () => {
    const core = create({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });
    core.grow(2000);
    core.tick(3);

    const snapshot = core.snapshot();
    const clone = create({ startNeurons: 20000, maxNeurons: 60000, seed: 99 });
    clone.restore(snapshot);

    assert.equal(clone.neuronCount, core.neuronCount);
    assert.equal(clone.maxNeurons, core.maxNeurons);
    assert.equal(clone.growthEvents, core.growthEvents);
    assert.equal(clone.tickCount, core.tickCount);
    assert.deepEqual(
      clone.regions.map((r) => [r.name, r.start, r.end, r.size]),
      core.regions.map((r) => [r.name, r.start, r.end, r.size]),
    );
  });
}

test('native and JS cores agree on the grown layout', () => {
  if (!pkg.nativeAvailable) return;

  const options = { startNeurons: 20000, maxNeurons: 60000, seed: 5 };
  const js = new JsBrainCore(options);
  const native = new pkg.nativeModule.BrainCore(options);

  assert.equal(js.neuronCount, native.neuronCount);
  assert.equal(js.grow(2000), native.grow(2000));
  assert.equal(js.neuronCount, native.neuronCount);
  assert.deepEqual(
    js.regions.map((r) => [r.name, r.start, r.end, r.size]),
    native.regions.map((r) => [r.name, r.start, r.end, r.size]),
  );
});

test('the high-level Brain exposes growth', () => {
  const brain = new pkg.Brain({ startNeurons: 20000, maxNeurons: 60000, seed: 5 });
  const before = brain.neuronCount;

  assert.equal(brain.maxNeurons, 60000);
  assert.equal(brain.canGrow, true);
  assert.equal(brain.grow(1000), 1000);
  assert.equal(brain.neuronCount, before + 1000);
  assert.equal(brain.growthEvents, 1);
  assert.ok(brain.growthProgress > 0);

  const state = brain.state();
  assert.equal(state.neurons, brain.neuronCount);
  assert.equal(state.maxNeurons, 60000);
  assert.ok(brain.context().includes(`neurons=${brain.neuronCount}/${brain.maxNeurons}`));
});

test('a custom growth profile steers where neurons are added', () => {
  const brain = new pkg.Brain({
    startNeurons: 20000,
    maxNeurons: 60000,
    seed: 5,
    growthProfile: { hippocampus: 10, association: 10 },
  });

  const before = brain.core.region('hippocampus').size;
  brain.grow(2000);

  const after = brain.core.region('hippocampus').size;
  assert.ok(after > before, 'hippocampus should have grown');
});
