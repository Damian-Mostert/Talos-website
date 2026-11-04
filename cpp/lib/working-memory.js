'use strict';

// Working memory - dorsolateral prefrontal cortex analog.
// Holds what the mind is actively attending to right now. Capacity-limited
// (7 +/- 2), fast decay, rehearsal keeps items alive. This is NOT long-term
// memory - it is the current contents of attention.

const CAPACITY = 7;
const DECAY_MS = 12000;
const REHEARSE_BOOST = 5000;

// Source priority - higher = more protected from eviction.
const SOURCE_PRIORITY = { input: 4, answer: 3, grounding: 2, thought: 1, self_speech: 0 };

class WorkingMemory {
  constructor() {
    this.slots = [];
    this.focus = null;
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

  // Hold something in attention.
  hold(content, entities = [], type = 'thought', strength = 1.0) {
    if (!content || content.length < 2) return;

    const exactMatch = this.slots.find(s => s.content === content);
    if (exactMatch) {
      exactMatch.strength = Math.min(1, exactMatch.strength + 0.15);
      exactMatch.expiresAt = Date.now() + DECAY_MS;
      return;
    }

    // Entity overlap only rehearses within the same source type. Different
    // source types always get their own slot.
    const sameSourceMatch = this.slots.find(s =>
      s.type === type &&
      entities.length > 0 &&
      s.entities.some(e => entities.includes(e))
    );
    if (sameSourceMatch) {
      sameSourceMatch.strength = Math.min(1, sameSourceMatch.strength + 0.15);
      sameSourceMatch.expiresAt = Date.now() + DECAY_MS;
      return;
    }

    const item = {
      content,
      entities: this._normalizeEntities(entities),
      type,
      strength,
      expiresAt: Date.now() + DECAY_MS,
    };

    this.slots.push(item);

    if (this.slots.length > CAPACITY) {
      this.slots.sort((a, b) => {
        const pa = SOURCE_PRIORITY[a.type] ?? 1;
        const pb = SOURCE_PRIORITY[b.type] ?? 1;
        if (pa !== pb) return pa - pb;
        return a.strength - b.strength;
      });
      this.slots = this.slots.slice(this.slots.length - CAPACITY);
    }
  }

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

  // Rehearse items matching entities - keeps them alive.
  rehearse(entities = []) {
    const query = this._normalizeEntities(entities);
    for (const slot of this.slots) {
      if (slot.entities.some(e => query.includes(e))) {
        slot.expiresAt = Date.now() + REHEARSE_BOOST;
        slot.strength = Math.min(1, slot.strength + 0.1);
      }
    }

    if (this.focus && this.focus.entities.some(e => query.includes(e))) {
      this.focus.updatedAt = Date.now();
      this.focus.strength = Math.min(1, this.focus.strength + 0.1);
    }
  }

  tick() {
    const now = Date.now();
    this.slots = this.slots.filter(s => s.expiresAt > now);
    this._expireFocus(now);
  }

  // Get current contents, strongest first.
  read(topN = CAPACITY) {
    this.tick();
    return [...this.slots]
      .sort((a, b) => b.strength - a.strength)
      .slice(0, topN);
  }

  format() {
    const items = this.read().filter(s => s.type !== 'input');
    if (items.length === 0) return '(working memory empty)';
    return items.map(s => `[${s.type}] ${s.content}`).join('\n');
  }

  flush() {
    this.slots = [];
    this.focus = null;
  }

  snapshot() {
    return {
      version: 1,
      slots: this.slots.map(s => ({ ...s })),
      focus: this.focus ? { ...this.focus, entities: [...this.focus.entities] } : null,
    };
  }

  restore(snapshot) {
    if (!snapshot) return this;
    this.slots = (snapshot.slots || []).map(s => ({ ...s }));
    this.focus = snapshot.focus ? { ...snapshot.focus, entities: [...(snapshot.focus.entities || [])] } : null;
    return this;
  }

  get size() { return this.slots.length; }
}

module.exports = { WorkingMemory, CAPACITY, SOURCE_PRIORITY };
