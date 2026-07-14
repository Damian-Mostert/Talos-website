// beliefs.js — a small, explicit knowledge layer.
//
// Memories record what was encountered. Beliefs record what Talos currently
// treats as a claim, how certain it is, and where it came from. Keeping those
// roles separate prevents a generated research sentence or a repeated thought
// from silently becoming "knowledge".

const MAX_BELIEFS = 500;

function normaliseTopic(topic) {
    return String(topic || '').toLowerCase().trim().replace(/\s+/g, ' ');
}

export class BeliefStore {
    constructor() {
        this.items = [];
        this._nextId = 0;
    }

    record({ topic, claim, source = 'internal', confidence = 0.25, verified = false }) {
        const key = normaliseTopic(topic);
        const text = String(claim || '').trim();
        if (!key || text.length < 3) return null;

        const existing = this.items.find(item => item.topic === key && item.claim === text);
        if (existing) {
            existing.confidence = Math.max(existing.confidence, confidence);
            existing.verified ||= verified;
            existing.source = verified ? source : existing.source;
            existing.updatedAt = Date.now();
            return existing;
        }

        const item = {
            id: this._nextId++, topic: key, claim: text, source,
            confidence: Math.max(0, Math.min(1, confidence)), verified: !!verified,
            createdAt: Date.now(), updatedAt: Date.now(),
        };
        this.items.push(item);
        if (this.items.length > MAX_BELIEFS) {
            this.items.sort((a, b) => (b.verified - a.verified) || (b.confidence - a.confidence) || (b.updatedAt - a.updatedAt));
            this.items.length = MAX_BELIEFS;
        }
        return item;
    }

    recall(topic, limit = 3) {
        const key = normaliseTopic(topic);
        if (!key) return [];
        return this.items
            .filter(item => item.topic === key || item.topic.includes(key) || key.includes(item.topic))
            .sort((a, b) => (b.verified - a.verified) || (b.confidence - a.confidence) || (b.updatedAt - a.updatedAt))
            .slice(0, limit);
    }

    best(topic) {
        return this.recall(topic, 1)[0] || null;
    }
}
