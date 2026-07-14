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

test('responses mark unverified generated research as uncertain', () => {
  const reply = respond(
    { intent: 'question', topic: 'chapies', entities: ['chapies'], emotion: 'neutral', summary: 'what is chapies?' },
    { beliefs: [{ topic: 'chapies', claim: 'A generated definition.', source: 'generated research', confidence: 0.35, verified: false }] },
  );
  assert.match(reply.reply, /unverified generated research note/i);
});

test('thinking can use a belief as explicit evidence', () => {
  const thought = think({ activeGoal: { topic: 'talos' }, beliefs: [{ claim: 'Talos is a prototype.', source: 'human', verified: false }], neuralState: {} });
  assert.match(thought, /unverified human note/i);
  assert.match(thought, /Talos is a prototype/i);
});

test('spontaneous speech stays silent without a recalled utterance', () => {
  assert.equal(speak({ neuralState: { valence: -0.9 }, conceptActivations: 'danger:1 (v-0.9 a0.9)' }), null);
});
