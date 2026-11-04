# neuropile

A native C++ spiking-neuron brain with a clean Node.js API. It ports the
neural substrate and cognitive layers from the
[Talos project](https://github.com/Damian-Mostert/Talos-website) so you can plug
a living, feeling, growing brain into chat apps, games, agents, robots, or
anything else that can call JavaScript.

> The neuropil is the dense woven tissue where a brain actually computes. That
> is what this package is: the substrate, not a wrapper around someone else's
> model.

- **Native core** — spiking neurons, region wiring, neuromodulators, needs,
  affect, motor intent, sensory encoding, and consolidation in C++17 via N-API.
- **Growth** — neurogenesis: the brain starts at a size you choose and grows
  toward a maximum, wiring new neurons in as it goes.
- **Pure-JS fallback** — the same API works with no compiler installed.
- **Cognitive layers** — associative memory, concepts, working memory, a
  parameter genome, metacognition, homeostasis, and explicit beliefs.
- **Persistence** — full snapshot/restore, gzip-compressed save/load.
- **Zero runtime dependencies** apart from `node-addon-api` for building.

## Install

```bash
npm install neuropile
```

`npm install` tries to compile the native addon with `node-gyp`. If no C++17
toolchain is available it prints a notice and installs the JavaScript fallback
instead. Both paths expose the same API.

To build the native core explicitly:

```bash
npm run build
```

Requirements: Node.js 18+, Python 3, and a C++17 compiler (MSVC Build Tools on
Windows, Xcode Command Line Tools on macOS, GCC/Clang on Linux).

### npm 12 and install scripts

npm 12 blocks dependency install scripts by default, which includes the
`node-gyp` build. If you install `neuropile` and find the JS fallback in use
(`require('neuropile').nativeAvailable === false`), approve the build script:

```bash
npm approve-scripts neuropile
npm rebuild neuropile
```

Or add it to your own `package.json`:

```json
{
  "allowScripts": {
    "neuropile": true
  }
}
```

The native core is meaningfully faster than the JavaScript fallback, and
**how much** depends on your workload:

| Workload | Speedup |
| --- | --- |
| Agent loop (world state, tick, reafference) | ~2x |
| Compute-heavy spiking (dense firing, encode) | ~10x |

The reason is worth understanding: a mostly-idle spiking brain is not
compute-bound. Most of the time in a realistic loop goes into scanning
regions and crossing the JS/native boundary, and C++ cannot remove those
costs. The native core earns its keep when a lot of neurons are actually
firing.

Run `npm run benchmark` to measure it on your own machine.

## Quick start

```js
const { Brain } = require('neuropile');

const brain = new Brain({ sizeGB: 0.1 }); // ~155k neurons at the default size
brain.start(10);                           // tick at 10 Hz

brain.hear('hello, warm friend');
brain.remember('the fire is warm and safe', {
  entities: ['fire', 'warm'],
  emotion: 'happy',
  type: 'episodic',
  turnId: 1,
});

brain.tick(5);
console.log(brain.state());
console.log(brain.context()); // model-ready context block
```

ESM works too:

```js
import { Brain } from 'neuropile';
```

## The two layers

### 1. Neural core (`BrainCore`)

The core is the spiking substrate. It owns 16 regions (thalamus, hypothalamus,
amygdala, sensory, visual, hippocampus, temporal, association, prefrontal, ACC,
basal ganglia, motor, cerebellum, VTA, locus coeruleus, raphe), a wiring table
of long-range projections, and neuromodulators (dopamine, norepinephrine).

```js
const { BrainCore } = require('neuropile');

const core = new BrainCore({ neurons: 50000, seed: 42 });

core.integrateWorldState({
  body: { x: 0.5, y: 0.4, speed: 0.2 },
  needs: { hunger: 0.3, energy: 0.6, joy: 0.7 },
  detections: [{ label: 'food', w: 0.8 }],
  interaction: { note: 'feed', x: 0.5, y: 0.4 },
});

core.tick(10);

console.log(core.emotionalState());   // valence, arousal, drive, NE, needs
console.log(core.behaviorState());    // curiosity, uncertainty, readiness...
console.log(core.getMotorIntent());   // { dx, dy, strength }
console.log(core.readInternalState()); // Ω1..Ω5, Ω_da, Ω_ne
```

Useful methods:

| Area | Methods |
| --- | --- |
| Clock | `tick(count)`, `start(hz)`, `stop()` |
| Reward | `reward(strength)`, `punish(strength)` |
| Needs/body | `setNeeds`, `getNeeds`, `getBody`, `move`, `handleInteraction` |
| World | `integrateWorldState(state)` |
| Affect | `emotionalState`, `behaviorState`, `decideBehavior` |
| Attention | `novelty`, `reafference`, `selfAwareness`, `actionSelection` |
| Motor | `getMotorIntent`, `motorQuadrantSize` |
| Readout | `readInternalState`, `neuronMap`, `thought` |
| Input | `perceive`, `perceiveDense`, `perceiveVisual`, `hear`, `hearDense` |
| Memory | `encode`, `encodeDense`, `consolidate`, `consolidateDense` |
| Growth | `grow`, `growTo`, `maybeGrow` |
| Persistence | `snapshot`, `restore`, `region` |

### 2. High-level `Brain`

`Brain` combines the core with the cognitive layers and gives you a single
object to drive.

```js
const { Brain } = require('neuropile');
const brain = new Brain({ sizeGB: 0.1, native: true });

// Perception
brain.hear('the room is cold and quiet');
brain.see(new Uint32Array([1, 2, 3, 500]));
brain.perceive([0.2, 0, 0.9]); // dense sensory vector

// Memory
brain.remember('the room was cold', {
  entities: ['room', 'cold'],
  emotion: 'neutral',
  salience: 0.5,
  type: 'semantic',
});
const memories = brain.recall(['room'], { topN: 5 });
console.log(brain.recallText(['room']));

// Concepts (words are labels on experienced clusters)
brain.learn('ember', { bright: 0.9, hot: 0.8 }, { valence: 0.4, arousal: 0.3, approach: 0.2 }, 'watch', 0.6);
brain.associate('ember', 'fire', 0.4);
console.log(brain.emotionOf('ember')); // { valence, arousal, approach }
console.log(brain.activeConcepts(5));

// Working memory
brain.hold('we are talking about fire', ['fire'], 'input');
brain.focus('fire', ['fire', 'warm'], 'input');
brain.readWorkingMemory();

// Beliefs
brain.believe({ topic: 'fire', claim: 'fire is warm', confidence: 0.6 });
brain.believe({ topic: 'fire', claim: 'fire is warm', source: 'observation', verified: true });
console.log(brain.deliberate('fire'));

// Metacognition + homeostasis
const record = brain.predict({ intent: 'question', emotion: 'happy' }, 0.6);
brain.observe(record, 'because fire is warm?');
brain.recordTurn({ recalledSalience: 0.4, goalPushed: true, goalResolved: true });
```

`brain.state()` returns the full picture; `brain.context()` returns a compact
text block you can feed to a language model.

## Growth

A brain can grow. Give it a starting size and a ceiling, and it grows between
them — adding real neurons, wiring them into the circuit, and keeping
everything it has already learned.

```js
const { Brain } = require('neuropile');

const brain = new Brain({
  startNeurons: 20000,   // where the brain begins
  maxNeurons: 200000,    // where it stops growing
  growthBatch: 1000,     // neurons added per growth event (default ~1%)
  growthInterval: 100,   // ticks between automatic growth events
});

console.log(brain.neuronCount);    // 19020
brain.tick(100);                   // one growth event fires
console.log(brain.neuronCount);    // 20020
```

Growth is on by default whenever `maxNeurons` is larger than the starting
size. Set `autoGrow: false` to take manual control.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `startNeurons` | — | Initial size. Alias for `neurons` that reads as intent. |
| `maxNeurons` | start size | Hard ceiling on total neurons. |
| `autoGrow` | `maxNeurons > start` | Grow automatically on tick. |
| `growthBatch` | ~1% of start | Neurons added per growth event. |
| `growthInterval` | `100` | Ticks between growth events. `0` disables the timer. |
| `growthFanout` | `8` | Synapses wired per direction for each new neuron. |
| `growthProfile` | — | Per-region multipliers (object keyed by region name). |

### Methods

```js
brain.grow(500);          // add up to 500 neurons, returns how many grew
brain.growTo(50000);      // grow toward a total, returns how many grew
brain.maybeGrow();        // one automatic step, if the cadence allows it

brain.neuronCount;        // current neuron count
brain.maxNeurons;         // the ceiling
brain.canGrow;            // false once the ceiling is reached
brain.growthProgress;     // 0..1 toward the ceiling
brain.growthEvents;       // how many growth events have happened
```

### How the neurons are added

New neurons are distributed across the 16 regions proportionally to each
region's Talos base size, weighted by a growth profile that favours the
plastic regions (hippocampus and association cortex grow fastest; the
neuromodulator nuclei barely grow at all). The brain keeps its proportions as
it grows.

Each newborn neuron is wired into the circuit the same way the original brain
was wired: local recurrent connections inside its own region, plus the
long-range projections from the region's place in the wiring table. Existing
neurons keep their potentials, thresholds and learned synapse weights — the
whole brain is remapped, not rebuilt.

You can steer where growth goes:

```js
const brain = new Brain({
  startNeurons: 20000,
  maxNeurons: 200000,
  growthProfile: {
    hippocampus: 4,    // grow memory capacity faster
    association: 3,
    motor: 0.2,        // barely grow the motor system
  },
});
```

### Persistence

A grown brain saves and loads like any other — the snapshot carries the
current layout, so loading into a fresh core restores the grown size.

```js
brain.save('./agent.neuropile');
const clone = new Brain({ startNeurons: 20000, maxNeurons: 200000 });
clone.load('./agent.neuropile');
console.log(clone.neuronCount);  // the grown size, not the starting size
```

## Renamed from `talos-brain`

The package was previously published as `talos-brain`. It is now `neuropile`.

- `npm install neuropile` — the new name.
- `require('neuropile')` / `import { Brain } from 'neuropile'`.
- Existing `talos-brain` snapshots still load: the persistence layer reads the
  old `talos-brain` format and the old `__talosType` value tag.
- `require('neuropile/talos-brain')` resolves to the same entry point if you
  need the old specifier to keep working inside a monorepo.

Environment variables were renamed alongside the package. The old names still
work:

| New | Old |
| --- | --- |
| `NEUROPILE_NATIVE` | `TALOS_NATIVE` |
| `NEUROPILE_SIZE_GB` | `TALOS_SIZE_GB` |
| `NEUROPILE_MEMORY_CAPACITY` | `TALOS_MEMORY_CAPACITY` |
| `NEUROPILE_STEPS` | `TALOS_STEPS` |
| `NEUROPILE_HZ` | `TALOS_HZ` |
| `NEUROPILE_ROUNDS` | `TALOS_ROUNDS` |
| `NEUROPILE_START` | `TALOS_START` |
| `NEUROPILE_MAX` | `TALOS_MAX` |

## How the pieces fit

```
sensory / vision / audio
        │
        ▼
  BrainCore (C++ or JS)  ── spiking neurons, regions, dopamine/NE
        │
        ├── emotionalState / behaviorState / motorIntent
        │
        ├── MemoryCortex      associative, decaying, reafference-biased
        ├── ConceptNet        sensory + emotional grounding of words
        ├── WorkingMemory     7±2 attention slots + shared focus
        ├── Genome            tunable personality/plasticity parameters
        ├── Metacognition     predicts, scores, adapts its own weights
        ├── Homeostasis       proposes genome trials, accepts or reverts
        └── BeliefStore       explicit claims with provenance
```

Memory recall is biased by `core.reafference()`: the neurons firing right now
prefer memories whose encoding pattern overlaps. That is what makes the
simulation drive cognition instead of sitting beside it.

## Persistence

```js
brain.save('./agent.neuropile');       // gzip-compressed by default
const clone = new Brain({ sizeGB: 0.1 });
clone.load('./agent.neuropile');

const snap = brain.snapshot();     // plain in-memory object
clone.restore(snap);

await brain.saveAsync('./agent.neuropile');
await clone.loadAsync('./agent.neuropile');
```

Snapshots include the neural engine (potentials, thresholds, synapses,
modulators), needs/body/motor state, memory, concepts, working memory, genome,
metacognition, beliefs, and the homeostasis ledger. `save(path, { compress:
false })` writes plain JSON.

## Examples

```bash
npm run example:chat    # interactive chat loop
npm run example:game    # agent wanders, gets hungry, eats
npm run example:http    # JSON HTTP API on :8787
```

The HTTP server exposes `GET /state`, `GET /context`, `POST /perceive`,
`POST /remember`, `POST /recall`, `POST /learn`, `POST /believe`, `POST /step`,
`POST /interact`, and `POST /save`.

## API notes

- `new Brain({ native: false })` forces the JS core even when the addon is
  built. `brain.native` tells you which core is in use.
- `brain.core` is the underlying `BrainCore` (native or JS); `brain.core.engine`
  is the raw `NeuralEngine` with the typed-array neuron state.
- Growth reallocates the engine so the whole brain can be remapped. It is
  cheap at small sizes but not free — for a large brain, prefer growing in
  batches (`growthBatch`) over many tiny events.
- `createCore(options)` returns a standalone core using the same selection
  logic.
- `soundPattern(text, size)` matches Talos's `core/boot.js` exactly: djb2
  (`h = 5381`, `h = h * 31 ^ charCode`) spread with
  `(h ^ j) * 2654435761 % size`.
- Typed-array views on the native engine point directly at the C++ vectors.
  They stay valid while the owning `BrainCore` is alive.
- The default `sizeGB` is `0.1` (~155k neurons). For tests and small demos use
  `{ neurons: 5000 }` or `{ sizeGB: 0.01 }`.

## Testing

```bash
npm test            # JS fallback suite; native test skips if not built
npm run test:native # only the native compatibility test
```

## License

MIT © 2026 Damian Mostert

See [LICENSE](./LICENSE).

## Credits

`neuropile` is a native C++ port of the neural substrate and cognitive layers
from the [Talos project](https://github.com/Damian-Mostert/Talos-website),
which lives in the `core/` directory of that repository. The region table,
wiring topology, and affect formulas are faithful ports; the C++ core, the
neurogenesis system, and the Node.js packaging are new work.

The `soundPattern` hash matches the original `core/boot.js` exactly, so brains
stay compatible with Talos-encoded stimuli.
