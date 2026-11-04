'use strict';

// Compares the native C++ core against the pure-JS fallback.
//
//   npm run benchmark
//
// Two workloads are measured:
//
//   1. "think"   — a realistic agent loop: integrate world state, tick, and
//                  query reafference/novelty. This is what most callers do.
//   2. "spike"   — a deliberately compute-heavy workload that keeps a large
//                  number of neurons firing, to show the raw C++ throughput.
//
// The native core wins by roughly 2x on realistic workloads. The reason is
// worth understanding: a mostly-idle spiking brain is not compute-bound, so
// most of the time goes into scanning regions and crossing the JS/native
// boundary, and those costs are not something C++ can remove.
//
// Run with BENCH_NEURONS / BENCH_TICKS / BENCH_RUNS to change the shape.

const { createCore, nativeAvailable, soundPattern } = require('..');

const NEURONS = Number(process.env.BENCH_NEURONS || 120000);
const TICKS = Number(process.env.BENCH_TICKS || 300);
const RUNS = Number(process.env.BENCH_RUNS || 5);

function bestOf(fn, runs = RUNS) {
  let best = Infinity;
  for (let run = 0; run < runs; run++) {
    const start = process.hrtime.bigint();
    fn();
    const elapsed = Number(process.hrtime.bigint() - start) / 1e6;
    if (elapsed < best) best = elapsed;
  }
  return best;
}

function makeCore(native) {
  return createCore({ startNeurons: NEURONS, seed: 11, native });
}

// ── Workload 1: a realistic agent loop ──────────────────────────────────────
function think(core) {
  const world = {
    body: { x: 0.5, y: 0.5, speed: 0.2 },
    needs: { hunger: 0.4, energy: 0.6, joy: 0.5 },
    detections: [{ label: 'food', w: 0.7 }],
  };
  for (let i = 0; i < TICKS; i++) {
    core.integrateWorldState(world);
    core.tick(1);
    core.reafference(20);
    core.novelty();
  }
}

// ── Workload 2: a hot, densely firing brain ─────────────────────────────────
// Keeps the engine busy by perceiving a large pattern every tick.
function spike(core) {
  const pattern = soundPattern('fire', 400000);
  for (let i = 0; i < TICKS; i++) {
    core.perceive(pattern);
    core.encode(pattern, 0.8);
    core.tick(1);
  }
}

function measure(label, workload) {
  const results = {};

  for (const native of [false, true]) {
    if (native && !nativeAvailable) continue;
    const core = makeCore(native);
    for (let i = 0; i < 20; i++) core.tick(1); // warm up
    const ms = bestOf(() => workload(core));
    results[native ? 'native' : 'js'] = ms;
  }

  const js = results.js;
  const native = results.native;
  console.log(`\n  ${label}`);
  console.log(`    js fallback    ${js.toFixed(1).padStart(8)} ms  (${(js / TICKS).toFixed(3)} ms/tick)`);
  if (native) {
    console.log(`    native core    ${native.toFixed(1).padStart(8)} ms  (${(native / TICKS).toFixed(3)} ms/tick)`);
    console.log(`    speedup        ${(js / native).toFixed(2)}x`);
  }
}

console.log(`neuropile benchmark`);
console.log(`  ${NEURONS} neurons, ${TICKS} iterations, best of ${RUNS}`);

measure('think — agent loop (world state, tick, reafference, novelty)', think);
measure('spike — dense firing (perceive, encode, tick)', spike);

if (!nativeAvailable) {
  console.log('\n  native addon is not built — run `npm run build` to compare.');
}
