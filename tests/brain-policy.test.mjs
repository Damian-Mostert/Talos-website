import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain } from '../core/brain.js';

test('brain policy suppresses idle speech and favors research when uncertainty is high', () => {
  const brain = new Brain();
  const idle = brain.decideBehavior({
    activeGoal: null,
    pendingSelfSpeech: false,
    humanPresent: false,
    ticksSinceHuman: 100,
    lastSpokeTick: 0,
    tickCount: 200,
  });

  assert.equal(idle.canSpeak, false);
  assert.equal(idle.shouldResearch, false);

  const uncertain = brain.decideBehavior({
    activeGoal: { topic: 'space', urgency: 0.9 },
    pendingSelfSpeech: false,
    humanPresent: false,
    ticksSinceHuman: 100,
    lastSpokeTick: 0,
    tickCount: 200,
  });

  assert.equal(uncertain.shouldResearch, true);
  assert.equal(uncertain.canSpeak, false);
});
