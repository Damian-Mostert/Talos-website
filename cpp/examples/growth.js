'use strict';

// Growth demo. A brain starts small and grows toward a ceiling while it
// experiences things: each round it hears a word, remembers it, and the
// neurogenesis that follows wires more neurons into the circuit.
//
//   node examples/growth.js
//   NEUROPILE_ROUNDS=50 node examples/growth.js

const { Brain } = require('..');

const { env } = require('./env');
const rounds = Number(env('ROUNDS', 30));
const startNeurons = Number(env('START', 20000));
const maxNeurons = Number(env('MAX', 120000));

const brain = new Brain({
  startNeurons,
  maxNeurons,
  growthBatch: 1000,
  growthInterval: 5,
  growthProfile: {
    hippocampus: 3,
    association: 2,
    motor: 0.5,
  },
});

const words = [
  'fire', 'water', 'stone', 'wind', 'light', 'shadow', 'ember', 'frost',
  'thunder', 'silence', 'copper', 'meadow', 'signal', 'hollow', 'glass',
];

console.log(`brain starts at ${brain.neuronCount} neurons (max ${brain.maxNeurons})`);

for (let round = 1; round <= rounds; round++) {
  const word = words[round % words.length];

  // Experience the word, remember it, and reinforce the encoding.
  brain.hear(word);
  brain.remember(`the ${word} was here`, {
    entities: [word],
    emotion: 'neutral',
    salience: 0.5,
  });

  // A little reward keeps dopamine up, which is when the brain grows most.
  brain.reward(0.4);
  brain.tick(5);

  if (round % 5 === 0 || round === rounds) {
    const assoc = brain.core.region('association');
    const hippo = brain.core.region('hippocampus');
    console.log(
      `round ${String(round).padStart(2)}  ` +
      `neurons=${String(brain.neuronCount).padStart(6)}  ` +
      `events=${brain.growthEvents}  ` +
      `progress=${(brain.growthProgress * 100).toFixed(1)}%  ` +
      `association=${assoc.size}  hippocampus=${hippo.size}  ` +
      `memories=${brain.memory.size}`,
    );
  }
}

console.log('\nfinal state:');
console.log(brain.state());
