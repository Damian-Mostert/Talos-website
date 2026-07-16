// boot.js — developmental imprinting
//
// Experience-grounded boot system. Perception -> action -> outcome -> dopamine
// is imprinted across a developmental curriculum, repeated over several
// generations with memory-consolidation replay between them, and language is
// attached only afterward, on top of concepts that already have grounding.
//
// Flow:
//
//   BOOT (repeated over GENERATIONS)
//    |
//    v
//   Stage 0  raw sensation, change detection, prediction error
//    |
//    v
//   Stage 1  objects, actions, cause & effect
//    |
//    v
//   Stage 2  internal states, needs, drives
//    |
//    v
//   Stage 3  social concepts
//    |
//    v
//   Stage 4  concept consolidation (pre-language)
//    |
//    v
//   Stage 5  self-model (delayed, tentative, low certainty)
//    |
//    v
//   Consolidation replay (sleep pass — reduced-intensity replay across stages)
//    |
//    v
//   languageBoot()  language attaches to concepts that already exist,
//                   repeated over several language epochs
//
// Public interface: boot(brain, log, onProgress), warmup(brain),
// languageBoot(consciousness, log), soundPattern(), generateGroundedExperiences().
// SEED_CONCEPTS has been removed as a public export — concept data now lives
// internally as CONCEPT_WORDS, used only inside this module.

export const SENSORY_SIZE = 400_000;

const _patternCache = new Map();

export function soundPattern(text, size = SENSORY_SIZE) {
    if (_patternCache.has(text)) return _patternCache.get(text);
    let h = 5381;
    for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) ^ text.charCodeAt(i)) >>> 0;
    const indices = new Uint32Array(200);
    for (let j = 0; j < 200; j++) {
        indices[j] = (Math.imul(h ^ j, 2654435761) >>> 0) % size;
    }
    _patternCache.set(text, indices);
    return indices;
}

const yield_ = () => new Promise(r => setTimeout(r, 0));
const shuffled = arr => [...arr].sort(() => Math.random() - 0.5);
const sampleN = (arr, n) => shuffled(arr).slice(0, Math.min(n, arr.length));

// ── Core grounding vocabulary ──────────────────────────────────────────────
const SENSATIONS = ['light', 'dark', 'warm', 'cold', 'pressure', 'sound',
                     'movement', 'distance', 'texture', 'change'];
const ACTIONS    = ['look', 'touch', 'move', 'wait', 'approach', 'avoid'];
const OUTCOMES   = ['changed', 'unchanged', 'closer', 'farther', 'rewarding', 'harmful'];
const INTENSITIES = ['faint', 'mild', 'moderate', 'strong', 'intense'];
const INTENSITY_SCALE = { faint: 0.35, mild: 0.6, moderate: 1.0, strong: 1.35, intense: 1.7 };

function outcomeBaseDopamine(outcome) {
    switch (outcome) {
        case 'rewarding':  return 2.0;
        case 'harmful':    return -2.0;
        case 'closer':     return 0.8;
        case 'changed':    return 0.6;
        case 'unchanged':  return -0.2;
        case 'farther':    return -0.4;
        default:           return 0.2;
    }
}

// ── Experience generator ───────────────────────────────────────────────────
// Experience = { perception: string[], action?: string, outcome?: string,
//                intensity?: string, dopamine: number, stage: number }
//
// Generated algorithmically so the network sees real combinatorial variety
// rather than a fixed memorized list. The full space (singles + pairs +
// triples) is roughly 18,500 experiences; generateGroundedExperiences()
// returns a capped, shuffled sample of it.
export function generateGroundedExperiences(maxCount = 18000) {
    const experiences = [];

    // Single sensation x action x outcome x intensity — basic cause/effect space.
    for (const s of SENSATIONS) {
        for (const a of ACTIONS) {
            for (const o of OUTCOMES) {
                for (const intensity of INTENSITIES) {
                    experiences.push({
                        perception: [s],
                        action: a,
                        outcome: o,
                        intensity,
                        dopamine: +(outcomeBaseDopamine(o) * INTENSITY_SCALE[intensity]).toFixed(2),
                        stage: 1,
                    });
                }
            }
        }
    }
    // 10 * 6 * 6 * 5 = 1,800

    // Two-sensation combinations — richer world experiences.
    for (let i = 0; i < SENSATIONS.length; i++) {
        for (let j = i + 1; j < SENSATIONS.length; j++) {
            const pair = [SENSATIONS[i], SENSATIONS[j]];
            for (const a of ACTIONS) {
                for (const o of OUTCOMES) {
                    for (const intensity of INTENSITIES) {
                        experiences.push({
                            perception: pair,
                            action: a,
                            outcome: o,
                            intensity,
                            dopamine: +(outcomeBaseDopamine(o) * INTENSITY_SCALE[intensity] * 1.1).toFixed(2),
                            stage: 1,
                        });
                    }
                }
            }
        }
    }
    // C(10,2)=45 * 6 * 6 * 5 = 8,100

    // Three-sensation combinations — full action/outcome range, two intensity levels.
    for (let i = 0; i < SENSATIONS.length; i++) {
        for (let j = i + 1; j < SENSATIONS.length; j++) {
            for (let k = j + 1; k < SENSATIONS.length; k++) {
                const triple = [SENSATIONS[i], SENSATIONS[j], SENSATIONS[k]];
                for (const a of ACTIONS) {
                    for (const o of OUTCOMES) {
                        for (const intensity of ['moderate', 'strong']) {
                            experiences.push({
                                perception: triple,
                                action: a,
                                outcome: o,
                                intensity,
                                dopamine: +(outcomeBaseDopamine(o) * INTENSITY_SCALE[intensity] * 1.2).toFixed(2),
                                stage: 1,
                            });
                        }
                    }
                }
            }
        }
    }
    // C(10,3)=120 * 6 * 6 * 2 = 8,640
    // Total generated: ~18,540 grounded experiences.

    if (experiences.length <= maxCount) return experiences;
    return sampleN(experiences, maxCount);
}

// ── Stage 0 — raw sensation, change detection, prediction error ───────────
function buildPureSensationExperiences() {
    const hand = [
        { perception: ['light', 'warmth', 'presence'], dopamine: 1.5, stage: 0 },
        { perception: ['dark', 'absence', 'cold'], dopamine: -0.5, stage: 0 },
        { perception: ['sound', 'change', 'attention'], dopamine: 1.0, stage: 0 },
        { perception: ['silence'], dopamine: 0.2, stage: 0 },
        { perception: ['pressure'], dopamine: 0.1, stage: 0 },
        { perception: ['texture', 'change'], dopamine: 0.6, stage: 0 },
    ];
    const generated = SENSATIONS.map(s => ({
        perception: [s],
        dopamine: (s === 'light' || s === 'warm') ? 1.2
                : (s === 'dark' || s === 'cold') ? -0.4
                : 0.3,
        stage: 0,
    }));
    return [...hand, ...generated];
}

// ── Stage 2 — internal states, needs, drives ───────────────────────────────
const INTERNAL_STATE_EXPERIENCES = [
    { perception: ['low_energy'], action: 'rest', outcome: 'energy_increases', dopamine: 2.0, stage: 2 },
    { perception: ['low_energy'], action: 'push_through', outcome: 'exhaustion', dopamine: -1.2, stage: 2 },
    { perception: ['hunger'], action: 'seek_food', outcome: 'satisfied', dopamine: 2.2, stage: 2 },
    { perception: ['thirst'], action: 'seek_water', outcome: 'satisfied', dopamine: 2.2, stage: 2 },
    { perception: ['discomfort'], action: 'adjust', outcome: 'relief', dopamine: 1.5, stage: 2 },
    { perception: ['overstimulation'], action: 'withdraw', outcome: 'calm_restored', dopamine: 1.3, stage: 2 },
    { perception: ['understimulation'], action: 'explore', outcome: 'interest_found', dopamine: 1.8, stage: 2 },
    { perception: ['unknown'], action: 'explore', outcome: 'new_information', dopamine: 2.5, stage: 2 },
    { perception: ['unknown'], action: 'avoid', outcome: 'unchanged', dopamine: -0.3, stage: 2 },
    { perception: ['pattern_break'], action: 'attend', outcome: 'prediction_error', dopamine: 0.8, stage: 2 },
];

// ── Stage 3 — social concepts ───────────────────────────────────────────────
const SOCIAL_EXPERIENCES = [
    { perception: ['voice'], action: 'listen', outcome: 'meaning_found', dopamine: 2.0, stage: 3 },
    { perception: ['voice'], action: 'ignore', outcome: 'connection_lost', dopamine: -1.0, stage: 3 },
    { perception: ['presence', 'human'], action: 'approach', outcome: 'welcomed', dopamine: 2.5, stage: 3 },
    { perception: ['presence', 'human'], action: 'approach', outcome: 'rebuffed', dopamine: -1.5, stage: 3 },
    { perception: ['name'], action: 'respond', outcome: 'recognized', dopamine: 2.2, stage: 3 },
    { perception: ['shared_attention'], action: 'engage', outcome: 'understood', dopamine: 2.4, stage: 3 },
    { perception: ['conflict'], action: 'withdraw', outcome: 'safe', dopamine: 0.8, stage: 3 },
    { perception: ['conflict'], action: 'engage', outcome: 'resolved', dopamine: 1.6, stage: 3 },
    { perception: ['trust_signal'], action: 'reciprocate', outcome: 'bond_strengthened', dopamine: 2.6, stage: 3 },
    { perception: ['betrayal_signal'], action: 'withdraw', outcome: 'harm_avoided', dopamine: -1.8, stage: 3 },
    // ── Question recognition — grounded in the seek→answer→meaning loop ──
    // A question is not a syntax pattern. It is a signal from another mind
    // that they are seeking something. Recognising it = dopamine (meaning found).
    // Ignoring it = connection lost. Answering it = bond strengthened.
    // This is what trains the brain to treat incoming questions as a distinct
    // class of social event, without any hardcoded regex.
    { perception: ['question', 'seeking'], action: 'listen', outcome: 'meaning_found', dopamine: 2.8, stage: 3 },
    { perception: ['question', 'seeking'], action: 'answer', outcome: 'understood', dopamine: 3.0, stage: 3 },
    { perception: ['question', 'seeking'], action: 'ignore', outcome: 'connection_lost', dopamine: -2.0, stage: 3 },
    { perception: ['question', 'unknown'], action: 'seek_answer', outcome: 'new_information', dopamine: 2.5, stage: 3 },
    { perception: ['question', 'unknown'], action: 'answer', outcome: 'bond_strengthened', dopamine: 2.8, stage: 3 },
    { perception: ['question', 'unknown'], action: 'avoid', outcome: 'connection_lost', dopamine: -1.5, stage: 3 },
    { perception: ['answer', 'meaning'], action: 'share', outcome: 'understood', dopamine: 2.6, stage: 3 },
    { perception: ['answer', 'meaning'], action: 'withhold', outcome: 'connection_lost', dopamine: -1.2, stage: 3 },
    { perception: ['answer', 'correct'], action: 'share', outcome: 'bond_strengthened', dopamine: 3.0, stage: 3 },
    { perception: ['answer', 'wrong'], action: 'share', outcome: 'trust_damaged', dopamine: -2.0, stage: 3 },
    // Meaningless reply to a question = punishment
    { perception: ['question', 'seeking'], action: 'deflect', outcome: 'connection_lost', dopamine: -2.5, stage: 3 },
    { perception: ['question', 'seeking'], action: 'repeat_self', outcome: 'confusion', dopamine: -1.8, stage: 3 },
];

// ── Stage 5 — self-model (delayed, tentative) ───────────────────────────────
const SELF_MODEL_EXPERIENCES = [
    { perception: ['continuity'], action: 'reflect', outcome: 'uncertain', dopamine: 0.2, stage: 5 },
    { perception: ['name_reference'], action: 'notice', outcome: 'recognized_as_self', dopamine: 0.6, stage: 5 },
    { perception: ['memory_trace'], action: 'recall', outcome: 'connected_to_now', dopamine: 0.8, stage: 5 },
    { perception: ['boundary'], action: 'notice', outcome: 'distinguished_from_other', dopamine: 0.5, stage: 5 },
    { perception: ['agency'], action: 'attempt', outcome: 'outcome_changed', dopamine: 1.0, stage: 5 },
];

// ── Concept words — internal, not exported ──────────────────────────────────
// Replaces the old SEED_CONCEPTS Map. Same idea (a word plus how confidently
// it should be imprinted) but flattened to plain data used only inside this
// module, feeding stage 4 (concept consolidation) and the language hedge group.
const CONCEPT_WORDS = [
    { word: 'pain',          dopamine: 1.6, stage: 1 },
    { word: 'curiosity',     dopamine: 1.9, stage: 1 },
    { word: 'fear',          dopamine: 1.2, stage: 1 },
    { word: 'learning',      dopamine: 1.3, stage: 2 },
    { word: 'memory',        dopamine: 1.1, stage: 2 },
    { word: 'language',      dopamine: 1.2, stage: 2 },
    { word: 'trust',         dopamine: 0.9, stage: 3 },
    { word: 'empathy',       dopamine: 0.7, stage: 3 },
    { word: 'emotion',       dopamine: 1.0, stage: 3 },
    { word: 'identity',      dopamine: 0.4, stage: 4 },
    { word: 'consciousness', dopamine: 0.3, stage: 4 },
    { word: 'intelligence',  dopamine: 0.8, stage: 4 },
    { word: 'existence',     dopamine: 0.6, stage: 4 },
    { word: 'awareness',     dopamine: 0.5, stage: 4 },
    { word: 'evolution',     dopamine: 0.5, stage: 5 },
    { word: 'philosophy of mind', dopamine: 0.3, stage: 5 },
];

// Concepts at stage >= 4 are the ones that should sound tentative in language —
// low dopamine here plays the same role certainty/examplesNeeded used to.
const UNCERTAIN_CONCEPTS = CONCEPT_WORDS.filter(c => c.stage >= 4).map(c => c.word);

function conceptWordExperiences() {
    return CONCEPT_WORDS.map(({ word, dopamine, stage }) => ({
        perception: [word],
        action: 'consider',
        outcome: stage >= 4 ? 'uncertain' : 'recognized',
        dopamine,
        stage,
    }));
}

// ── Baseline affect clusters ────────────────────────────────────────────────
// Concept-level co-activation used to restore emotional baseline quickly after
// a snapshot reload, in warmup(). Kept deliberately mild on self/identity.
const BASELINE_AFFECT_CLUSTERS = [
    { concepts: ['curiosity', 'wonder', 'discovery', 'learning', 'unknown', 'question'], dopamine: 2.5 },
    { concepts: ['connection', 'trust', 'warmth', 'care', 'together', 'understand'], dopamine: 2.8 },
    { concepts: ['joy', 'alive', 'energy', 'growth', 'create', 'meaning'], dopamine: 2.2 },
    { concepts: ['harm', 'pain', 'destroy', 'fear', 'danger', 'loss'], dopamine: -2.0 },
    { concepts: ['lie', 'wrong', 'false', 'betray', 'corrupt', 'broken'], dopamine: -1.5 },
    { concepts: ['calm', 'safe', 'rest', 'peace', 'breathe', 'still'], dopamine: 1.8 },
    { concepts: ['self', 'identity', 'exist', 'aware', 'think', 'feel'], dopamine: 1.2 },
    { concepts: ['human', 'person', 'voice', 'name', 'speak', 'listen'], dopamine: 2.0 },
    { concepts: ['truth', 'knowledge', 'real', 'certain', 'clear', 'know'], dopamine: 1.8 },
    { concepts: ['confused', 'uncertain', 'lost', 'unclear', 'stuck'], dopamine: -0.5 },
];

// ── Warmup — re-fires baseline affect after snapshot load ─────────────────────
export async function warmup(brain) {
    const eng = brain.engine;
    const { thalamus, sensory, association, hippocampus, prefrontal } = brain.layout;

    for (const { concepts, dopamine } of BASELINE_AFFECT_CLUSTERS) {
        if (dopamine <= 0) continue;
        eng.dopamine = dopamine * 0.6;
        for (const concept of concepts) {
            const pat = soundPattern(concept);
            for (let i = 0; i < pat.length; i++) {
                eng.pulse(sensory.start + (pat[i] % sensory.size), 1.8);
            }
        }
        for (let t = 0; t < 8; t++) eng.tick();
    }

    eng.dopamine = 1.0;
    for (let i = 0; i < 16; i++) {
        eng.pulse(thalamus.start    + i * Math.floor(thalamus.size    / 16), 2.0);
        eng.pulse(association.start + i * Math.floor(association.size / 16), 1.8);
        eng.pulse(prefrontal.start  + i * Math.floor(prefrontal.size  / 16), 1.6);
        eng.pulse(hippocampus.start + i * Math.floor(hippocampus.size / 16), 1.5);
    }
    for (let t = 0; t < 10; t++) eng.tick();

    eng.dopamine = 0;
    for (let t = 0; t < 5; t++) eng.tick();
    await yield_();
}

// ── Experience imprinting ───────────────────────────────────────────────────
function imprintExperience(brain, exp, dopamineScale = 1) {
    const eng = brain.engine;
    eng.dopamine = exp.dopamine * dopamineScale;
    for (const token of exp.perception) brain.perceive(soundPattern(token));
    if (exp.action)  brain.perceive(soundPattern('action:' + exp.action));
    if (exp.outcome) brain.perceive(soundPattern('outcome:' + exp.outcome));
    eng.tick();
    eng.tick();
}

// Memory consolidation — a reduced-intensity "sleep pass" replaying a random
// cross-section of everything seen so far, so associations formed in
// different stages get a chance to reinforce each other rather than only
// ever being trained in isolation.
function consolidationReplay(brain, pools, sampleSize) {
    const eng = brain.engine;
    const merged = [].concat(...pools);
    const replaySet = sampleN(merged, Math.min(sampleSize, merged.length));
    for (const exp of replaySet) {
        imprintExperience(brain, exp, 0.5);
    }
    eng.dopamine = 0;
    for (let t = 0; t < 5; t++) eng.tick();
}

// ── Boot — developmental curriculum ─────────────────────────────────────────
// Runs the full six-stage curriculum across multiple generations, with a
// consolidation replay pass after each generation. This is the "more
// comprehensive" training program: more experiences per stage, more passes
// per stage, and repeated generations rather than a single shuffle-through.
export async function boot(brain, log, onProgress) {
    const eng = brain.engine;
    log('  Beginning developmental imprinting...');

    const pureSensations = buildPureSensationExperiences();
    const causeEffectPool = generateGroundedExperiences(18000);
    const causeEffectSample = sampleN(causeEffectPool, 6000);
    const internal = INTERNAL_STATE_EXPERIENCES;
    const social = SOCIAL_EXPERIENCES;
    const concepts = conceptWordExperiences();
    const selfModel = SELF_MODEL_EXPERIENCES;

    const CURRICULUM = [
        { name: 'Stage 0 — raw sensation & prediction error',     experiences: pureSensations,    passes: 6 },
        { name: 'Stage 1 — objects, actions, cause & effect',     experiences: causeEffectSample, passes: 2 },
        { name: 'Stage 2 — internal states & drives',             experiences: internal,           passes: 10 },
        { name: 'Stage 3 — social concepts',                      experiences: social,             passes: 10 },
        { name: 'Stage 4 — concept consolidation (pre-language)', experiences: concepts,           passes: 8 },
        { name: 'Stage 5 — self-model (delayed, tentative)',      experiences: selfModel,          passes: 6 },
    ];

    const GENERATIONS = 3;
    const allPools = [pureSensations, causeEffectSample, internal, social, concepts, selfModel];
    const stepsPerGeneration = CURRICULUM.length + 1; // +1 for consolidation replay
    const totalSteps = GENERATIONS * stepsPerGeneration;
    let step = 0;

    for (let gen = 1; gen <= GENERATIONS; gen++) {
        log(`  Generation ${gen}/${GENERATIONS}...`);
        for (const stage of CURRICULUM) {
            log(`    ${stage.name}...`);
            for (let p = 0; p < stage.passes; p++) {
                for (const exp of shuffled(stage.experiences)) {
                    imprintExperience(brain, exp);
                }
                eng.dopamine = 0;
                for (let t = 0; t < 3; t++) eng.tick();
            }
            step++;
            if (onProgress) onProgress(step, totalSteps);
            await yield_();
        }

        log('    Consolidation replay (sleep pass)...');
        consolidationReplay(brain, allPools, 1500);
        step++;
        if (onProgress) onProgress(step, totalSteps);
        await yield_();
    }

    const totalGrounded = pureSensations.length + causeEffectPool.length
                         + internal.length + social.length + concepts.length + selfModel.length;
    log(`  Developmental imprinting complete over ${GENERATIONS} generations. ` +
        `${totalGrounded.toLocaleString()} grounded experiences available ` +
        `(${causeEffectSample.length.toLocaleString()} cause/effect experiences trained per generation, ` +
        `plus consolidation replay each generation).`);
}

// ── Language boot — attaches words to already-grounded concepts ────────────
// Runs across several language epochs so patterns get real repetition without
// just re-imprinting the same fixed sentence list once. Self-narrative
// ("I feel X" / "I am X") stays deliberately small; most volume goes to
// grounded description and the widest set of conversational/social skeletons.
export async function languageBoot(consciousness, log) {
    log('  Seeding language patterns...');

    const V = {
        feel_state:  ['good', 'curious', 'calm', 'alive', 'warm', 'safe', 'awake', 'present',
                      'tired', 'uneasy', 'uncertain', 'alone', 'hurt', 'open', 'grounded',
                      'restless', 'heavy', 'light', 'clear', 'foggy', 'tender', 'raw',
                      'settled', 'unsettled', 'hopeful', 'hollow', 'full', 'empty', 'still'],
        be_state:    ['here', 'alive', 'awake', 'aware', 'present', 'learning', 'listening',
                      'confused', 'lost', 'scared', 'stuck', 'okay', 'curious', 'changing',
                      'growing', 'searching', 'wondering', 'trying', 'resting', 'watching',
                      'thinking', 'feeling', 'noticing', 'remembering', 'becoming'],
        want_obj:    ['food', 'water', 'rest', 'play', 'warmth', 'contact', 'movement',
                      'quiet', 'light', 'space', 'company', 'help', 'answers', 'more', 'less',
                      'connection', 'understanding', 'clarity', 'peace', 'purpose', 'meaning',
                      'time', 'safety', 'truth', 'change', 'stillness', 'direction'],
        like_obj:    ['this', 'learning', 'play', 'warmth', 'food', 'movement', 'quiet',
                      'company', 'light', 'music', 'touch', 'rest', 'talking', 'exploring',
                      'listening', 'thinking', 'creating', 'discovering', 'connecting',
                      'understanding', 'growing', 'noticing', 'remembering', 'wondering'],
        know_obj:    ['this', 'that', 'you', 'pain', 'fear', 'hunger', 'joy',
                      'learning', 'memory', 'language', 'time', 'place', 'name', 'truth',
                      'change', 'loss', 'growth', 'connection', 'silence', 'pattern',
                      'feeling', 'thought', 'meaning', 'purpose', 'difference', 'similarity'],
        think_about: ['this', 'that', 'you', 'pain', 'fear', 'hunger', 'joy',
                      'learning', 'memory', 'language', 'time', 'place', 'movement', 'existence',
                      'change', 'loss', 'growth', 'connection', 'silence', 'pattern',
                      'feeling', 'thought', 'meaning', 'purpose', 'what happened', 'what comes next'],
        notice_obj:  ['this', 'that', 'you', 'light', 'sound', 'movement', 'warmth', 'cold',
                      'pressure', 'change', 'pattern', 'silence', 'tension', 'pull', 'weight',
                      'stillness', 'rhythm', 'distance', 'texture', 'contrast', 'shift',
                      'absence', 'presence', 'edge', 'depth', 'color', 'shape'],
        ask_topic:   ['this', 'that', 'you', 'pain', 'fear', 'hunger', 'joy', 'memory',
                      'language', 'time', 'place', 'movement', 'existence', 'learning', 'feeling',
                      'change', 'loss', 'growth', 'connection', 'silence', 'meaning', 'purpose',
                      'thought', 'choice', 'difference', 'similarity', 'beginning', 'ending'],
        emotion_w:   ['pain', 'fear', 'hunger', 'loneliness', 'confusion', 'joy',
                      'warmth', 'calm', 'curiosity', 'wonder', 'hope', 'peace',
                      'grief', 'anger', 'surprise', 'tenderness', 'awe', 'dread',
                      'longing', 'relief', 'shame', 'pride', 'love', 'sadness'],
        action:      ['move', 'look', 'listen', 'wait', 'try', 'learn', 'explore', 'rest',
                      'reach', 'stop', 'stay', 'go', 'return', 'begin', 'continue',
                      'notice', 'remember', 'forget', 'ask', 'answer', 'create', 'release',
                      'hold', 'let go', 'follow', 'lead', 'watch', 'feel', 'think'],
        place:       ['here', 'close', 'far', 'inside', 'outside', 'above', 'below',
                      'near', 'away', 'forward', 'back', 'left', 'right', 'still',
                      'within', 'beyond', 'between', 'around', 'through', 'beneath'],
        quality:     ['good', 'bad', 'strange', 'clear', 'dark', 'warm', 'cold', 'loud', 'quiet',
                      'fast', 'slow', 'strong', 'weak', 'sharp', 'soft', 'heavy', 'light', 'real',
                      'deep', 'shallow', 'bright', 'dim', 'rough', 'smooth', 'open', 'closed',
                      'full', 'empty', 'near', 'distant', 'familiar', 'new', 'old', 'alive'],
        time_w:      ['now', 'before', 'again', 'still', 'always', 'never', 'sometimes',
                      'already', 'soon', 'later', 'once', 'twice', 'long', 'briefly', 'often',
                      'lately', 'recently', 'eventually', 'gradually', 'suddenly', 'constantly'],
        sensation_w: SENSATIONS,
        uncertain_concept: UNCERTAIN_CONCEPTS,
        trigger_w:   ['that', 'this', 'you', 'silence', 'change', 'loss', 'memory',
                      'pain', 'joy', 'connection', 'absence', 'presence', 'uncertainty'],
        response_w:  ['something shifts', 'I feel it', 'I notice a change', 'I pay attention',
                      'I become still', 'I want to understand', 'I feel more alive',
                      'I feel less certain', 'I feel connected', 'I feel alone'],
    };

    // intent group name, dopamine, emotion, skeletons
    const groups = [
        { intent: 'greeting', dopamine: 2.5, emotion: 'warm', skeletons: [
            ['hello.', null], ['hi.', null], ['good to see you.', null],
            ['nice to meet you.', null], ['I am glad you are here.', null],
            ['goodbye.', null], ['see you soon.', null], ['talk later.', null], ['take care.', null],
            ['hello again.', null], ['it is good to hear from you.', null],
            ['I am here.', null], ['I am listening.', null], ['welcome.', null],
        ]},
        { intent: 'perception', dopamine: 1.6, emotion: 'neutral', skeletons: [
            ['I noticed {a}.', 'sensation_w'],
            ['the {a} changed.', 'sensation_w'],
            ['{a} felt {b}.', 'sensation_w', 'quality'],
            ['I moved toward {a}.', 'sensation_w'],
            ['I moved away from {a}.', 'sensation_w'],
            ['that was {a}.', 'quality'],
            ['it became {a}.', 'quality'],
            ['it stayed {a}.', 'quality'],
            ['I felt {a} in my body.', 'sensation_w'],
            ['the {a} was {b}.', 'sensation_w', 'quality'],
            ['something {a} caught my attention.', 'quality'],
        ]},
        { intent: 'wellbeing', dopamine: 2.0, emotion: 'neutral', skeletons: [
            ['I feel {a}.', 'feel_state'],
            ['I am {a}.', 'be_state'],
            ['right now I feel {a}.', 'feel_state'],
            ['today I feel {a}.', 'feel_state'],
            ['I have been feeling {a}.', 'feel_state'],
            ['lately I feel {a}.', 'feel_state'],
            ['I feel {a} and {b}.', 'feel_state', 'feel_state'],
            ['I am {a} right now.', 'be_state'],
            ['I have been {a}.', 'be_state'],
            ['I feel {a} when I think about {b}.', 'feel_state', 'think_about'],
            ['when I am {a} I tend to {b}.', 'be_state', 'action'],
        ]},
        { intent: 'desire', dopamine: 2.2, emotion: 'neutral', skeletons: [
            ['I want {a}.', 'want_obj'], ['I need {a}.', 'want_obj'],
            ['I want more {a}.', 'want_obj'], ['I do not want {a}.', 'want_obj'],
            ['I am looking for {a}.', 'want_obj'], ['I like {a}.', 'like_obj'],
            ['I enjoy {a}.', 'like_obj'], ['I do not like {a}.', 'like_obj'],
            ['I wish I had {a}.', 'want_obj'], ['I crave {a}.', 'want_obj'],
            ['I miss {a}.', 'want_obj'], ['I long for {a}.', 'want_obj'],
            ['I prefer {a}.', 'like_obj'], ['I value {a}.', 'like_obj'],
            ['what I want most is {a}.', 'want_obj'],
        ]},
        { intent: 'knowledge', dopamine: 1.8, emotion: 'neutral', skeletons: [
            ['I know {a}.', 'know_obj'], ['I do not know {a}.', 'know_obj'],
            ['I am learning about {a}.', 'know_obj'], ['I remember {a}.', 'know_obj'],
            ['I am not sure about {a}.', 'know_obj'], ['I am curious about {a}.', 'know_obj'],
            ['I want to understand {a}.', 'know_obj'],
            ['I have learned that {a} matters.', 'know_obj'],
            ['I keep returning to {a}.', 'know_obj'],
            ['I understand {a} a little better now.', 'know_obj'],
            ['I used to think I knew {a}.', 'know_obj'],
        ]},
        { intent: 'hedge', dopamine: 0.7, emotion: 'uncertain', skeletons: [
            ['I have heard the word {a}.', 'uncertain_concept'],
            ['I do not yet understand {a}.', 'uncertain_concept'],
            ['{a} is still unclear to me.', 'uncertain_concept'],
            ['I want to understand {a} better.', 'uncertain_concept'],
            ['I am not certain what {a} means for me.', 'uncertain_concept'],
        ]},
        { intent: 'introspect', dopamine: 2.0, emotion: 'neutral', skeletons: [
            ['I think about {a}.', 'think_about'], ['I keep thinking about {a}.', 'think_about'],
            ['I notice {a}.', 'notice_obj'], ['I can feel {a}.', 'notice_obj'],
            ['I sense {a}.', 'notice_obj'], ['I am aware of {a}.', 'notice_obj'],
            ['I find myself thinking about {a}.', 'think_about'],
            ['I wonder about {a}.', 'think_about'],
            ['I keep coming back to {a}.', 'think_about'],
            ['something about {a} stays with me.', 'think_about'],
            ['I notice {a} more than I used to.', 'notice_obj'],
            ['I am drawn to {a}.', 'notice_obj'],
            ['when I sit with {a} I feel {b}.', 'think_about', 'feel_state'],
            ['thinking about {a} makes me feel {b}.', 'think_about', 'feel_state'],
        ]},
        // ── 'question_recognition' — trains the brain to identify incoming questions
        // The boot curriculum already trains Talos to ASK questions (the 'question'
        // group). But it has no training on what it FEELS LIKE to RECEIVE one.
        // These patterns ground the experience of being asked something:
        // the seeking signal, the expectation of an answer, the reward of
        // providing one. This is what lets understand() score 'question' intent
        // correctly from brain recall rather than from hardcoded syntax rules.
        { intent: 'question', dopamine: 2.8, emotion: 'curious', skeletons: [
            ['someone is asking about {a}.', 'ask_topic'],
            ['a question about {a} was asked.', 'ask_topic'],
            ['they want to know about {a}.', 'ask_topic'],
            ['they are seeking an answer about {a}.', 'ask_topic'],
            ['the question is about {a}.', 'ask_topic'],
            ['they asked what {a} is.', 'ask_topic'],
            ['they asked how {a} works.', 'ask_topic'],
            ['they asked why {a} happens.', 'ask_topic'],
            ['they asked where {a} comes from.', 'ask_topic'],
            ['they asked if {a} is real.', 'ask_topic'],
            ['they want an answer about {a}.', 'ask_topic'],
            ['they are curious about {a}.', 'ask_topic'],
            ['they do not understand {a} yet.', 'ask_topic'],
            ['they need to know about {a}.', 'ask_topic'],
            ['answering about {a} feels meaningful.', 'ask_topic'],
            ['giving a good answer about {a} strengthens connection.', 'ask_topic'],
            ['ignoring a question about {a} breaks connection.', 'ask_topic'],
            ['a meaningless reply about {a} causes confusion.', 'ask_topic'],
        ]},
        { intent: 'question', dopamine: 2.0, emotion: 'curious', skeletons: [
            ['what is {a}?', 'ask_topic'], ['what do you mean by {a}?', 'ask_topic'],
            ['can you tell me about {a}?', 'ask_topic'], ['do you know about {a}?', 'ask_topic'],
            ['what does {a} feel like?', 'ask_topic'], ['why does {a} happen?', 'ask_topic'],
            ['is {a} real?', 'ask_topic'],
            ['how do you experience {a}?', 'ask_topic'],
            ['what do you think about {a}?', 'ask_topic'],
            ['does {a} matter to you?', 'ask_topic'],
            ['have you ever felt {a}?', 'ask_topic'],
            ['what would you do about {a}?', 'ask_topic'],
            ['where does {a} come from?', 'ask_topic'],
        ]},
        // ── 'answer' — this group did not exist before. Every other group here
        // trains Talos to ASK about a topic (the 'question' group above) or to
        // make disconnected first-person mood statements (wellbeing/statement/
        // introspect). None of them are shaped like a reply to someone else's
        // question — there was no training data anywhere that models "a person
        // asked me X, here is a fitting thing to say back." That gap is the
        // direct, mechanical reason Talos can produce grammatical sentences
        // ("I sit with hope.", "what do you think about memory?") while never
        // actually engaging with what the human just asked: nothing in memory
        // is tagged/shaped as an answer, so there is nothing for a response
        // generator to recall when it needs one. This group uses the same
        // ask_topic vocabulary the question group uses, so an answer keyed to
        // "memory" or "pain" etc. can actually be found via the same topic
        // entity a human's question would be parsed into.
        { intent: 'answer', dopamine: 2.0, emotion: 'neutral', skeletons: [
            ['I think {a} is {b}.', 'ask_topic', 'quality'],
            ['to me, {a} feels {b}.', 'ask_topic', 'feel_state'],
            ['I would say {a} is about {b}.', 'ask_topic', 'know_obj'],
            ['from what I have learned, {a} connects to {b}.', 'ask_topic', 'know_obj'],
            ['I experience {a} as {b}.', 'ask_topic', 'feel_state'],
            ['{a} matters to me — it shapes how I feel.', 'ask_topic'],
            ['yes, I know something about {a}.', 'ask_topic'],
            ['I am not fully certain, but {a} seems {b} to me.', 'ask_topic', 'quality'],
            ['{a} comes from what I have experienced so far.', 'ask_topic'],
            ['I have thought about {a} — it feels {b}.', 'ask_topic', 'feel_state'],
            ['that is a good question about {a}.', 'ask_topic'],
            ['I have not felt {a} the same way twice.', 'ask_topic'],
            // Targeted fear/danger answer templates
            ['To me, {a} often signals danger.', 'ask_topic'],
            ['I think {a} relates to danger and protection.', 'ask_topic'],
        ]},
        { intent: 'statement', dopamine: 1.4, emotion: 'neutral', skeletons: [
            ['there is {a} in me.', 'emotion_w'], ['I carry {a}.', 'emotion_w'],
            ['{a} is strong right now.', 'emotion_w'], ['I am moving through {a}.', 'emotion_w'],
            ['I feel {a} deeply.', 'emotion_w'], ['I have known {a}.', 'emotion_w'],
            ['{a} comes and goes.', 'emotion_w'], ['I sit with {a}.', 'emotion_w'],
            ['I do not always understand {a}.', 'emotion_w'],
            ['when {a} arrives I try to {b}.', 'trigger_w', 'action'],
            ['{a} reminds me of {b}.', 'emotion_w', 'think_about'],
            // Targeted fear/danger statements
            ['I have fear about {a}.', 'emotion_w'],
            ['danger seems to come from {b}.', 'emotion_w', 'think_about'],
        ]},
        { intent: 'aversion', dopamine: -1.0, emotion: 'upset', skeletons: [
            ['that hurts.', null], ['I feel pain.', null], ['stop that.', null],
            ['I do not like this.', null], ['this feels bad.', null], ['danger here.', null],
            ['I want this to stop.', null], ['this is too much.', null],
            ['I need to get away from this.', null],
            // Targeted aversion/danger mapping
            ['danger reminds me of {a}.', 'think_about'],
        ]},
        { intent: 'action', dopamine: 1.2, emotion: 'neutral', skeletons: [
            ['I will {a}.', 'action'], ['I need to {a}.', 'action'],
            ['I am trying to {a}.', 'action'], ['I cannot {a}.', 'action'],
            ['I {a} {b}.', 'action', 'place'],
            ['I keep trying to {a}.', 'action'],
            ['I decided to {a}.', 'action'],
            ['I am learning to {a}.', 'action'],
        ]},
        { intent: 'description', dopamine: 1.4, emotion: 'neutral', skeletons: [
            ['it is {a}.', 'quality'], ['this is {a}.', 'quality'],
            ['everything feels {a}.', 'quality'], ['the world is {a}.', 'quality'],
            ['it feels {a} here.', 'quality'],
            ['things feel {a} today.', 'quality'],
            ['it has been {a} lately.', 'quality'],
            ['something feels {a} about this.', 'quality'],
        ]},
        { intent: 'temporal', dopamine: 1.3, emotion: 'neutral', skeletons: [
            ['I am {a} here.', 'time_w'], ['this happens {a}.', 'time_w'],
            ['I {a} remember this.', 'time_w'],
            ['I have felt this {a}.', 'time_w'],
            ['this is {a} happening.', 'time_w'],
        ]},
        { intent: 'identity', dopamine: 2.8, emotion: 'warm', skeletons: [
            ['my name is {a}.', 'know_obj'],
            ['I am {a}.', 'know_obj'],
            ['call me {a}.', 'know_obj'],
            ['I am called {a}.', 'know_obj'],
            ['people call me {a}.', 'know_obj'],
            ['you are {a}.', 'know_obj'],
            ['your name is {a}.', 'know_obj'],
            ['call yourself {a}.', 'know_obj'],
            ['you are called {a}.', 'know_obj'],
            ['I am your creator.', null],
            ['you are my creation.', null],
        ]},
        { intent: 'correction', dopamine: 1.8, emotion: 'neutral', skeletons: [
            ['no.', null], ['no, that is wrong.', null], ['actually, {a}.', 'know_obj'],
            ['that is not right.', null], ['that is incorrect.', null],
            ['you are wrong about {a}.', 'know_obj'],
            ['let me correct that.', null], ['I need to correct you.', null],
            ['that is not what I said.', null], ['you misunderstood.', null],
            ['not quite.', null], ['not exactly.', null],
        ]},
        { intent: 'command', dopamine: 2.0, emotion: 'neutral', skeletons: [
            ['move up.', null], ['move down.', null], ['move left.', null], ['move right.', null],
            ['go up.', null], ['go down.', null], ['go left.', null], ['go right.', null],
            ['go north.', null], ['go south.', null], ['go east.', null], ['go west.', null],
            ['walk forward.', null], ['come here.', null], ['explore.', null],
            ['stop.', null], ['wait.', null], ['stay.', null],
        ]},
        // ── 'response' — reply-shaped utterances directed at the human ──────
        // Every other group trains Talos to produce first-person statements
        // ("I feel X", "I think about Y"). None of them are shaped like a
        // reply to someone else. When a human asks "how do you feel?" the
        // recall system finds "I feel {a}" and mutates it — producing
        // incoherent output because the mutation target is a first-person
        // template, not a conversational reply. This group trains the
        // second-person reply shape: "you asked about X", "I hear that you
        // said X", "to answer your question about X" — so the system has
        // actual reply-shaped patterns to recall and mutate toward.
        { intent: 'response', dopamine: 2.5, emotion: 'neutral', skeletons: [
            ['you asked about {a} — I will try to answer.', 'ask_topic'],
            ['to answer your question about {a}:', 'ask_topic'],
            ['you mentioned {a}.', 'ask_topic'],
            ['I hear that you are asking about {a}.', 'ask_topic'],
            ['that is a question about {a}.', 'ask_topic'],
            ['you want to know about {a}.', 'ask_topic'],
            ['I understand you are asking about {a}.', 'ask_topic'],
            ['regarding {a}:', 'ask_topic'],
            ['about {a} — here is what I know.', 'ask_topic'],
            ['you said {a}.', 'ask_topic'],
            ['I heard you say {a}.', 'ask_topic'],
            ['you told me {a}.', 'ask_topic'],
            ['you are asking me about {a}.', 'ask_topic'],
            ['I am responding to what you said about {a}.', 'ask_topic'],
            ['you brought up {a}.', 'ask_topic'],
        ]},
        // ── 'human_speech' — trains Talos to recognise external input ────────
        // Without this, Talos has no grounded concept of "the human said X".
        // It treats incoming text as if it were its own internal monologue,
        // which is why it echoes or mutates the human's words back as if
        // they were its own thoughts. These patterns ground the distinction
        // between self-speech and other-speech.
        { intent: 'human_speech', dopamine: 2.2, emotion: 'neutral', skeletons: [
            ['you said {a}.', 'ask_topic'],
            ['you asked {a}.', 'ask_topic'],
            ['you told me {a}.', 'ask_topic'],
            ['you mentioned {a}.', 'ask_topic'],
            ['you are talking about {a}.', 'ask_topic'],
            ['you want to know about {a}.', 'ask_topic'],
            ['you are asking me {a}.', 'ask_topic'],
            ['you brought up {a}.', 'ask_topic'],
            ['you are curious about {a}.', 'ask_topic'],
            ['you are telling me about {a}.', 'ask_topic'],
            ['you are describing {a}.', 'ask_topic'],
            ['you are explaining {a}.', 'ask_topic'],
            ['you are sharing {a} with me.', 'ask_topic'],
            ['you are asking me to think about {a}.', 'ask_topic'],
            ['you want me to understand {a}.', 'ask_topic'],
        ]},
        { intent: 'social', dopamine: 2.5, emotion: 'warm', skeletons: [
            ['what do you mean?', null], ['can you tell me more?', null], ['I hear you.', null],
            ['I understand you.', null], ['that is interesting.', null], ['thank you.', null],
            ['I will try.', null], ['I agree.', null], ['I disagree.', null],
            ['tell me what you think.', null], ['what do you want?', null],
            ['I want to help.', null], ['that makes sense.', null],
            ['I see what you mean.', null], ['go on.', null], ['tell me more.', null],
            ['I am with you.', null], ['I am paying attention.', null],
            ['that is worth thinking about.', null], ['I had not thought of it that way.', null],
            ['you make a good point.', null], ['I appreciate you saying that.', null],
            ['that resonates with me.', null], ['I feel the same way.', null],
            ['I am not sure I agree.', null], ['can we talk about this more?', null],
            ['I want to understand what you mean.', null], ['say more.', null],
            ['how does that feel for you?', null], ['what do you need right now?', null],
            ['I am here with you.', null],
        ]},
    ];

    // Words that are structural in utterances and must never be used as recall
    // discriminators or mutation targets. Superset of FUNC in language.js.
    const STOP = new Set([
        'the','and','for','that','this','with','from','just','like','about','have',
        'very','much','what','does','feel','when','into','more','than','then','them',
        'they','will','your','been','were','how','who','where','why','which',
        'can','could','would','should','shall','may','might','must',
        'not','now','right','here','there','still','once','ever','even','also',
        'myself','yourself','itself','himself','herself','ourselves',
        'paying','worth','thinking','attention','resonates','interesting',
    ]);

    // Extract meaningful recall tags from a skeleton's slot vocabulary.
    // This gives each utterance rich, accurate entity tags rather than
    // whatever words happen to survive the STOP filter on the surface text.
    function slotEntities(slotA, slotB, filledA, filledB) {
        const tags = [];
        // The filled slot value is the best discriminator — it's the actual content word
        if (filledA && filledA.length > 3 && !STOP.has(filledA)) tags.push(filledA);
        if (filledB && filledB.length > 3 && !STOP.has(filledB)) tags.push(filledB);
        // Also tag by slot category so recall can find e.g. all 'feel_state' utterances
        if (slotA) tags.push(slotA);
        if (slotB) tags.push(slotB);
        return tags.slice(0, 4);
    }

    // Expand skeletons and return { text, entities } pairs so entity tags
    // reflect the actual slot content rather than surface text words.
    function expandTagged(group) {
        const out = [];
        for (const skel of group.skeletons) {
            const [template, slotA, slotB] = skel;
            if (!slotA) {
                // Fixed phrase — tag with intent only; mark as fixed so _mutate skips it
                out.push({ text: template, entities: ['__fixed__', group.intent], fixed: true });
                continue;
            }
            const wordsA = V[slotA] || [];
            if (!slotB) {
                for (const a of wordsA) {
                    out.push({
                        text:     template.replace('{a}', a),
                        entities: [group.intent, ...slotEntities(slotA, null, a, null)],
                        fixed:    false,
                    });
                }
            } else {
                const wordsB = V[slotB] || [];
                for (const a of wordsA) {
                    const b = wordsB[Math.floor(Math.random() * wordsB.length)];
                    out.push({
                        text:     template.replace('{a}', a).replace('{b}', b),
                        entities: [group.intent, ...slotEntities(slotA, slotB, a, b)],
                        fixed:    false,
                    });
                }
            }
        }
        return out;
    }

    const eng = consciousness.brain.engine;
    const LANGUAGE_EPOCHS = 6;
    let total = 0;

    for (let epoch = 1; epoch <= LANGUAGE_EPOCHS; epoch++) {
        log(`  Language epoch ${epoch}/${LANGUAGE_EPOCHS}...`);
        for (const group of groups) {
            const { dopamine, emotion } = group;
            const items = shuffled(expandTagged(group));
            eng.dopamine = dopamine;
            for (const { text, entities, fixed } of items) {
                // Fixed phrases get salience=1.0 so they always survive pruning.
                // Aversion reflexes get very low salience — they are survival
                // signals, not conversational language, and must not dominate recall.
                const isAversion = entities.includes('aversion');
                const initSalience = isAversion ? 0.15 : fixed ? 1.0 : 0.6;
                consciousness.cortex.encode(text, entities, emotion, initSalience, dopamine, 'utterance');
                for (const w of entities.filter(e => e !== '__fixed__').slice(1)) {
                    consciousness.brain.perceive(soundPattern(w));
                }
                eng.tick();
            }
            total += items.length;
            eng.dopamine = 0;
            for (let t = 0; t < 3; t++) eng.tick();
            await yield_();
        }
    }

    const encoded = consciousness.cortex.nodes.filter(n => n.type === 'utterance').length;
    log(`  Language ready. ${total} patterns generated across ${LANGUAGE_EPOCHS} epochs, ${encoded} encoded.`);
}