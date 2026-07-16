import test from 'node:test';
import assert from 'node:assert/strict';
import { BeliefStore } from '../core/beliefs.js';
import { respond, speak, think } from '../core/llm.js';

test('beliefs preserve provenance and rank verified claims first', () => {
  const beliefs = new BeliefStore();
  beliefs.record({ topic: 'talos', claim: 'Talos is a prototype.', source: 'human', confidence: 0.4 });
  beliefs.record({ topic: 'talos', claim: 'Talos runs in the browser.', source: 'documentation', confidence: 0.9, verified: true });
  assert.equal(beliefs.best('talos').verified, true);
  assert.equal(beliefs.best('talos').claim, 'Talos runs in the browser.');
});

test('a conclusion requires verified evidence or independent agreement', () => {
  const beliefs = new BeliefStore();
  beliefs.record({ topic: 'orbit', claim: 'An orbit is a repeating path around a body.', source: 'generated research', confidence: 0.35 });
  assert.equal(beliefs.deliberate('orbit').concluded, false);
  beliefs.record({ topic: 'orbit', claim: 'An orbit is a repeating path around a body.', source: 'human observation', confidence: 0.7 });
  assert.equal(beliefs.deliberate('orbit').concluded, true);
});

test('unverified beliefs are available for reflection but not stated as facts', () => {
  const reply = respond(
    { intent: 'question', topic: 'chapies', entities: ['chapies'], emotion: 'neutral', summary: 'what is chapies?' },
    { beliefs: [{ topic: 'chapies', claim: 'A generated definition.', source: 'generated research', confidence: 0.35, verified: false }] },
  );
  assert.doesNotMatch(reply.reply, /generated definition/i);
});

test('thinking only voices a deliberation once it reaches a conclusion', () => {
  const thought = think({ activeGoal: { topic: 'talos' }, deliberation: { concluded: true, conclusion: { claim: 'Talos is a prototype.' } }, neuralState: {} });
  assert.equal(thought, 'Talos is a prototype.');
});

test('spontaneous speech stays silent without a recalled utterance', () => {
  assert.equal(speak({ neuralState: { valence: -0.9 }, conceptActivations: 'danger:1 (v-0.9 a0.9)' }), null);
});
