'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pkg = require('..');

test('native addon loads and matches the JS API', {
  skip: pkg.nativeAvailable ? false : 'native addon is not built (run npm run build)',
}, () => {
  assert.ok(pkg.nativeModule);
  assert.equal(pkg.nativeModule.native, true);

  const NativeBrainCore = pkg.nativeModule.BrainCore;
  const core = new NativeBrainCore({ neurons: 4000, seed: 31 });
  assert.equal(core.regions.length, 16);
  assert.ok(core.engine.n > 0);

  core.integrateWorldState({
    body: { x: 0.3, y: 0.4, speed: 0.2 },
    needs: { hunger: 0.4, energy: 0.5, joy: 0.6 },
    detections: [{ label: 'self', w: 0.3 }],
  });
  core.tick(2);

  const emotion = core.emotionalState();
  assert.equal(typeof emotion.valence, 'number');
  assert.equal(typeof emotion.arousal, 'number');
  assert.ok(core.getMotorIntent().strength >= 0);

  // Setter parity with the JS core.
  assert.equal(typeof core.setBody, 'function');
  core.setBody({ x: 0.2, y: 0.3, heading: 0.5, speed: 0.4, energy: 0.6 });
  assert.ok(Math.abs(core.getBody().x - 0.2) < 1e-5);
  core.setMotorState({ moveX: 1, moveY: -1, lastAction: 'move' });
  assert.equal(core.getMotorState().lastAction, 'move');
  core.setAffect(0.3, -0.2, 0.5);
  assert.ok(Math.abs(core.valence - 0.3) < 1e-5);
  core.setTickCount(10);
  assert.equal(core.tickCount, 10);
  core.start(100);
  core.stop();

  const snap = core.snapshot();
  const other = new NativeBrainCore({ neurons: 4000, seed: 32 });
  other.restore(snap);
  assert.equal(other.tickCount, core.tickCount);

  // The native soundPattern must agree with the JS port.
  const nativePattern = pkg.nativeModule.soundPattern('fire', 400000);
  const jsPattern = pkg.soundPattern('fire', 400000);
  assert.deepEqual([...nativePattern], [...jsPattern]);

  // The high-level Brain should use the native core by default.
  const brain = new pkg.Brain({ neurons: 4000, seed: 33 });
  assert.equal(brain.native, true);
  brain.hear('hello warm friend');
  brain.tick(2);
  assert.ok(brain.state().native);
});
