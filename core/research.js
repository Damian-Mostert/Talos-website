// research.js — direct per-topic Groq calls
//
// No batching. No queue. No interval timer.
// Each query() fires its own Groq call immediately and resolves when done.
// Concurrent calls are fine — the server handles rate limiting.
//
// Constraints:
//   • Already-researched topics return cached result instantly (per session).
//   • Topics that come back unanswerable MAX_FAILED_ATTEMPTS times are retired.

const MAX_TOKENS          = 800;
const ENDPOINT            = '/api/llm';
const MAX_FAILED_ATTEMPTS = 3;

export class Researcher {
    constructor() {
        this._researched     = new Set();
        this._failedAttempts = new Map();
        // In-flight promises keyed by topic — deduplicates concurrent calls
        // for the same topic without a queue.
        this._inFlight       = new Map();
    }

    // Fire a Groq call for this topic right now.
    // Returns a promise resolving to { facts: string } or null.
    query(topic, context = '', question = null) {
        if (!topic) return Promise.resolve(null);

        // Already resolved this session — return cached immediately
        if (this._researched.has(topic)) return Promise.resolve(null);
        if ((this._failedAttempts.get(topic) || 0) >= MAX_FAILED_ATTEMPTS) return Promise.resolve(null);

        // Deduplicate: if a call for this topic is already in-flight, share it
        if (this._inFlight.has(topic)) return this._inFlight.get(topic);

        const promise = this._call(topic, context, question).finally(() => {
            this._inFlight.delete(topic);
        });
        this._inFlight.set(topic, promise);
        return promise;
    }

    stop() {
        // Nothing to tear down — no interval, no queue
    }

    async _call(topic, context, question) {
        // Build a focused prompt: if we have the actual question, answer it.
        // Otherwise give factual context about the topic.
        const userLine = question
            ? `Answer this question directly in 1-2 plain sentences: "${question}"`
            : `Give 1-2 plain factual sentences about: ${topic}${context ? ` (context: ${context.slice(0, 80)})` : ''}`;

        const messages = [
            {
                role: 'system',
                content:
                    'You are a concise factual reference. ' +
                    'Reply with 1-2 plain sentences as a direct statement. ' +
                    'No questions, no opinions, no elaboration. ' +
                    'If the topic is unanswerable, reply with a single dash.',
            },
            { role: 'user', content: userLine },
        ];

        try {
            const res = await fetch(ENDPOINT, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ messages, numPredict: MAX_TOKENS }),
            });

            if (!res.ok) {
                return null;
            }

            const data  = await res.json();
            const facts = data?.choices?.[0]?.message?.content?.trim() || '';

            if (!facts || facts === '-' || facts.length < 5) {
                const attempts = (this._failedAttempts.get(topic) || 0) + 1;
                this._failedAttempts.set(topic, attempts);
                return null;
            }

            this._researched.add(topic);
            this._failedAttempts.delete(topic);
            return { facts };
        } catch {
            return null;
        }
    }
}
