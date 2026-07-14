// concepts.js — semantic grounding layer
//
// This sits between the neural substrate and the LLM.
// The LLM should never be the source of what words mean emotionally.
// That meaning must come from experience: sensory features + emotional weights
// built up through repeated co-activation with real events.
//
// A concept is not a definition. It is a cluster of:
//   - sensory features (what it looks/sounds/feels like)
//   - emotional weights (how it makes the system feel)
//   - associated actions (what the system does around it)
//   - word labels (tokens that activate this concept, with confidence)
//   - activation strength (how strongly it's firing right now)
//
// Words are labels attached to concepts — not the other way around.
// experience → meaning → word  (not: word → meaning)

const DECAY_RATE   = 0.0003;   // concept activation decays between ticks
const LEARN_RATE   = 0.12;     // how fast features update from new experience
const MIN_SALIENCE = 0.04;     // prune below this

export class ConceptNet {
    constructor() {
        // id → concept node
        this._concepts = new Map();
        // word token → Set of concept ids (many words can point to one concept)
        this._wordIndex = new Map();
        this._nextId = 0;

        // Seed primitive emotional vocabulary — these are vectors, not definitions.
        // valence: -1 (bad) to +1 (good)
        // arousal: 0 (calm) to 1 (activated)
        // approach: -1 (avoid) to +1 (approach)
        this._seedPrimitives();
    }

    // ── Primitive emotional vocabulary ────────────────────────────────────────
    // These are the base vectors. Everything else is built on top of them
    // through experience. A toddler doesn't learn "love = strong affection" —
    // they learn love = warmth + safety + face + voice + fed + held.
    _seedPrimitives() {
        const primitives = [
            // Positive
            { word: 'safe',    valence:  0.9, arousal: 0.1, approach:  0.8 },
            { word: 'good',    valence:  0.8, arousal: 0.2, approach:  0.7 },
            { word: 'warm',    valence:  0.7, arousal: 0.1, approach:  0.6 },
            { word: 'friend',  valence:  0.8, arousal: 0.4, approach:  0.9 },
            { word: 'food',    valence:  0.7, arousal: 0.5, approach:  1.0 },
            { word: 'play',    valence:  0.8, arousal: 0.7, approach:  0.9 },
            { word: 'happy',   valence:  0.9, arousal: 0.5, approach:  0.8 },
            { word: 'comfort', valence:  0.8, arousal: 0.1, approach:  0.7 },
            { word: 'home',    valence:  0.7, arousal: 0.1, approach:  0.8 },
            { word: 'learn',   valence:  0.6, arousal: 0.5, approach:  0.9 },
            { word: 'know',    valence:  0.5, arousal: 0.3, approach:  0.7 },
            { word: 'curious', valence:  0.5, arousal: 0.6, approach:  0.9 },
            // Negative
            { word: 'danger',  valence: -0.9, arousal: 0.9, approach: -1.0 },
            { word: 'pain',    valence: -0.9, arousal: 0.8, approach: -0.9 },
            { word: 'cold',    valence: -0.4, arousal: 0.3, approach: -0.5 },
            { word: 'alone',   valence: -0.6, arousal: 0.2, approach: -0.3 },
            { word: 'loss',    valence: -0.8, arousal: 0.4, approach: -0.6 },
            { word: 'fear',    valence: -0.8, arousal: 0.8, approach: -0.9 },
            { word: 'hurt',    valence: -0.8, arousal: 0.7, approach: -0.8 },
            { word: 'wrong',   valence: -0.7, arousal: 0.4, approach: -0.7 },
            // Neutral
            { word: 'thing',   valence:  0.0, arousal: 0.1, approach:  0.0 },
            { word: 'place',   valence:  0.0, arousal: 0.1, approach:  0.1 },
            { word: 'person',  valence:  0.2, arousal: 0.3, approach:  0.3 },
            { word: 'move',    valence:  0.1, arousal: 0.4, approach:  0.2 },
            { word: 'look',    valence:  0.1, arousal: 0.3, approach:  0.3 },
            { word: 'touch',   valence:  0.1, arousal: 0.3, approach:  0.2 },
        ];

        for (const p of primitives) {
            const id = this._nextId++;
            this._concepts.set(id, {
                id,
                label: p.word,
                primitive: true,
                salience: 0.6,
                activation: 0.0,
                // Emotional vector — the core of what this concept "means"
                emotion: { valence: p.valence, arousal: p.arousal, approach: p.approach },
                // Sensory features built up from experience: feature → weight 0..1
                sensory: {},
                // Associated actions
                actions: new Set(),
                // Word labels: token → confidence
                words: new Map([[p.word, 1.0]]),
                // How many times this concept has been activated
                encounters: 1,
                lastSeen: Date.now(),
            });
            this._indexWord(p.word, id);
        }
    }

    // ── Core API ──────────────────────────────────────────────────────────────

    // Activate a concept by word token. Returns the concept or null.
    // This is what happens when the system hears a word — it activates the
    // concept cluster, not just a string lookup.
    activate(word, strength = 1.0) {
        const token = word.toLowerCase().trim();
        const ids = this._wordIndex.get(token);
        if (!ids || ids.size === 0) return null;

        let strongest = null;
        for (const id of ids) {
            const c = this._concepts.get(id);
            if (!c) continue;
            c.activation = Math.min(1, c.activation + strength * 0.4);
            c.salience   = Math.min(1, c.salience + 0.05);
            c.lastSeen   = Date.now();
            if (!strongest || c.activation > strongest.activation) strongest = c;
        }
        return strongest;
    }

    // Learn from an experience event.
    // word:     the token being learned (may be null if pre-linguistic)
    // sensory:  { feature: strength } — what was perceived
    // emotion:  { valence, arousal, approach } — what was felt
    // action:   string or null — what was done
    // strength: how salient this experience was
    learn(word, sensory = {}, emotion = {}, action = null, strength = 0.5) {
        const token = word ? word.toLowerCase().trim() : null;

        // Find existing concept for this word, or create one
        let concept = token ? this._findOrCreate(token) : null;

        if (concept) {
            // Update emotional vector toward this experience (running average)
            const lr = LEARN_RATE * strength;
            if (emotion.valence  != null) concept.emotion.valence  += lr * (emotion.valence  - concept.emotion.valence);
            if (emotion.arousal  != null) concept.emotion.arousal  += lr * (emotion.arousal  - concept.emotion.arousal);
            if (emotion.approach != null) concept.emotion.approach += lr * (emotion.approach - concept.emotion.approach);

            // Update sensory features
            for (const [feat, val] of Object.entries(sensory)) {
                const prev = concept.sensory[feat] || 0;
                concept.sensory[feat] = prev + lr * (val - prev);
            }

            if (action) concept.actions.add(action);
            concept.encounters++;
            concept.salience   = Math.min(1, concept.salience + strength * 0.1);
            concept.activation = Math.min(1, concept.activation + strength * 0.3);
            concept.lastSeen   = Date.now();
        }

        return concept;
    }

    // Associate two words — hearing "dog" while seeing "furry" links them.
    // This is Hebbian learning at the concept level.
    associate(wordA, wordB, strength = 0.3) {
        const a = this._findOrCreate(wordA);
        const b = this._findOrCreate(wordB);
        if (!a || !b || a.id === b.id) return;

        // Cross-pollinate sensory features
        for (const [feat, val] of Object.entries(b.sensory)) {
            const prev = a.sensory[feat] || 0;
            a.sensory[feat] = prev + strength * LEARN_RATE * (val - prev);
        }
        for (const [feat, val] of Object.entries(a.sensory)) {
            const prev = b.sensory[feat] || 0;
            b.sensory[feat] = prev + strength * LEARN_RATE * (val - prev);
        }

        // Partial emotional blending — associated concepts pull each other's valence
        const blend = strength * LEARN_RATE * 0.3;
        a.emotion.valence += blend * (b.emotion.valence - a.emotion.valence);
        b.emotion.valence += blend * (a.emotion.valence - b.emotion.valence);
    }

    // Get the emotional weight of a word — what does this word mean emotionally?
    // This is what the LLM should NOT be computing. The cognitive system knows this.
    emotionOf(word) {
        const token = word.toLowerCase().trim();
        const ids = this._wordIndex.get(token);
        if (!ids || ids.size === 0) return null;

        // Average across all concepts this word activates
        let v = 0, a = 0, ap = 0, count = 0;
        for (const id of ids) {
            const c = this._concepts.get(id);
            if (!c) continue;
            v  += c.emotion.valence;
            a  += c.emotion.arousal;
            ap += c.emotion.approach;
            count++;
        }
        if (count === 0) return null;
        return { valence: v / count, arousal: a / count, approach: ap / count };
    }

    // Get currently active concepts — what the system is "thinking about" right now.
    // Returns array sorted by activation strength.
    activeConceptsSnapshot(topN = 8) {
        const now = Date.now();
        const active = [];
        for (const c of this._concepts.values()) {
            // Decay activation
            const age = (now - c.lastSeen) / 1000;
            c.activation *= Math.exp(-DECAY_RATE * age * 10);
            if (c.activation > 0.05) active.push(c);
        }
        active.sort((a, b) => b.activation - a.activation);
        return active.slice(0, topN).map(c => ({
            label:      c.label,
            activation: +c.activation.toFixed(3),
            emotion:    {
                valence:  +c.emotion.valence.toFixed(2),
                arousal:  +c.emotion.arousal.toFixed(2),
                approach: +c.emotion.approach.toFixed(2),
            },
            topFeatures: this._topFeatures(c, 3),
        }));
    }

    // Format active concepts for the LLM — this replaces the vague "mood: curious" description.
    // The LLM gets concept activations + their emotional weights, not a prose description.
    // It then translates this into language. That's its only job.
    formatForLLM() {
        const active = this.activeConceptsSnapshot(6);
        if (active.length === 0) return null;
        return active.map(c => {
            const sign = c.emotion.valence >= 0 ? '+' : '';
            const feat = c.topFeatures.length > 0 ? ` [${c.topFeatures.join(',')}]` : '';
            return `${c.label}:${c.activation.toFixed(2)} (v${sign}${c.emotion.valence} a${c.emotion.arousal.toFixed(1)})${feat}`;
        }).join('  ');
    }

    // Compute the net emotional state from all currently active concepts.
    // This is a bottom-up emotional signal — the concepts drive the feeling,
    // not the other way around.
    netEmotion() {
        const active = this.activeConceptsSnapshot(10);
        if (active.length === 0) return { valence: 0, arousal: 0, approach: 0 };
        let v = 0, a = 0, ap = 0, totalW = 0;
        for (const c of active) {
            const w = c.activation;
            v  += c.emotion.valence  * w;
            a  += c.emotion.arousal  * w;
            ap += c.emotion.approach * w;
            totalW += w;
        }
        if (totalW === 0) return { valence: 0, arousal: 0, approach: 0 };
        return {
            valence:  +(v  / totalW).toFixed(3),
            arousal:  +(a  / totalW).toFixed(3),
            approach: +(ap / totalW).toFixed(3),
        };
    }

    // ── Internal ──────────────────────────────────────────────────────────────

    _findOrCreate(token) {
        const ids = this._wordIndex.get(token);
        if (ids && ids.size > 0) {
            const id = ids.values().next().value;
            return this._concepts.get(id) || null;
        }
        // New concept — starts with neutral emotion, no features
        const id = this._nextId++;
        const concept = {
            id,
            label: token,
            primitive: false,
            salience: 0.1,
            activation: 0.0,
            emotion: { valence: 0, arousal: 0.1, approach: 0 },
            sensory: {},
            actions: new Set(),
            words: new Map([[token, 0.3]]),  // low confidence — just heard it once
            encounters: 0,
            lastSeen: Date.now(),
        };
        this._concepts.set(id, concept);
        this._indexWord(token, id);
        return concept;
    }

    _indexWord(token, id) {
        if (!this._wordIndex.has(token)) this._wordIndex.set(token, new Set());
        this._wordIndex.get(token).add(id);
    }

    _topFeatures(concept, n) {
        return Object.entries(concept.sensory)
            .sort((a, b) => b[1] - a[1])
            .slice(0, n)
            .map(([k]) => k);
    }

    // Prune low-salience non-primitive concepts
    prune() {
        for (const [id, c] of this._concepts) {
            if (c.primitive) continue;
            if (c.salience < MIN_SALIENCE && c.encounters < 3) {
                this._concepts.delete(id);
                for (const [token, ids] of this._wordIndex) {
                    ids.delete(id);
                    if (ids.size === 0) this._wordIndex.delete(token);
                }
            }
        }
    }

    get size() { return this._concepts.size; }
}
