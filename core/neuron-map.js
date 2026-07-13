// neuron-map.js — compact region activation snapshot, ~1fps
// Sends a small JSON frame with per-region mean activation + top firing indices.
// The frontend does all the visual work at 60fps.

// Target ~500 samples per region regardless of brain size — statistically solid,
// and keeps snapshot() O(regions) not O(neurons).
const SAMPLES_PER_REGION = 500;

export class NeuronMap {
    constructor(brain) {
        this.engine = brain.engine;
        this.layout = brain.layout;
    }

    // Returns a plain object — caller JSON.stringifies it
    snapshot() {
        const pot     = this.engine.potential;
        const regions = {};

        for (const [name, r] of Object.entries(this.layout)) {
            const { start, end, threshold } = r;
            const regionSize = end - start;
            const step = Math.max(1, Math.floor(regionSize / SAMPLES_PER_REGION));
            let sum = 0, peak = 0, firingCount = 0, count = 0;

            for (let i = start; i < end; i += step) {
                const v = pot[i] < 0 ? -pot[i] : pot[i];
                sum += v;
                if (v > peak) peak = v;
                if (v >= threshold) firingCount++;
                count++;
            }

            const mean = sum / count;
            regions[name] = {
                mean:    +Math.tanh(mean  / threshold * 3).toFixed(3),
                peak:    +Math.tanh(peak  / threshold * 2).toFixed(3),
                firing:  +(firingCount / count).toFixed(3),
            };
        }

        return {
            type:   'nmap',
            da:     +Math.tanh(this.engine.dopamine).toFixed(3),
            ne:     +Math.tanh(this.engine.norepinephrine).toFixed(3),
            regions,
        };
    }
}
