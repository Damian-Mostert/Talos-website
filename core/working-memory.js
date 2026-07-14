// working-memory.js — dorsolateral prefrontal cortex analog
// Holds what the mind is actively attending to right now.
// Capacity-limited (7±2), fast decay, rehearsal keeps items alive.
// This is NOT long-term memory — it's the current contents of attention.

const CAPACITY     = 7;
const DECAY_MS     = 30000;  // item expires after 30s without rehearsal
const REHEARSE_BOOST = 10000; // rehearsal extends lifetime by 10s

export class WorkingMemory {
    constructor() {
        this.slots = []; // { content, entities, type, strength, expiresAt }
        this.focus = null; // { topic, entities, source, strength, updatedAt }
    }

    _normalizeEntities(entities = []) {
        return (entities || [])
            .filter(e => typeof e === 'string')
            .map(e => e.toLowerCase())
            .filter(Boolean);
    }

    _expireFocus(now = Date.now()) {
        if (!this.focus) return;
        if (now - this.focus.updatedAt > DECAY_MS) this.focus = null;
    }

    // ── Hold something in attention ───────────────────────────────────────────
    hold(content, entities = [], type = 'thought', strength = 1.0) {
        if (!content || content.length < 2) return;

        // If already held, rehearse it instead
        const existing = this.slots.find(s =>
            s.content === content ||
            (entities.length > 0 && s.entities.some(e => entities.includes(e)))
        );
        if (existing) {
            existing.strength  = Math.min(1, existing.strength + 0.2);
            existing.expiresAt = Date.now() + DECAY_MS;
            return;
        }

        const item = {
            content,
            entities: this._normalizeEntities(entities),
            type,     // 'input' | 'thought' | 'goal' | 'fact'
            strength,
            expiresAt: Date.now() + DECAY_MS,
        };

        this.slots.push(item);

        // Over capacity — drop the weakest item
        if (this.slots.length > CAPACITY) {
            this.slots.sort((a, b) => b.strength - a.strength);
            this.slots = this.slots.slice(0, CAPACITY);
        }
    }

    // ── Set the current shared attention focus ──────────────────────────────
    setFocus(topic, entities = [], source = 'thought', strength = 1.0) {
        if (!topic || typeof topic !== 'string') return null;
        const normalizedTopic = topic.toLowerCase();
        const focusEntities = [...new Set(this._normalizeEntities([normalizedTopic, ...entities]))];
        this.focus = {
            topic: normalizedTopic,
            entities: focusEntities,
            source,
            strength: Math.min(1, Math.max(0.1, strength)),
            updatedAt: Date.now(),
        };
        return this.focus;
    }

    getFocus() {
        this._expireFocus();
        return this.focus;
    }

    clearFocus() {
        this.focus = null;
    }

    // ── Rehearse items matching entities — keeps them alive ──────────────────
    rehearse(entities = []) {
        const query = this._normalizeEntities(entities);
        for (const slot of this.slots) {
            if (slot.entities.some(e => query.includes(e))) {
                slot.expiresAt = Date.now() + REHEARSE_BOOST;
                slot.strength  = Math.min(1, slot.strength + 0.1);
            }
        }

        if (this.focus && this.focus.entities.some(e => query.includes(e))) {
            this.focus.updatedAt = Date.now();
            this.focus.strength = Math.min(1, this.focus.strength + 0.1);
        }
    }

    // ── Expire stale items ────────────────────────────────────────────────────
    tick() {
        const now = Date.now();
        this.slots = this.slots.filter(s => s.expiresAt > now);
        this._expireFocus(now);
    }

    // ── Get current contents, strongest first ────────────────────────────────
    read(topN = CAPACITY) {
        this.tick();
        return [...this.slots]
            .sort((a, b) => b.strength - a.strength)
            .slice(0, topN);
    }

    // ── Format for LLM prompt ─────────────────────────────────────────────────
    format() {
        const items = this.read().filter(s => s.type !== 'input');
        if (items.length === 0) return '(working memory empty)';
        return items.map(s => `[${s.type}] ${s.content}`).join('\n');
    }

    // ── Clear everything — e.g. after a salience interrupt ───────────────────
    flush() {
        this.slots = [];
        this.focus = null;
    }

    get size() { return this.slots.length; }
}
