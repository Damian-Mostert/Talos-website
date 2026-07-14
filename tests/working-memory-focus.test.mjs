import test from 'node:test';
import assert from 'node:assert/strict';
import { WorkingMemory } from '../core/working-memory.js';
import { understand, respond } from '../core/llm.js';
import { Consciousness } from '../core/consciousness.js';

test('working memory focus updates and decays cleanly', () => {
  const wm = new WorkingMemory();

  wm.setFocus('universe', ['universe'], 'input', 0.9);
  assert.equal(wm.getFocus().topic, 'universe');
  assert.equal(wm.getFocus().source, 'input');

  wm.setFocus('trust', ['trust'], 'thought', 0.95);
  assert.equal(wm.getFocus().topic, 'trust');
  assert.deepEqual(wm.getFocus().entities, ['trust']);

  const originalDateNow = Date.now;
  global.Date.now = () => originalDateNow() + 40000;
  wm.tick();
  assert.equal(wm.getFocus(), null);
  global.Date.now = originalDateNow;
});

test('understand keeps short topic words as entities', () => {
  const parsed = understand('What is dog?');
  assert.equal(parsed.intent, 'question');
  assert.equal(parsed.topic, 'dog');
  assert.deepEqual(parsed.entities, ['dog']);
});

test('understand uses recent context when the utterance is vague', () => {
  const parsed = understand('What is it?', { recentTopics: ['universe'] });
  assert.equal(parsed.intent, 'question');
  assert.equal(parsed.topic, 'universe');
  assert.deepEqual(parsed.entities, ['universe']);
});

test('understand treats feeling-about questions as questions', () => {
  const parsed = understand('How do you feel about the universe?');
  assert.equal(parsed.intent, 'question');
  assert.equal(parsed.topic, 'universe');
});

test('respond uses internal deliberation before answering questions', () => {
  const parsed = {
    intent: 'question',
    topic: 'universe',
    entities: ['universe'],
    summary: 'What about the universe?',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: null,
    groundingMemories: [],
    internalThoughts: ['I am thinking carefully about the universe and it seems vast and connected.'],
  });
  assert.match(reply.reply, /universe/i);
  assert.match(reply.reply, /thinking|vast|connected/i);
});

test('respond ignores irrelevant internal thoughts for questions', () => {
  const parsed = {
    intent: 'question',
    topic: 'universe',
    entities: ['universe'],
    summary: 'What is the universe?',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: null,
    groundingMemories: [],
    internalThoughts: ['I think learning relates to danger and protection.'],
  });
  assert.doesNotMatch(reply.reply, /danger/i);
  assert.match(reply.reply, /universe|wonder|interesting|looking/i);
});

test('respond drops unrelated learned replies for question topics', () => {
  const parsed = {
    intent: 'question',
    topic: 'universe',
    entities: ['universe'],
    summary: 'What is the universe?',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: {
      recall: () => [{ type: 'utterance', content: 'Fear is a signal of danger and protection.', entities: ['question'] }],
    },
    groundingMemories: [],
    internalThoughts: [],
  });
  assert.doesNotMatch(reply.reply, /fear|danger|protection/i);
  assert.match(reply.reply, /still learning|universe|need more context/i);
});

test('respond composes question answers from recalled utterances', () => {
  const parsed = {
    intent: 'question',
    topic: 'universe',
    entities: ['universe'],
    summary: 'What is the universe?',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: {
      recall: () => [{ type: 'utterance', content: 'I want to understand the universe better.', entities: ['question'] }],
    },
    groundingMemories: [],
    internalThoughts: [],
  });
  assert.match(reply.reply, /understand|universe/i);
  assert.doesNotMatch(reply.reply, /^about/i);
});

test('respond stays conservative when a question has no grounding', () => {
  const parsed = {
    intent: 'question',
    topic: 'universe',
    entities: ['universe'],
    summary: 'What is the universe?',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: null,
    groundingMemories: [],
    internalThoughts: [],
  });
  assert.match(reply.reply, /still learning|need more context|gather more context|learning about/i);
});

test('respond uses learned utterances instead of hardcoded statement templates', () => {
  const parsed = {
    intent: 'statement',
    topic: 'anger',
    entities: ['anger'],
    summary: 'anger is important',
    emotion: 'neutral',
  };
  const reply = respond(parsed, {
    neuralState: { valence: 0 },
    cortex: {
      recall: () => [{ type: 'utterance', content: 'I keep noticing anger in the room.', entities: ['statement'] }],
    },
    groundingMemories: [],
    internalThoughts: [],
  });
  assert.match(reply.reply, /anger|room|noticing/i);
  assert.doesNotMatch(reply.reply, /I hear you about/i);
});

test('awaitResearchForTopic returns fresh grounding facts when research completes', async () => {
  const brain = {
    reward() {},
    punish() {},
    move() {},
    integrateWorldState() {},
    getBody() { return { x: 0, y: 0 }; },
    getNeeds() { return {}; },
    startle() {},
    reafference() { return { strength: 0, indices: [] }; },
    readInternalState() { return { Ω1: 0, Ω2: 0, Ω3: 0, Ω4: 0, Ω_da: 0 }; },
  };
  const ui = { brainThinks() {}, updateState() {} };
  const consciousness = new Consciousness(brain, ui);
  consciousness._fireResearch = async () => {
    await new Promise(resolve => setTimeout(resolve, 5));
    return { facts: 'space is vast and mostly empty' };
  };

  const result = await consciousness._awaitResearchForTopic('space', ['space'], null, 100);
  assert.deepEqual(result, { facts: 'space is vast and mostly empty' });
});
