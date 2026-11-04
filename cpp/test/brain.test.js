'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BrainCore, Brain } = require('..');

test('BrainCore builds the full region layout', () => {
  const core = new BrainCore({ neurons: 4000, seed: 1 });
  assert.equal(core.regions.length, 16);
  assert.ok(core.engine.n > 0);
  assert.equal(core.regions.reduce((sum, r) => sum + r.size, 0), core.engine.n);

  const names = core.regions.map(r => r.name);
  assert.ok(names.includes('thalamus'));
  assert.ok(names.includes('amygdala'));
  assert.ok(names.includes('prefrontal'));
  assert.ok(names.includes('basalGanglia'));
  assert.ok(names.includes('locusCoeruleus'));
});

test('tick advances the clock and reward/punish move dopamine', () => {
  const core = new BrainCore({ neurons: 2000, seed: 2 });
  assert.equal(core.tick(3), 3);
  assert.equal(core.tickCount, 3);

  const up = core.reward(0.5);
  assert.ok(up > 0);
  const down = core.punish(2);
  assert.ok(down < up);
});

test('needs clamp and move updates the body', () => {
  const core = new BrainCore({ neurons: 2000, seed: 3 });
  core.setNeeds({ hunger: 5, energy: -2, joy: 0.4 });
  const needs = core.getNeeds();
  assert.equal(needs.hunger, 1);
  assert.equal(needs.energy, 0);
  assert.equal(needs.joy, 0.4);

  const before = core.getBody();
  const after = core.move(1, 0, 1);
  assert.ok(after.x > before.x);
  assert.equal(core.getMotorState().lastAction, 'move');
});

test('world state integration produces emotion and behavior', () => {
  const core = new BrainCore({ neurons: 4000, seed: 4 });
  const emotion = core.integrateWorldState({
    body: { x: 0.2, y: 0.3, heading: 0.5, speed: 0.4, vx: 0.1, vy: 0.2 },
    needs: { hunger: 0.2, energy: 0.5, joy: 0.6 },
    detections: [{ label: 'self', w: 0.4 }, { label: 'violet-glow', w: 0.3 }],
    interaction: { note: 'feed', hungerLevel: 0.2, x: 0.4, y: 0.4 },
  });

  assert.equal(typeof emotion.valence, 'number');
  assert.equal(typeof emotion.arousal, 'number');
  assert.equal(typeof emotion.drive, 'number');
  assert.ok(emotion.needs.hunger > 0.2);

  const behavior = core.behaviorState();
  for (const key of ['curiosity', 'uncertainty', 'actionReadiness', 'patience', 'speechReadiness', 'researchDrive']) {
    assert.ok(behavior[key] >= 0 && behavior[key] <= 1, `${key} in range`);
  }

  const decision = core.decideBehavior({ humanPresent: true, pendingSelfSpeech: true, tickCount: 100, lastSpokeTick: 0 });
  assert.ok(['grounded', 'speak', 'quiet'].includes(decision.responseMode));
});

test('motor intent and internal state are well formed', () => {
  const core = new BrainCore({ neurons: 4000, seed: 5 });
  core.move(1, -1, 0.8);
  const intent = core.getMotorIntent();
  assert.ok(intent.strength >= 0 && intent.strength <= 1);
  assert.equal(typeof intent.dx, 'number');
  assert.equal(typeof intent.dy, 'number');

  const internal = core.readInternalState();
  assert.equal(typeof internal['Ω1'], 'number');
  assert.equal(typeof internal['Ω_da'], 'number');

  const map = core.neuronMap();
  assert.equal(Object.keys(map).length, 16);
  assert.ok(map.motor.firing >= 0 && map.motor.firing <= 1);
});

test('core snapshot and restore round-trips neural state', () => {
  const core = new BrainCore({ neurons: 2000, seed: 6 });
  core.integrateWorldState({ needs: { hunger: 0.3 }, body: { x: 0.25 } });
  core.tick(2);
  const snap = core.snapshot();

  const other = new BrainCore({ neurons: 2000, seed: 7 });
  other.restore(snap);
  assert.equal(other.tickCount, core.tickCount);
  assert.equal(other.getNeeds().hunger, core.getNeeds().hunger);
  assert.equal(other.getBody().x, core.getBody().x);
  assert.equal(other.engine.dopamine, core.engine.dopamine);
});

test('high-level Brain wires perception, memory, concepts, and beliefs', () => {
  const brain = new Brain({ neurons: 5000, seed: 11, native: false });

  const emotion = brain.hear('hello warm safe friend');
  assert.equal(typeof emotion.valence, 'number');
  assert.ok(brain.activeConcepts(5).some(c => c.label === 'warm'));

  const node = brain.remember('the fire is warm and safe', {
    entities: ['fire', 'warm'],
    emotion: 'happy',
    type: 'episodic',
    turnId: 1,
  });
  assert.ok(node && node.id >= 0);
  assert.ok(brain.recall(['fire'], { neural: false }).length >= 1);
  assert.match(brain.recallText(['fire']), /fire is warm/);

  brain.hold('talking about fire', ['fire'], 'input');
  assert.equal(brain.readWorkingMemory().length, 1);
  assert.equal(brain.focus('fire', ['fire']).topic, 'fire');

  brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });
  brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', confidence: 0.8, verified: true });
  const deliberation = brain.deliberate('fire');
  assert.ok(deliberation.evidenceCount >= 2);
  assert.equal(deliberation.concluded, true);

  const concept = brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4, arousal: 0.3, approach: 0.2 }, 'watch', 0.6);
  assert.ok(concept);
  assert.ok(brain.emotionOf('ember').valence > 0);

  brain.associate('ember', 'fire', 0.4);
  assert.ok(brain.netEmotion().valence >= 0);

  const context = brain.context();
  assert.match(context, /NEURAL/);
  assert.match(context, /CONCEPTS/);

  const state = brain.state();
  assert.equal(state.native, false);
  assert.ok(state.tick >= 0);
});

test('Brain start/stop and metacognition loop', () => {
  const brain = new Brain({ neurons: 3000, seed: 12, native: false });
  brain.start(100);
  brain.stop();
  assert.equal(brain._alive, false);

  const record = brain.predict({ intent: 'question', emotion: 'happy' }, 0.6);
  assert.ok(record);
  const delta = brain.observe(record, 'because the fire is warm?');
  assert.equal(typeof delta, 'number');
  assert.ok(brain.metacognition.summary());
});
