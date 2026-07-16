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

function tokens(text) {
    return new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []);
}

function similarity(a, b) {
    const left = tokens(a);
    const right = tokens(b);
    if (left.size === 0 || right.size === 0) return 0;
    let shared = 0;
    for (const token of left) if (right.has(token)) shared++;
    return shared / (left.size + right.size - shared);
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

        // Keep provenance distinct: two independent sources agreeing with the
        // same claim are evidence, not a duplicate to overwrite.
        const existing = this.items.find(item => item.topic === key && item.claim === text && item.source === source);
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

    // A deliberation is deliberately structured data, not generated prose.
    // Claims cluster only when their content agrees; a conclusion needs either
    // verified evidence or agreement from independent sources.
    deliberate(topic) {
        const evidence = this.recall(topic, 8);
        const clusters = [];
        for (const item of evidence) {
            let cluster = clusters.find(group => similarity(group.claim, item.claim) >= 0.55);
            if (!cluster) {
                cluster = { claim: item.claim, items: [], sources: new Set(), verified: false, confidence: 0 };
                clusters.push(cluster);
            }
            cluster.items.push(item);
            cluster.sources.add(item.source);
            cluster.verified ||= item.verified;
            cluster.confidence += item.confidence;
        }

        for (const cluster of clusters) cluster.confidence /= cluster.items.length;
        clusters.sort((a, b) => (b.verified - a.verified) || (b.sources.size - a.sources.size) || (b.confidence - a.confidence));
        const leading = clusters[0] || null;
        const concluded = !!leading && (leading.verified || (leading.sources.size >= 2 && leading.confidence >= 0.45));

        return {
            topic: normaliseTopic(topic),
            evidenceCount: evidence.length,
            alternatives: clusters.map(group => ({
                claim: group.claim,
                sources: [...group.sources],
                confidence: group.confidence,
                verified: group.verified,
            })),
            concluded,
            conclusion: concluded ? { claim: leading.claim, verified: leading.verified, sources: [...leading.sources] } : null,
        };
    }
}
