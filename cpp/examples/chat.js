'use strict';

// Chat demo. Type a line and the brain hears it, grounds the words as
// concepts, stores an episodic trace, ticks, and reports what changed.
//
//   node examples/chat.js
//   NEUROPILE_SIZE_GB=0.02 NEUROPILE_NATIVE=0 node examples/chat.js

const readline = require('node:readline');
const { Brain } = require('..');

const { env } = require('./env');
const sizeGB = Number(env('SIZE_GB', 0.01));
const useNative = env('NATIVE', '1') !== '0';

const brain = new Brain({ sizeGB, native: useNative });
brain.start(10);

console.log(`neuropile ${brain.native ? '(native core)' : '(JS fallback)'}`);
console.log(`${brain.regions.length} regions, ${brain.engine.n.toLocaleString()} neurons`);
console.log('Type a message. Commands: /state /context /recall <word> /quit\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'you> ' });

function showState() {
  const s = brain.state();
  console.log('\n--- brain state ---');
  console.log(`tick       ${s.tick}`);
  console.log(`valence    ${s.emotion.valence.toFixed(3)}`);
  console.log(`arousal    ${s.emotion.arousal.toFixed(3)}`);
  console.log(`drive      ${s.emotion.drive.toFixed(3)}`);
  console.log(`needs      hunger=${s.emotion.needs.hunger.toFixed(2)} energy=${s.emotion.needs.energy.toFixed(2)} joy=${s.emotion.needs.joy.toFixed(2)}`);
  console.log(`behavior   curiosity=${s.behavior.curiosity.toFixed(2)} uncertainty=${s.behavior.uncertainty.toFixed(2)} speech=${s.behavior.speechReadiness.toFixed(2)}`);
  console.log(`concepts   ${s.concepts.map(c => `${c.label}:${c.activation}`).join(', ') || '(none)'}`);
  console.log(`memory     ${s.memorySize} nodes, ${s.conceptSize} concepts, ${s.workingMemory.length} in working memory`);
  console.log('');
}

rl.prompt();

rl.on('line', line => {
  const text = line.trim();
  if (!text) return rl.prompt();

  if (text === '/quit' || text === '/exit') {
    rl.close();
    return;
  }
  if (text === '/state') {
    showState();
    return rl.prompt();
  }
  if (text === '/context') {
    console.log('\n' + brain.context() + '\n');
    return rl.prompt();
  }
  if (text.startsWith('/recall ')) {
    const word = text.slice(8).trim();
    console.log('\n' + brain.recallText([word]) + '\n');
    return rl.prompt();
  }

  brain.hear(text, { salience: 0.6, emotion: 'neutral' });
  brain.hold(text, text.toLowerCase().split(/\s+/), 'input');
  brain.focus(text, text.toLowerCase().split(/\s+/), 'input');
  brain.tick(2);

  const concepts = brain.activeConcepts(4);
  const emotion = brain.emotionalState();
  console.log(`brain> heard ${text.split(/\s+/).length} word(s); valence=${emotion.valence.toFixed(2)} arousal=${emotion.arousal.toFixed(2)}`);
  if (concepts.length > 0) {
    console.log(`       active: ${concepts.map(c => `${c.label}(${c.activation})`).join(', ')}`);
  }
  rl.prompt();
});

rl.on('close', () => {
  brain.stop();
  console.log('\nbye');
  process.exit(0);
});
