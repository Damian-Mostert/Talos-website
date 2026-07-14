// research.js — batched background research
//
// Topics accumulate in a queue. Every BATCH_INTERVAL_MS a single Groq call
// covers up to BATCH_SIZE topics at once, getting a numbered list back.
// Each topic's promise resolves with { facts: string } when its result arrives.
//
// Constraints:
//   • Never used in the conversation/response path — research only.
//   • Never returns text to be spoken. Callers encode the result themselves.
//   • One in-flight request at a time — next batch waits for current to finish.
//   • Already-researched topics are skipped (per session).
//   • Topics that come back unanswerable repeatedly are also retired (per
//     session) after a few tries, so a malformed/ungrounded topic string
//     doesn't keep spending a real LLM call every batch forever.

const BATCH_INTERVAL_MS     = 1000;  // drain queue every 1 s
const BATCH_SIZE            = 5;     // topics per call
const MAX_TOKENS             = 5000;  // ~200/topic at BATCH_SIZE=5 — enough headroom that a
                                       // normal 1-2 sentence answer doesn't push later topics
                                       // off the end of the response. See route.ts for the
                                       // matching server-side cap.
const ENDPOINT              = '/api/llm';
const MAX_FAILED_ATTEMPTS   = 3;      // give up on an unanswerable topic after this many tries

export class Researcher {
    constructor() {
        this._queue          = [];   // { topic, context, resolve, reject }[]
        this._inFlight       = false;
        this._researched     = new Set();
        this._failedAttempts = new Map(); // topic → count of unanswerable results
        this._interval       = setInterval(() => this._drain(), BATCH_INTERVAL_MS);
    }

    // Enqueue a topic. Returns a promise that resolves to { facts } or null.
    query(topic, context = '') {
        if (!topic || this._researched.has(topic)) return Promise.resolve(null);
        if ((this._failedAttempts.get(topic) || 0) >= MAX_FAILED_ATTEMPTS) return Promise.resolve(null);
        // Deduplicate pending queue entries for the same topic
        const pending = this._queue.find(e => e.topic === topic);
        if (pending) return new Promise((resolve, reject) => {
            const orig = pending.resolve;
            pending.resolve = v => { orig(v); resolve(v); };
            const origR = pending.reject;
            pending.reject = e => { origR(e); reject(e); };
        });
        return new Promise((resolve, reject) => {
            this._queue.push({ topic, context, resolve, reject });
        });
    }

    stop() {
        clearInterval(this._interval);
    }

    async _drain() {
        if (this._inFlight || this._queue.length === 0) return;

        const batch = this._queue.splice(0, BATCH_SIZE);
        this._inFlight = true;

        const topicLines = batch
            .map((e, i) => `${i + 1}. ${e.topic}${e.context ? ` (context: ${e.context.slice(0, 60)})` : ''}`)
            .join('\n');

        const messages = [
            {
                role: 'system',
                content:
                    'You are a concise factual reference. ' +
                    'For each numbered topic, reply with exactly one line: ' +
                    'the number, a period, then 1-2 sentences of plain facts. ' +
                    'No opinions, no elaboration, no questions. ' +
                    'If a topic is unanswerable write the number then a dash.',
            },
            {
                role: 'user',
                content: `Give me facts about each of these topics:\n${topicLines}`,
            },
        ];

        try {
            const res = await fetch(ENDPOINT, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json' },
                body:    JSON.stringify({ messages, numPredict: MAX_TOKENS }),
            });

            if (!res.ok) {
                batch.forEach(e => e.resolve(null));
                return;
            }

            const data = await res.json();
            const raw  = data?.choices?.[0]?.message?.content?.trim() || '';

            // Parse "1. facts...\n2. facts..." back into per-topic results
            const lines = raw.split(/\n+/);
            const results = new Map(); // index (1-based) → facts string
            for (const line of lines) {
                const m = line.match(/^(\d+)\.\s*(.+)/);
                if (m) results.set(parseInt(m[1], 10), m[2].trim());
            }

            batch.forEach((e, i) => {
                const facts = results.get(i + 1);
                if (facts && facts !== '-' && facts.length > 5) {
                    this._researched.add(e.topic);
                    this._failedAttempts.delete(e.topic);
                    e.resolve({ facts });
                } else if (results.has(i + 1)) {
                    // The model addressed this topic and explicitly said it
                    // couldn't ("-" or a too-short non-answer). That's a real
                    // signal — count it against the attempt budget.
                    const attempts = (this._failedAttempts.get(e.topic) || 0) + 1;
                    this._failedAttempts.set(e.topic, attempts);
                    e.resolve(null);
                } else {
                    // This topic's number never showed up in the response at
                    // all — almost always means the reply got cut off before
                    // reaching it (batch ran past the token budget), not that
                    // the model judged it unanswerable. Don't burn an attempt
                    // on bad luck with token budget — just resolve null for
                    // this round so it's retried at full priority next time.
                    e.resolve(null);
                }
            });
        } catch {
            // Network/parse failure isn't the same as "the model said this is
            // unanswerable" — don't count it against the topic's attempt budget,
            // just resolve null for this round and let it be retried later.
            batch.forEach(e => e.resolve(null));
        } finally {
            this._inFlight = false;
        }
    }
}