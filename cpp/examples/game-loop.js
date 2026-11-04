'use strict';

// Game-loop demo. A tiny agent wanders a 2D field, gets hungry, and learns to
// approach food using only the brain's motor intent.
//
//   node examples/game-loop.js
//   NEUROPILE_STEPS=600 node examples/game-loop.js

const { Brain } = require('..');

const { env } = require('./env');
const steps = Number(env('STEPS', 1200));
const hz = Number(env('HZ', 30));

const brain = new Brain({ sizeGB: 0.01, native: env('NATIVE', '1') !== '0' });
brain.start(hz);

let body = { x: 0.5, y: 0.5, heading: 0, speed: 0, energy: 0.8 };
let needs = { hunger: 0.7, energy: 0.8, joy: 0.6 };
let food = { x: 0.3 + Math.random() * 0.4, y: 0.3 + Math.random() * 0.4 };
let eaten = 0;
let step = 0;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function respawnFood() {
  food = { x: 0.1 + Math.random() * 0.8, y: 0.1 + Math.random() * 0.8 };
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

const timer = setInterval(() => {
  step++;

  // The neural core integrates the body, needs, and what it can see.
  brain.integrateWorldState({
    body,
    needs,
    detections: [
      { label: 'food', w: 1 - distance(body, food) },
      { label: body.x < 0.15 || body.x > 0.85 ? 'border' : 'open-space', w: 0.4 },
    ],
    motorHint: distance(body, food) < 0.35
      ? { x: food.x - body.x, y: food.y - body.y, intensity: 0.8, hintMode: 'approach' }
      : null,
  });

  // Motor intent is the brain's decoded movement signal.
  const intent = brain.getMotorIntent();
  const dx = intent.dx * intent.strength + (food.x - body.x) * 0.12;
  const dy = intent.dy * intent.strength + (food.y - body.y) * 0.12;
  const mag = Math.hypot(dx, dy) || 1;

  brain.move(dx / mag, dy / mag, 0.7);
  body = brain.getBody();
  needs = brain.getNeeds();

  // Eat when close.
  if (distance(body, food) < 0.045) {
    brain.handleInteraction('feed', 1.0);
    needs = brain.getNeeds();
    eaten++;
    respawnFood();
  }

  // Needs drift down over time; the core also decays them every tick.
  needs.hunger = clamp(needs.hunger - 0.0008, 0, 1);
  needs.energy = clamp(needs.energy - 0.0004, 0, 1);
  needs.joy = clamp(needs.joy - 0.0002, 0, 1);

  if (step % Math.round(hz) === 0) {
    const state = brain.behaviorState();
    console.log(
      `t=${String(step).padStart(4)} ` +
      `pos=(${body.x.toFixed(2)},${body.y.toFixed(2)}) ` +
      `hunger=${needs.hunger.toFixed(2)} ` +
      `valence=${state.valence.toFixed(2)} ` +
      `curiosity=${state.curiosity.toFixed(2)} ` +
      `eaten=${eaten}`,
    );
  }

  if (step >= steps) {
    clearInterval(timer);
    brain.stop();
    const final = brain.state();
    console.log('\n--- final ---');
    console.log(`steps=${steps} eaten=${eaten} memories=${final.memorySize} concepts=${final.conceptSize}`);
    console.log(`valence=${final.emotion.valence.toFixed(3)} arousal=${final.emotion.arousal.toFixed(3)}`);
  }
}, 1000 / hz);

process.on('SIGINT', () => {
  clearInterval(timer);
  brain.stop();
  console.log(`\nstopped after ${step} steps, ate ${eaten}`);
  process.exit(0);
});
