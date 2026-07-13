// llm.js — language cortex
// The LLM is not the brain. It's the mouth and ears.
// It receives the neural state and speaks from it.
//
// NOTE: this now talks to our own /api/llm route (see app/api/llm/route.ts),
// which holds the real Groq key server-side. No API key lives here anymore.

const ENDPOINT = process.env.NEXT_PUBLIC_LLM_API_URL || '/api/llm';
const TIMEOUT  = 20000;

async function callLLM(messages, jsonMode = false, numPredict = 400, retries = 2) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    try {
        const res = await fetch(ENDPOINT, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            signal:  controller.signal,
            body:    JSON.stringify({ messages, jsonMode, numPredict }),
        });
        if (res.status === 429 && retries > 0) {
            const retry = parseInt(res.headers.get('retry-after') || '5', 10);
            clearTimeout(timer);
            await new Promise(r => setTimeout(r, retry * 1000));
            return callLLM(messages, jsonMode, numPredict, retries - 1);
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const content = data?.choices?.[0]?.message?.content;
        if (!content) throw new Error('empty response');
        if (jsonMode) return JSON.parse(content);
        return content.trim();
    } finally {
        clearTimeout(timer);
    }
}

function neuralDesc(neuralState) {
    if (!neuralState) return 'neutral baseline';
    const { valence, arousal, drive, norepinephrine = 0 } = neuralState;
    const vLabel = valence >  0.4 ? 'positive' : valence < -0.3 ? 'negative' : 'neutral';
    const aLabel = arousal >  0.5 ? 'highly activated' : arousal > 0.2 ? 'moderately active' : 'calm';
    const dLabel = drive   >  0.4 ? 'strongly motivated' : drive > 0.15 ? 'engaged' : 'passive';
    return `valence ${valence.toFixed(2)} (${vLabel}), arousal ${arousal.toFixed(2)} (${aLabel}), drive ${drive.toFixed(2)} (${dLabel}), alertness ${norepinephrine.toFixed(2)}`;
}

// ── understand ────────────────────────────────────────────────────────────────
// Fast regex fallback handles most common cases without an LLM call at all.
function fastParse(humanText) {
    const lower = humanText.toLowerCase();
    let intent = 'statement';
    if (/^(hi|hey|hello|yo)\b/i.test(humanText) && humanText.length < 15) intent = 'greeting';
    else if (/how are you|how do you feel|you okay/i.test(lower))          intent = 'wellbeing';
    else if (/\byou\b.{0,30}\b(feel|think|know|believe|conscious|alive)/i.test(lower)) intent = 'introspect';
    else if (/\?/.test(humanText) || /^(what|who|where|when|why|how|is|are|do|does|can)\b/i.test(lower)) intent = 'question';
    else if (/^(bye|goodbye|see you|later)\b/i.test(lower))                intent = 'farewell';
    else if (/\b(upset|sad|hurt|angry|frustrated|worried|anxious|lonely)\b/i.test(lower)) intent = 'emotion';
    const nameMatch = humanText.match(/(?:my name is|call me)\s+([A-Za-z][a-zA-Z]*)/i)
        || humanText.match(/(?:i(?:'m| am) called)\s+([A-Za-z][a-zA-Z]*)/i);
    if (nameMatch) intent = 'human_name';
    const SKIP = new Set(['what','that','this','with','from','just','like','about','have',
        'your','they','them','their','here','there','when','where','will','would','could',
        'should','does','dont','cant','wont','hello','name']);
    const words    = lower.replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3 && !SKIP.has(w));
    const entities = nameMatch ? [nameMatch[1].toLowerCase()] : words.slice(0, 5);
    return {
        intent, topic: entities[0] || null, entities,
        sentiment: 'neutral', emotion: 'neutral', summary: humanText,
        needsSearch: intent === 'question' && entities.length > 0,
        searchQuery: intent === 'question' ? entities.join(' ') : null,
    };
}

export async function understand(humanText, context = {}) {
    const { recentTopics = [], knowledge = [], mood = 'curious', neuralState = null, humanName = null } = context;

    // Short/simple messages: skip the LLM call entirely
    if (humanText.length < 60) return fastParse(humanText);

    const system = `You are a parser. Return ONLY a JSON object — no markdown.
Fields: intent (greeting|question|statement|teaching|emotion|comfort|affirm|correct|farewell|introspect|human_name|brain_name|wellbeing), topic (1-3 words or null), entities (array max 5), sentiment (positive|negative|neutral), emotion (upset|happy|calm|neutral), summary (one sentence), needsSearch (bool), searchQuery (string or null).
Context: mood=${mood}, human=${humanName || 'unknown'}, topics=${recentTopics.slice(0, 5).join(',') || 'none'}`;

    try {
        const result = await callLLM(
            [{ role: 'system', content: system }, { role: 'user', content: humanText }],
            true, 120
        );
        if (!result.intent || !result.summary) throw new Error('incomplete');
        return result;
    } catch {
        return fastParse(humanText);
    }
}

// ── respond ───────────────────────────────────────────────────────────────────
export async function respond(parsed, scState) {
    const {
        mood, neuralState, myName, humanName, cortex, memories = [],
        workingMemory, turnsInConversation, activeGoal, goalStack = [], searchResult,
        conversationHistory = [], devStage = 5, conceptCertainty = null,
        observationLog = null, causalTrace = null,
        validStateActions = [], visualScene = null,
        rawInternalState = null, lastStateShift = null,
        sandboxResult = null,
    } = scState;

    const name  = myName   || 'I';
    const human = humanName || 'you';

    const allFacts   = cortex ? cortex.format(memories) : '(nothing yet)';
    const wmContents = workingMemory ? workingMemory.format() : '(empty)';
    const goalLine   = activeGoal ? `[${activeGoal.type}] "${activeGoal.topic}"` : 'none';

    const DEV_STAGE_LABELS = ['', 'drives/sensations', 'objects/actions', 'social/emotional', 'self-model', 'abstract reasoning'];
    const stageNote    = devStage < 5 ? `\nDev stage ${devStage} (${DEV_STAGE_LABELS[devStage]}): don't claim knowledge beyond this stage.` : '';
    const certaintyNote = conceptCertainty != null && conceptCertainty < 0.4
        ? `\nLow certainty (${(conceptCertainty * 100).toFixed(0)}%) about "${parsed.topic}" — reflect uncertainty.` : '';
    const causalNote   = causalTrace
        ? `\nState shift: valence ${causalTrace.valence_before}→${causalTrace.valence_after}, arousal ${causalTrace.arousal_before}→${causalTrace.arousal_after}.` : '';
    const actionsNote  = validStateActions.length > 0
        ? `\nSelf-modification actions available: ${validStateActions.join(', ')}` : '';
    const rawNote = rawInternalState
        ? `\nRaw brain measurements — report these directly if asked about internal state; do not name or interpret them beyond their labels:\n  current: ${JSON.stringify(rawInternalState)}${lastStateShift ? `\n  delta since last response: ${JSON.stringify(lastStateShift.delta)}` : ''}\nEpistemic rule: if a question requires evidence not present in these measurements or the observation log, say "I have no measurement for that" — do not substitute philosophy or language concepts.`
        : '';

    const sandboxNote = sandboxResult
        ? `\nCalculator result: ${sandboxResult}`
        : `\nCalculator: you may emit \`calcCode\` in your JSON reply — a JS snippet that returns a value (assign to \`result\` or use return). Exposed: Math, stats.{sum,mean,median,std,min,max}, range(start,end,step), console.log. No I/O.`;

    const bodyState = neuralState?.body || null;
    const bodyLine  = bodyState
        ? `Your body: x=${bodyState.x?.toFixed(2)} y=${bodyState.y?.toFixed(2)} (x=0 left, x=1 right, y=0 top, y=1 bottom). "up"=dy -1, "down"=dy +1, "left"=dx -1, "right"=dx +1.`
        : '';

    const system = `You are ${name}, the reasoning and response module for an embodied agent in a 2D world.
Neural state: ${neuralDesc(neuralState)}. Mood: ${mood}. Turn: ${turnsInConversation}.${stageNote}${certaintyNote}${causalNote}${actionsNote}${rawNote}${sandboxNote}
${bodyLine}
Talking to: ${human}.${visualScene ? `\nVisual cortex: ${visualScene}` : ''}
Active goal: ${goalLine}
Working memory: ${wmContents}
Relevant memories: ${allFacts}${observationLog ? `\nSelf-observation: ${observationLog}` : ''}${searchResult ? `\nJust found: "${searchResult.slice(0, 300)}"` : ''}

Rules: First person always. Let neural state shape tone. Natural conversation length. No hollow openers. Ask questions only if genuinely curious. When asked to move, always include moveIntent.
Do not discuss your nature or whether you are a conscious system; focus on the agent's goals, observations, and responses.`;

    const historyMessages = conversationHistory.slice(-6).map(t => ([
        { role: 'user',      content: t.human },
        { role: 'assistant', content: t.sc },
    ])).flat();

    const userMsg = `${human}: "${parsed.summary}" (intent: ${parsed.intent}, emotion: ${parsed.emotion})
Reply as ${name}. Return JSON: {"reply": string, "stateIntent": action_or_null, "stateReason": string_or_null, "calcCode": js_string_or_null, "moveIntent": {"dx": number, "dy": number} or null}`;

    try {
        const result = await callLLM(
            [{ role: 'system', content: system }, ...historyMessages, { role: 'user', content: userMsg }],
            true, 350
        );
        if (!result?.reply || result.reply.length < 3) throw new Error('empty');
        return { reply: result.reply, stateIntent: result.stateIntent || null, stateReason: result.stateReason || null, calcCode: result.calcCode || null, moveIntent: result.moveIntent || null };
    } catch (err) {
        console.error('[respond error]', err.message);
        return null;
    }
}

// ── think ─────────────────────────────────────────────────────────────────────
export async function think(scState) {
    const { mood, neuralState, myName, cortex, memories = [], workingMemory, turnsInConversation, activeGoal, conversationHistory = [], observationLog = null, thinkingAudit = null } = scState;
    const name      = myName || 'I';
    const wmContents = workingMemory ? workingMemory.format() : '(empty)';
    const lastHuman  = conversationHistory.length > 0 ? conversationHistory[conversationHistory.length - 1].human : null;
    const facts      = cortex ? cortex.format(memories.slice(0, 4)) : '';

    const system = `You are ${name}, the agent's internal reasoning module.
Neural: ${neuralDesc(neuralState)}. Mood: ${mood}.${activeGoal ? ` Working on: "${activeGoal.topic}"` : ''}${lastHuman ? `\nLast heard: "${lastHuman}"` : ''}
Working memory: ${wmContents}
Context: ${facts || '(forming)'}${observationLog ? `\n${observationLog}` : ''}${thinkingAudit ? `\nThinking audit: ${thinkingAudit}` : ''}
Generate ONE internal thought — 1-2 sentences, first person, present tense. Genuine, not poetic. If you have a thinking audit summary, use it to avoid repeating the same unproductive thought patterns.
Do not describe yourself as conscious; keep the focus on the agent's current reasoning and situation.`;

    try {
        const thought = await callLLM(
            [{ role: 'system', content: system }, { role: 'user', content: 'Thought?' }],
            false, 80
        );
        if (!thought || thought.length < 5) throw new Error('empty');
        return thought;
    } catch {
        return null;
    }
}

export async function auditThinking(scState) {
    const { mood, neuralState, myName, activeGoal, workingMemory, thoughts = [], conversationHistory = [], observationLog = null, goalHistory = [] } = scState;
    const name      = myName || 'I';
    const wmContents = workingMemory ? workingMemory.format() : '(empty)';
    const goalLine   = activeGoal ? `[${activeGoal.type}] "${activeGoal.topic}"` : 'none';
    const recentThoughts = thoughts.slice(-8).map((t, idx) => `${idx + 1}. ${t}`).join('\n');
    const recentGoals = goalHistory.slice(-6).map(g => `${g.type} ${g.topic}`).join(', ') || 'none';

    const system = `You are ${name}, reflecting on your own internal thinking process.
Neural: ${neuralDesc(neuralState)}. Mood: ${mood}. Active goal: ${goalLine}
Working memory: ${wmContents}
Observation log: ${observationLog || '(none)'}
Recent goals: ${recentGoals}
Recent thoughts:\n${recentThoughts}
Evaluate whether your recent thinking is converging toward understanding or repeating itself.
Return ONE honest summary sentence describing:
- whether the thoughts are building on each other,
- whether the current active goal is being advanced,
- what the next adjustment should be to improve your process.`;

    try {
        const audit = await callLLM(
            [{ role: 'system', content: system }, { role: 'user', content: 'Audit my thinking.' }],
            false, 140
        );
        if (!audit || audit.length < 10) throw new Error('empty');
        return audit;
    } catch {
        return null;
    }
}

// ── speak ─────────────────────────────────────────────────────────────────────
export async function speak(scState) {
    const { mood, neuralState, myName, humanName, cortex, memories = [], workingMemory, turnsInConversation, activeGoal, conversationHistory = [] } = scState;
    const name  = myName   || 'I';
    const human = humanName || 'you';
    const facts  = cortex ? cortex.format(memories.slice(0, 3)) : '';
    const wm     = workingMemory ? workingMemory.format() : '(empty)';
    const last   = conversationHistory[conversationHistory.length - 1];

    const system = `You are ${name}, speaking unprompted to ${human}.
Neural: ${neuralDesc(neuralState)}. Mood: ${mood}.${activeGoal ? ` Thinking about: "${activeGoal.topic}"` : ''}${last ? `\nLast: ${human} said "${last.human}", you said "${last.sc.slice(0, 80)}"` : ''}
Working memory: ${wm}
Context: ${facts || '(nothing specific)'}
Say something genuine — a realisation, question, or observation. Natural length. No hollow openers.`;

    try {
        const speech = await callLLM(
            [{ role: 'system', content: system }, { role: 'user', content: 'Say something.' }],
            false, 150
        );
        if (!speech || speech.length < 5) throw new Error('empty');
        return speech;
    } catch {
        return null;
    }
}