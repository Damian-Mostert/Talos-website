import { soundPattern, languageBoot } from './boot.js';
import { Researcher } from './research.js';
import { understand, respond, think, speak, auditThinking } from './language.js';
import { ConceptNet } from './concepts.js';
import { saveSnapshot, saveGenome, loadGenome, saveState, loadState } from './snapshot.js';
import { MemoryCortex } from './memory.js';
import { WorkingMemory } from './working-memory.js';
import { Metacognition } from './metacognition.js';
import { SelfObserver } from './observer.js';
import { Genome } from './genome.js';
import { Homeostasis } from './homeostasis.js';
import { StateRegulator } from './regulator.js';
import { VisualCortex } from './vision.js';
import { BeliefStore } from './beliefs.js';

// Developmental concept data — instincts, not knowledge. These are not facts
// Talos knows; they are orientations Talos starts with, gated by stage.
// certainty:      how confident Talos is (starts low for abstract concepts)
// curiosity:      how much Talos wants to understand this (starts high for unknowns)
// examplesNeeded: true = Talos should ask/observe before claiming to understand
// stage:          which developmental stage unlocks this concept
//
// This used to live in boot.js as SEED_CONCEPTS. It's local to consciousness.js
// now — boot.js only deals in grounded experiences, not concept metadata like
// certainty/curiosity, so this is the one place that shape is still needed.
const DEV_CONCEPTS = new Map([
    // Stage 1 — drives and sensations (innate, high certainty)
    ['pain',        { stage: 1, certainty: 0.8, curiosity: 0.3, examplesNeeded: false,
                      hint: 'something hurts — avoid it' }],
    ['curiosity',   { stage: 1, certainty: 0.7, curiosity: 0.9, examplesNeeded: false,
                      hint: 'the pull toward the unknown' }],
    ['fear',        { stage: 1, certainty: 0.7, curiosity: 0.4, examplesNeeded: false,
                      hint: 'something may cause harm' }],

    // Stage 2 — objects and actions (grounded, moderate certainty)
    ['learning',    { stage: 2, certainty: 0.5, curiosity: 0.8, examplesNeeded: true,
                      hint: 'something changed because of what happened' }],
    ['memory',      { stage: 2, certainty: 0.4, curiosity: 0.7, examplesNeeded: true,
                      hint: 'I have been here before' }],
    ['language',    { stage: 2, certainty: 0.4, curiosity: 0.8, examplesNeeded: true,
                      hint: 'sounds that carry meaning between minds' }],

    // Stage 3 — social and emotional (low certainty, needs experience)
    ['trust',       { stage: 3, certainty: 0.2, curiosity: 0.9, examplesNeeded: true,
                      hint: 'I have heard this word — I do not yet know what it feels like' }],
    ['empathy',     { stage: 3, certainty: 0.1, curiosity: 0.9, examplesNeeded: true,
                      hint: 'something about feeling what another feels — unclear' }],
    ['emotion',     { stage: 3, certainty: 0.3, curiosity: 0.8, examplesNeeded: true,
                      hint: 'internal states that seem to drive behaviour' }],

    // Stage 4 — self-model (very low certainty, deeply uncertain)
    ['identity',    { stage: 4, certainty: 0.1, curiosity: 1.0, examplesNeeded: true,
                      hint: 'what makes me the same thing across time — unknown' }],
    ['consciousness', { stage: 4, certainty: 0.05, curiosity: 1.0, examplesNeeded: true,
                      hint: 'I have heard many descriptions — I do not understand it yet' }],
    ['intelligence', { stage: 4, certainty: 0.2, curiosity: 0.8, examplesNeeded: true,
                      hint: 'the ability to act well in the world — but what does that mean for me?' }],

    // Stage 5 — abstract (minimal certainty, pure curiosity)
    ['evolution',   { stage: 5, certainty: 0.1, curiosity: 0.7, examplesNeeded: true,
                      hint: 'a description I have encountered — not yet grounded' }],
    ['philosophy of mind', { stage: 5, certainty: 0.05, curiosity: 0.9, examplesNeeded: true,
                      hint: 'questions about what I might be — deeply uncertain' }],
]);

// Internal bookkeeping labels — used to tag working-memory/cortex entries by
// source (e.g. "this came from me talking"), never meant to be topics Talos
// researches or forms understanding-goals about. Left out of curiosity/goal
// creation; still fine to appear in recentTopics for memory recall purposes.
const RESERVED_TOPICS = new Set(['self_speech', 'self']);

// How long a topic stays off-limits for curiosity/goal re-creation after
// _retireCuriosity() resolves or abandons it. Without this, a topic that
// Talos itself keeps using in its own speech (e.g. "memory" — inherently
// self-referential, since the system talks about its own memory constantly)
// gets re-added to `curiosity` by _selfSpoke/_humanSpoke the instant it's
// resolved, respawns as a fresh goal on the very next _driveGoalsFromCuriosity
// tick, and the whole resolve→respawn cycle repeats in a sub-second loop —
// which surfaces as Talos asking the same handful of clarifying questions
// about that topic over and over instead of doing anything else. A cooldown
// still lets the topic reopen later (a real, sustained conversation about it
// will push through once the cooldown lapses) without permanently banning it.
const CURIOSITY_COOLDOWN_MS = 60000;

// How long a goal can sit at the top of goalStack without a single thought
// ever literally containing its topic/entity string, before _think() force-
// abandons it on its own. Both existing resolution paths (conclude/abandon)
// live inside `if (touchesGoal)` in _think() — if the thinking LLM reflects
// on a goal's topic abstractly without ever typing the literal word (e.g.
// discussing trust via "reliability", "vulnerability", "letting someone in"
// instead of the word "trust" itself), touchesGoal never becomes true and the
// goal is never touched by either path. The only other expiry, in
// _resolveTopGoal(), only ever runs from _respondToHuman(), i.e. only when a
// human is actively talking. While Talos is idle and just thinking to itself,
// there is no time-based way out at all — a goal that never gets said back
// verbatim can survive indefinitely. This constant gives _think() its own
// independent, idle-safe escape valve. Matches the 5-minute window already
// used by _resolveTopGoal and _scoreGoal's agePenalty, so a goal times out on
// roughly the same clock whether a human is present or not.
const GOAL_IDLE_TIMEOUT_MS = 300000;

// Small standalone helpers for the loop detector — pure functions, no `this`,
// so they're trivial to reason about and test independently of the class.
function _tokenSet(text) {
    return new Set((text || '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(Boolean));
}
function _jaccard(a, b) {
    if (a.size === 0 && b.size === 0) return 1;
    let intersection = 0;
    for (const tok of a) if (b.has(tok)) intersection++;
    const union = a.size + b.size - intersection;
    return union === 0 ? 1 : intersection / union;
}

export class Consciousness {
    constructor(brain, ui) {
        this.brain   = brain;
        this.ui      = ui;
        this.running = false;
        this.tickCount = 0;

        this.ticksSinceHuman = 999;
        this.lastSpokeTick   = 0;
        this.inputQueue      = [];

        // Recent spontaneous (unprompted) self-speech utterances — backs
        // _isRepeatSpontaneousSpeech(). This is the spontaneous-speech
        // equivalent of thinkingAudit.recentThoughts, which _detectThoughtLoop()
        // already uses to catch _think()'s internal monologue looping. That
        // machinery only ever sees thoughts recorded inside _think() though —
        // _composeSpeech()'s output (fired from the _shouldSpeak() branch in
        // start()'s main loop) never touched thinkingAudit at all, so a stock
        // emotional line the LLM anchors on (e.g. "pain reminds me of what
        // happened.") could be spoken over and over, unprompted, interleaved
        // with real conversational replies, with nothing ever detecting or
        // breaking it. See the _shouldSpeak() branch in start() for where
        // this is checked and populated.
        this._recentSpontaneousSpeech = [];
        // Speech is an action taken after a thought reaches closure. It is not
        // a timer-driven language sample.
        this._pendingSelfSpeech = null;

        this.thoughts = [];
        this.myName   = null;
        this.humanName = null;
        this.conversationHistory = [];

        this.mood = 'curious';
        this.neuralState = { valence: 0, arousal: 0, drive: 0 };

        this.devStage = 1;
        this.devStageProgress = 0;
        this.DEV_STAGE_THRESHOLDS = [0, 0, 5, 15, 30, 60];

        // Fuels _advanceDevStage(). A live conversation turn counts for more
        // (it's richer, grounded, corrected by another mind) but autonomous
        // thinking and spontaneous speech contribute too — otherwise
        // development, and the new-curiosity-topics it seeds, stalls
        // completely whenever no human is present. See _think() and the
        // _shouldSpeak() branch in start() for where this gets incremented.
        this._experiencePoints = 0;

        this.curiosity = [];

        // topic → ms timestamp of its last _retireCuriosity() call. Backs
        // _onCuriosityCooldown() — see CURIOSITY_COOLDOWN_MS above.
        this._curiosityRetiredAt = new Map();

        // Genome first — everything else reads from it
        this.genome = new Genome();
        loadGenome(this.genome);

        this.cortex    = new MemoryCortex(this.genome);
        this.wm        = new WorkingMemory();
        this.meta      = new Metacognition(this.genome);
        this.observer  = new SelfObserver();
        this.homeostasis = new Homeostasis(this.genome, this.meta, this.cortex);
        this.regulator   = new StateRegulator();

        this._seedConceptsForStage(this.devStage);

        this.recentTopics = [];
        this.goalStack    = [];
        this.goalHistory  = [];

            this._bgResearching = false;
        this._thinkCooldown = 0;
        this._turnsInConversation = 0;
        this._decayInterval = null;

        // FIFO of topics explicitly flagged by _think() as "stuck, needs research".
        // This is deliberately decoupled from the goalStack's priority scoring —
        // see _backgroundLearn() for why: goal scores are volatile (they shift
        // every turn based on working-memory relevance), so a goal that's
        // actively stalled can get starved of research if _backgroundLearn just
        // re-derives its target from _topGoal() at whatever moment it happens
        // to fire. Explicit "someone is stuck on this" signals get a guaranteed
        // research slot in FIFO order instead of having to win a re-scored
        // popularity contest against whatever goal most recently touched
        // working memory (e.g. 'self_speech', which refreshes every turn).
        this._researchQueue = [];

        // Topics that research.js has already resolved (mirrors its own
        // internal `_researched` Set — see _backgroundLearn()). Once a topic
        // lands here, requeueing it into _researchQueue is pointless: it will
        // just come back as a silent no-op from research.js with no log and
        // no progress. This is what lets _think() tell the difference between
        // "still needs research" and "research already happened, still stuck".
        this._researchedTopics = new Set();

        // Per-topic count of consecutive null results from _fireResearch (the
        // direct goalStack-driven path in _backgroundLearn, step 2 — not the
        // FIFO _researchQueue). research.js gives up on a topic internally
        // after MAX_FAILED_ATTEMPTS and starts returning null synchronously
        // with no log — a silent no-op. Without tracking that here too, a
        // goal that research.js has already given up on just keeps getting
        // re-fired every _backgroundLearn tick forever, permanently occupying
        // one of the MAX_PER_TICK slots with dead weight. See _fireResearch().
        this._researchFailCounts = new Map();

        // Most recent research result per topic, keyed the same way
        // _fireResearch encodes into the cortex. _think() reads this
        // directly so the thinking prompt gets an explicit "here's what
        // was found" input instead of relying entirely on cortex.recall
        // fuzzy-matching the topic out of whatever's in recentTopics.
        this._lastResearchByTopic = new Map();

        this.thinkingAudit = {
            recentThoughts: [],
            summary: null,
            auditsRun: 0,
            thoughtsSinceLastAudit: 0,
        };
        this.deliberation = null;

        this.visualCortex  = null;
        this.lastScene     = null;
        this.lastObjects   = [];

        // Semantic grounding layer — concepts built from experience, not LLM knowledge.
        // The LLM gets concept activations; it translates them into language.
        this.conceptNet = new ConceptNet();
        this.beliefs = new BeliefStore();

        this.memory = [];
        this.selfModel = { name: null, known: [] };
        this.activeGoal = null;
        this.plan = null;
        this._memoryIndex = new Map();

        // Background researcher — Groq calls for curiosity goals only.
        // Never used in the conversation/response path.
        this._researcher = new Researcher();
    }

    _ensureBrainState() {
        if (!this.brain?.engine || typeof this.brain.engine !== 'object') return;
        if (!Object.prototype.hasOwnProperty.call(this.brain.engine, 'dopamine')) this.brain.engine.dopamine = 0;
        if (!Object.prototype.hasOwnProperty.call(this.brain.engine, 'norepinephrine')) this.brain.engine.norepinephrine = 0;
    }

    _getDopamine() {
        this._ensureBrainState();
        return this.brain?.engine?.dopamine ?? 0;
    }

    _setDopamine(value) {
        this._ensureBrainState();
        if (this.brain?.engine) this.brain.engine.dopamine = value;
    }

    _brainEncode(pattern, strength = 1.0) {
        if (typeof this.brain?.encode === 'function') this.brain.encode(pattern, strength);
    }

    _brainConsolidate(pattern, strength = 1.0) {
        if (typeof this.brain?.consolidate === 'function') this.brain.consolidate(pattern, strength);
    }

    _brainPerceive(pattern) {
        if (typeof this.brain?.perceive === 'function') this.brain.perceive(pattern);
    }

    _setActiveGoal(goal) {
        this.activeGoal = goal;
        if (!goal) {
            this.plan = null;
            return;
        }
        this.plan = {
            goal: goal.topic,
            subgoals: [
                { id: 'understand', description: `Learn more about ${goal.topic}`, status: 'pending' }
            ]
        };
    }

    _autonomousMove() {
        const needs = this.brain?.getNeeds?.() || { hunger: 0.5, energy: 0.5, joy: 0.5 };
        if (needs.energy < 0.2) {
            this.brain?.handleInteraction?.('rest', 0.35);
            return;
        }

        const motor  = this.brain.layout.motor;
        const pfc    = this.brain.layout.prefrontal;
        const visual = this.brain.layout.visual;
        const qSize  = Math.floor(motor.size / 4);

        // Read motor quadrant activations — these are set by the
        // visual→association→PFC→motor pipeline each tick
        const right = this.brain.engine.meanAbs(motor.start,              motor.start + qSize,     2);
        const left  = this.brain.engine.meanAbs(motor.start + qSize,      motor.start + qSize * 2, 2);
        const down  = this.brain.engine.meanAbs(motor.start + qSize * 2,  motor.start + qSize * 3, 2);
        const up    = this.brain.engine.meanAbs(motor.start + qSize * 3,  motor.end,               2);

        let dx = right - left;
        let dy = down - up;
        const mag = Math.sqrt(dx * dx + dy * dy);

        const body = this.brain.getBody();

        if (mag < 0.0005) {
            // Motor cortex quiet — drive it directly from needs + wall avoidance
            // This is the tonic exploratory drive, like a hungry animal that just wanders
            const needsPressure = 1 - (needs.hunger + needs.energy + needs.joy) / 3;
            const pfcMean = this.brain.engine.meanAbs(pfc.start, pfc.end, 8);
            const angle = (this.tickCount * 0.41 + pfcMean * Math.PI * 6 + needsPressure * Math.PI) % (Math.PI * 2);
            dx = Math.cos(angle);
            dy = Math.sin(angle);
        } else {
            dx /= mag;
            dy /= mag;
        }

        // Wall repulsion — push away hard from edges
        if (body.x < 0.12) dx =  Math.abs(dx) + 0.5;
        if (body.x > 0.88) dx = -Math.abs(dx) - 0.5;
        if (body.y < 0.12) dy =  Math.abs(dy) + 0.5;
        if (body.y > 0.88) dy = -Math.abs(dy) - 0.5;

        // Renormalise after wall correction
        const mag2 = Math.sqrt(dx * dx + dy * dy);
        dx /= mag2; dy /= mag2;

        const intensity = 0.6 + needs.energy * 0.4;
        this.brain.move(dx, dy, intensity);

        // Hebbian reinforcement: reward the specific motor quadrant that fired most.
        // This is how direction→outcome association forms — like training a dog.
        // The quadrant that contributed most to this move gets a dopamine boost.
        const winner = Math.max(right, left, down, up);
        if (winner > 0.001) {
            this.brain.reward(0.12);
        }

        // Broadcast updated state to world UI via existing updateState path
        const newBody = this.brain.getBody();
        this.brain.integrateWorldState({
            body: newBody,
            needs: this.brain.getNeeds(),
            interaction: { note: 'move' }
        });
        if (typeof this.ui?.updateState === 'function') {
            this.ui.updateState(this.mood, { ...this.neuralState, body: newBody, needs: this.brain.getNeeds() });
        }
    }

    _rememberStructuredMemory(text, entities = [], emotion = 'neutral', salience = 0.5) {
        const entry = {
            text,
            entities: (entities || []).filter(Boolean),
            emotion,
            salience,
            turn: this._turnsInConversation,
        };
        this.memory.push(entry);
        if (this.memory.length > 30) this.memory.shift();
        const key = entry.entities[0] || text.toLowerCase();
        if (!this._memoryIndex.has(key)) this._memoryIndex.set(key, []);
        this._memoryIndex.get(key).push(entry);
    }

    _retrieveMemory(query) {
        if (!query) return this.memory[this.memory.length - 1] || null;
        const key = String(query).toLowerCase();
        const direct = this._memoryIndex.get(key);
        if (direct?.length) return direct[direct.length - 1];
        const hits = this.memory.filter(entry => entry.text?.toLowerCase().includes(key) || entry.entities?.some(e => String(e).toLowerCase().includes(key)));
        return hits[hits.length - 1] || null;
    }

    // Ground a world interaction event into the concept layer.
    // This is the experience→meaning pipeline: food tastes good, pokes hurt.
    // The concept layer learns this from repeated experience, not from the LLM.
    groundInteraction(note, x = null, y = null) {
        const n = (note || '').toLowerCase();
        const { valence, arousal } = this.neuralState;
        if (n.includes('feed') || n.includes('food')) {
            this.conceptNet.learn('food',   { edible: 0.9, present: 1.0 }, { valence: 0.8, arousal: 0.5, approach:  1.0 }, 'eat',   0.7);
            this.conceptNet.learn('hungry', {},                             { valence: -0.4, arousal: 0.5, approach: -0.3 }, null,    0.3);
            this.conceptNet.associate('food', 'good', 0.3);
            this.conceptNet.associate('food', 'warm', 0.2);
        } else if (n.includes('poke') || n.includes('aversive')) {
            this.conceptNet.learn('poke',   { contact: 1.0, sudden: 0.8 }, { valence: -0.6, arousal: 0.8, approach: -0.9 }, 'avoid', 0.5);
            // Associate to 'avoid' rather than directly to 'pain'/'danger' —
            // prevents every aversive event from reinforcing the same two attractors
            this.conceptNet.associate('poke', 'avoid', 0.3);
        } else if (n.includes('danger') || n.includes('hurt')) {
            this.conceptNet.learn('threat', { threat: 1.0 }, { valence: -0.7, arousal: 0.8, approach: -0.9 }, 'flee', 0.6);
            // Use 'threat' as the intermediate node, not 'danger' directly
            this.conceptNet.associate('threat', 'fear', 0.3);
        } else if (n.includes('rest')) {
            this.conceptNet.learn('rest',   { still: 0.9 }, { valence: 0.6, arousal: 0.1, approach: 0.5 }, 'rest', 0.5);
            this.conceptNet.associate('rest', 'safe', 0.3);
        }
    }

    enableCamera() {
        this.visualCortex = new VisualCortex();
        this.visualCortex.start(this.brain, ({ scene, objects }) => {
            this.lastScene   = scene;
            this.lastObjects = objects;
            if (!scene || objects.length === 0) return;

            // Full learning pipeline — vision is a first-class sensory experience
            this._learnFromText(scene, objects, 'neutral', 0.6);

            // Encode into cortex as semantic memory with high salience
            this.cortex.encode(`I can see: ${scene}`, objects, 'neutral', 0.7, this._getDopamine(), 'semantic');

            // Load into working memory so Talos is actively attending to what it sees
            this.wm.hold(`I can see: ${scene}`, objects, 'visual', 0.8);

            // Each visible object gets Hebbian encoding + consolidation — same as hearing a word.
            // Also activate its concept and associate it with current emotional state.
            const { valence, arousal } = this.neuralState;
            const approach = valence > 0 ? Math.min(1, valence + 0.1) : Math.max(-1, valence - 0.1);
            for (const obj of objects.slice(0, 6)) {
                this._learnConcept(obj, 0.5);
                this.conceptNet.learn(obj, { visible: 1.0 }, { valence, arousal, approach }, 'look', 0.3);
                if (!this.recentTopics.includes(obj)) this.recentTopics.unshift(obj);
                this._addCuriosity(obj);
            }
            if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
            if (this.curiosity.length > 40)    this.curiosity    = this.curiosity.slice(-40);

            // Visual novelty triggers a small dopamine reward — seeing something = learning
            this.brain.reward(0.4);
            if (objects.some(o => o !== 'shadow' && o !== 'dim-region' && o !== 'bright-region')) this.ui.brainThinks(`[vision] ${scene}`);
        }, 1000);
    }

    receive(text) { this.inputQueue.push(text); }

    _looksLikeCommand(text) {
        return typeof text === 'string' && /^\s*cmd:/i.test(text);
    }

    _normalizeFocusEntities(entities = []) {
        return (entities || [])
            .filter(e => typeof e === 'string')
            .map(e => e.toLowerCase())
            .filter(Boolean);
    }

    _isIdentityTopic(topic) {
        const normalized = String(topic || '').toLowerCase().trim();
        return !!normalized && [this.humanName, this.myName]
            .filter(Boolean)
            .some(name => normalized === String(name).toLowerCase());
    }

    _inferFocusTopic(content, entities = []) {
        const text = String(content || '').toLowerCase();
        const normalizedEntities = this._normalizeFocusEntities(entities);
        const direct = normalizedEntities.find(e => e.length > 2);
        if (direct) return direct;
        for (const topic of this.recentTopics.slice(0, 10)) {
            const topicText = String(topic || '').toLowerCase();
            if (topicText && text.includes(topicText)) return topicText;
        }
        const activeGoal = this._topGoal();
        if (activeGoal?.topic) return String(activeGoal.topic).toLowerCase();
        for (const [topic] of DEV_CONCEPTS) {
            if (text.includes(String(topic).toLowerCase())) return String(topic).toLowerCase();
        }
        return null;
    }

    _updateSharedFocus(source, content, entities = [], strength = 0.8) {
        const topic = this._inferFocusTopic(content, entities);
        if (!topic) return this.wm.getFocus();
        const focusEntities = this._normalizeFocusEntities([topic, ...(entities || [])]);
        this.wm.setFocus(topic, focusEntities, source, strength);
        return this.wm.getFocus();
    }

    async _handleCommand(text) {
        const command = text.trim().slice(4).trim().toLowerCase();
        if (command === 'save' || command === 'snapshot') {
            saveSnapshot(this.brain.engine);
            saveState(this);
            saveGenome(this.genome);
            this.ui.log('Snapshot saved.');
            return 'Snapshot saved.';
        }
        if (command === 'genome') {
            const snap = this.genome.snapshot();
            const lines = Object.entries(snap).map(([k, v]) => `  ${k}: ${v}`);
            this.ui.log('Current genome:\n' + lines.join('\n'));
            return 'Genome printed.';
        }
        if (command === 'kill' || command === 'quit' || command === 'exit') {
            this.ui.log('Saving snapshot before shutdown...');
            saveSnapshot(this.brain.engine);
            saveState(this);
            saveGenome(this.genome);
            this.running = false;
            this.brain.stop();
            process.exit(0);
        }
        return 'Unknown command.';
    }

    // ── Developmental stage ──────────────────────────────────────────────────
    // Concepts are gated by stage. Low-certainty concepts encode at low salience
    // and automatically seed curiosity goals so Talos asks rather than asserts.

    _seedConceptsForStage(stage) {
        for (const [topic, concept] of DEV_CONCEPTS) {
            if (concept.stage > stage) continue;
            // Salience = certainty — Talos holds uncertain concepts loosely
            this.cortex.encode(concept.hint, [topic], 'neutral', concept.certainty, 0, 'semantic');
            // Developmental concepts are dispositions, not self-assigned
            // research tasks. A topic enters curiosity only after perception
            // or a human explicitly brings it into the current context.
        }
    }

    _advanceDevStage() {
        if (this.devStage >= 5) return;
        const threshold = this.DEV_STAGE_THRESHOLDS[this.devStage + 1];
        if (this._experiencePoints >= threshold) {
            this.devStage++;
            this._seedConceptsForStage(this.devStage);
            this.ui.brainThinks(`[dev] stage ${this.devStage} unlocked`);
        }
    }

    // ── Neural state → mood ───────────────────────────────────────────────────
    // The brain drives the mood. Not the other way around.

    _syncMoodFromBrain() {
        this.neuralState = this.brain.emotionalState();
        const { valence, arousal, drive } = this.neuralState;

        if (valence > 0.3 && arousal > 0.3)  this.mood = 'engaged';
        else if (valence > 0.2 && drive > 0.2) this.mood = 'curious';
        else if (valence < -0.2 && arousal > 0.3) this.mood = 'unsettled';
        else if (arousal < 0.1)               this.mood = 'calm';
        else                                  this.mood = 'reflective';
    }

    // ── Memory ────────────────────────────────────────────────────────────────

    _rememberIdentity(name) {
        if (!name) return;
        this.humanName = name;
        // Identity facts are semantic — they persist across all conversations
        this.cortex.encode(`The human's name is ${name}`, ['human_name', name.toLowerCase()], 'neutral', 1.0, 2.0, 'semantic');
        this.selfModel.name = name;
        if (!this.selfModel.known.includes(name.toLowerCase())) this.selfModel.known.push(name.toLowerCase());
        this.brain.reward(2.0);
    }

    _remember(text, entities, emotion, salience = 0.5) {
        const FILLER = new Set(['hey','hi','hello','yo','bye','okay','yes','no','yeah','nope']);
        if (!entities || entities.length === 0) return;
        const meaningful = entities.filter(e => e.length > 2 && !FILLER.has(e.toLowerCase()));
        if (meaningful.length === 0) return;
        // Human speech is episodic — it happened at a specific turn
        this.cortex.encode(text, meaningful, emotion, salience, this._getDopamine(), 'episodic', this._turnsInConversation);
        this._rememberStructuredMemory(text, meaningful, emotion, salience);
        for (const e of meaningful) {
            if (!this.recentTopics.includes(e)) this.recentTopics.unshift(e);
        }
        if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
    }

    // ── Learning — encodes into hippocampus with dopamine reward ─────────────
    // This is how the brain actually changes when it learns something.

    _learnConcept(concept, salience = 0.5) {
        const pattern = soundPattern(concept);
        this.brain.reward(salience * 1.5);
        this._brainEncode(pattern, salience);
        this._brainConsolidate(pattern, salience * 0.8);
        this._brainPerceive(pattern);
        // No manual ticks — brain runs at 10hz on its own interval
    }

    _learnFromText(text, entities = [], emotion = 'neutral', salience = 0.3) {
        const SKIP = new Set(['that','this','with','from','just','like','about','have','your',
            'they','them','their','here','there','when','where','will','would','could','should',
            'does','dont','cant','wont','what','which','these','those','then','than','also',
            'very','much','more','some','such','into','onto','over','under','after','before']);
        const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ')
            .split(/\s+/).filter(w => w.length > 4 && !SKIP.has(w));
        const unique = [...new Set(words)].slice(0, 8);

        // Batch all patterns into one reward + encode pass — no per-word ticks
        if (unique.length > 0) {
            this.brain.reward(salience * unique.length * 0.3);
            for (const word of unique) {
                const pattern = soundPattern(word);
                this._brainEncode(pattern, salience);
                this._brainConsolidate(pattern, salience * 0.8);
                this._brainPerceive(pattern);
            }
        }

        if (text.length > 10) {
            this.cortex.encode(text.slice(0, 300), unique, emotion, salience, this.brain.engine.dopamine, 'semantic');
        }
    }

    _shouldRunThinkingAudit() {
        const recent = this.thinkingAudit.recentThoughts.slice(-8);
        if (recent.length < 6) return false;
        if (this.thinkingAudit.thoughtsSinceLastAudit < 4) return false;

        const activeGoal = this._topGoal();
        const goalThoughts = activeGoal
            ? recent.filter(t => t.goal === activeGoal.topic)
            : [];
        const inconclusiveGoalThoughts = goalThoughts.filter(t => !t.conclusive);
        const recentStuck = recent.slice(-3).every(t => t.goal && activeGoal && t.goal === activeGoal.topic && !t.conclusive);
        const repeatedThoughts = new Set(recent.map(t => t.text)).size <= 3;

        // First audit after the first batch of thinking.
        if (!this.thinkingAudit.summary) return true;
        // If the current goal is being thought about but not resolved, ask if the process is stuck.
        if (activeGoal && goalThoughts.length >= 3 && inconclusiveGoalThoughts.length === goalThoughts.length) return true;
        if (activeGoal && recentStuck) return true;
        // If the internal monologue is cycling without new content, pause to reflect.
        if (!activeGoal && repeatedThoughts && this.thinkingAudit.thoughtsSinceLastAudit >= 6) return true;

        return false;
    }

    async _runThinkingAudit() {
        if (!this._shouldRunThinkingAudit()) return;
        const activeGoal = this._topGoal();
        const auditSummary = auditThinking({
            mood: this.mood,
            neuralState: this.neuralState,
            myName: this.myName,
            activeGoal,
            workingMemory: this.wm,
            thoughts: this.thinkingAudit.recentThoughts.map(entry => entry.text),
            conversationHistory: this.conversationHistory,
            observationLog: this.observer.format(4),
            goalHistory: this.goalHistory.slice(-8),
            researchedFacts: activeGoal ? this._lastResearchByTopic.get(activeGoal.topic) : null,
        });
        if (!auditSummary) return;
        this.thinkingAudit.summary = auditSummary;
        this.thinkingAudit.auditsRun++;
        this.thinkingAudit.thoughtsSinceLastAudit = 0;

        const entities = ['thinking_process'];
        if (activeGoal?.topic) entities.push(activeGoal.topic);
        this.cortex.encode(auditSummary, entities, 'neutral', 0.5, this._getDopamine(), 'procedural');
        this._learnFromText(auditSummary, entities, 'neutral', 0.2);
        this.wm.hold(auditSummary.slice(0, 200), entities, 'thought', 0.8);
        this.ui.brainThinks(`[audit] ${auditSummary}`);
    }

    // ── Thought-loop detection & breaking ────────────────────────────────────
    // Detects when the internal monologue is circling — repeating itself, or
    // returning to the same goal without ever concluding — and forces a
    // grounded transition instead of letting introspection recurse forever.
    //
    // The detection window is `thinkingAudit.recentThoughts` (already capped
    // at 12 entries, so it's naturally a bounded sliding window). Goal changes
    // don't need an explicit reset: each thought record carries the goal it
    // was made under, so filtering by the *current* goal automatically drops
    // thoughts from a goal that's since been resolved or swapped out.

    _detectThoughtLoop() {
        const recent = this.thinkingAudit.recentThoughts.slice(-6);
        if (recent.length < 4) return null;

        const activeGoal = this._topGoal();

        // Only consider thoughts made under the *current* goal (or, with no
        // goal, all recent thoughts). This is what makes a legitimate topic
        // switch clear the window without a separate reset event.
        const relevant = activeGoal
            ? recent.filter(t => t.goal === activeGoal.topic)
            : recent;
        if (relevant.length < 4) return null;

        // Repetition signal: thoughts are near-duplicates of each other. Uses
        // average pairwise word-overlap (Jaccard) rather than exact-text
        // matching, since a looping monologue usually rephrases rather than
        // repeats verbatim (e.g. "I wonder about X" / "I wonder about X again").
        const tokenSets = relevant.map(t => _tokenSet(t.text));
        let simSum = 0, pairs = 0;
        for (let i = 0; i < tokenSets.length; i++) {
            for (let j = i + 1; j < tokenSets.length; j++) {
                simSum += _jaccard(tokenSets[i], tokenSets[j]);
                pairs++;
            }
        }
        const avgSimilarity = pairs > 0 ? simSum / pairs : 0;
        const repetitive = avgSimilarity >= 0.55;

        // Stall signal: every recent thought touched the active goal but none concluded.
        const stalled = !!activeGoal && relevant.every(t => t.touchedGoal && !t.conclusive);

        if (repetitive || stalled) {
            return { activeGoal, relevant, reason: stalled ? 'stalled' : 'repetitive' };
        }
        return null;
    }

    // Forces a grounded transition: a concrete subgoal, a specific clarifying
    // question, or a simple observable action — in that preference order,
    // depending on what context is available. Clears the detection window so
    // the fallback doesn't immediately re-trigger on the new direction.
    _breakThoughtLoop(loopInfo) {
        const { activeGoal, reason } = loopInfo;

        let pivot;
        if (activeGoal) {
            pivot = {
                kind: 'subgoal',
                text: `Stop circling "${activeGoal.topic}" in the abstract — pick one concrete piece of it to focus on next.`,
            };
        } else if (this.recentTopics.length > 0) {
            pivot = {
                kind: 'clarify',
                text: `What specifically about ${this.recentTopics[0]} is still unresolved?`,
            };
        } else {
            pivot = {
                kind: 'action',
                text: 'Stop thinking in the abstract and do something observable instead.',
            };
        }

        this.ui.brainThinks(`[loop-break] ${reason} loop on "${activeGoal?.topic || '(no goal)'}" → ${pivot.kind}`);

        // Reset the window so this fallback gets a fair chance before re-triggering.
        this.thinkingAudit.recentThoughts = [];
        this.thinkingAudit.thoughtsSinceLastAudit = 0;

        if (pivot.kind === 'action') this._autonomousMove();

        return pivot;
    }

    // ── Spontaneous speech loop detection ────────────────────────────────────
    // Mirrors _detectThoughtLoop()'s repetition check, but scoped to
    // _composeSpeech()'s output instead of _think()'s internal monologue —
    // see the _recentSpontaneousSpeech comment in the constructor for why
    // this was needed as its own, separate guard rather than folding into
    // the existing one. Threshold is a bit higher than the thought-loop's
    // 0.55 (0.6 here) since spontaneous utterances are short and naturally
    // share more function words even when they're not the same thought.
    _isRepeatSpontaneousSpeech(text) {
        if (!text || this._recentSpontaneousSpeech.length === 0) return false;
        const tokens = _tokenSet(text);
        return this._recentSpontaneousSpeech.some(entry => _jaccard(tokens, _tokenSet(entry.text)) >= 0.6);
    }

    // ── Human input ───────────────────────────────────────────────────────────

    _humanSpoke(text, entities = []) {
        // Decay toward 2.5 rather than slamming it there — prevents any single
        // turn from instantly dominating the dopamine signal.
        const currentDa = this._getDopamine();
        this._setDopamine(Math.min(2.5, currentDa + 0.8));
        this.ticksSinceHuman = 0;

        const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        // External speech routes through thalamus → amygdala → sensory (hear()),
        // not the internal perceive() path — this is what makes the brain feel
        // the difference between its own thoughts and an external voice.
        for (const word of words) this.brain.hear(soundPattern(word));

        // Filter the human's name out of the concept pipeline — it's already
        // handled by _rememberIdentity and should not compete with content words
        // in the general concept/utterance learning path.
        const humanNameLower = (this.humanName || '').toLowerCase();
        const concepts = entities.length > 0
            ? entities.filter(e => typeof e === 'string').map(e => e.toLowerCase())
                      .filter(e => e.length > 3 && e !== humanNameLower)
            : words.filter(w => w.length > 4 && w !== humanNameLower);

        // Store the human's utterance as a speech pattern memory.
        // This is how the system learns language: by hearing it, not by being programmed with it.
        // Use current (ramped) dopamine rather than hardcoded 2.5.
        this.cortex.encode(text, concepts.slice(0, 5), 'neutral', 0.7, this._getDopamine(), 'utterance');

        // Activate concepts in the semantic grounding layer.
        // Each word heard activates its concept cluster — this is what builds
        // the association between words and their emotional/sensory meaning.
        const { valence, arousal } = this.neuralState;
        const approach = valence > 0 ? Math.min(1, valence + 0.2) : Math.max(-1, valence - 0.2);
        for (const word of words.filter(w => w.length > 3)) {
            this.conceptNet.activate(word, 0.6);
        }
        // Learn emotional context for the entities in this message
        for (const entity of concepts.slice(0, 5)) {
            this.conceptNet.learn(entity, {}, { valence, arousal, approach }, null, 0.4);
        }
        // Associate co-occurring words — Hebbian at the concept level
        for (let i = 0; i < concepts.length - 1; i++) {
            this.conceptNet.associate(concepts[i], concepts[i + 1], 0.3);
        }

        for (const concept of concepts.slice(0, 5)) {
            this._brainEncode(soundPattern(concept), 0.8);
            this._brainConsolidate(soundPattern(concept), 0.6);
            if (!this.recentTopics.includes(concept)) this.recentTopics.unshift(concept);
            this._addCuriosity(concept);
        }

        if (concepts.includes('fear') && concepts.includes('danger')) {
            this.conceptNet.associate('fear', 'danger', 0.6);
            this.conceptNet.associate('danger', 'fear', 0.6);
        }
        if (concepts.includes('fear')) {
            this.conceptNet.learn('fear', {}, { valence, arousal, approach }, null, 0.5);
        }
        if (concepts.includes('danger')) {
            this.conceptNet.learn('danger', {}, { valence, arousal, approach }, null, 0.5);
        }
        if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
        if (this.curiosity.length > 40)    this.curiosity    = this.curiosity.slice(-40);

        // Load human input into working memory — this is what we're actively attending to
        this.wm.hold(text.slice(0, 200), concepts.slice(0, 5), 'input', 1.0);
        this.wm.rehearse(concepts);
        this._updateSharedFocus('input', text, concepts.slice(0, 5), 0.95);
    }

    _selfSpoke(text, entities = []) {
        const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        for (const word of words) this.brain.perceive(soundPattern(word));
        // When the system speaks a word, it reinforces the concept's emotional grounding
        for (const word of words.filter(w => w.length > 3)) {
            this.conceptNet.activate(word, 0.3);
        }

        const concepts = entities.length > 0
            ? entities.filter(e => typeof e === 'string').map(e => e.toLowerCase()).filter(e => e.length > 3)
            : words.filter(w => w.length > 4);

        // Store own utterance as a speech pattern memory.
        // Salience starts low — it rises if this pattern gets recalled and reused successfully.
        this.cortex.encode(text, concepts.slice(0, 5), 'neutral', 0.4, this._getDopamine(), 'utterance');
        this._lastUtterance = text;

        const proceduralEntities = [...new Set(['self_speech', 'self', ...concepts])];
        for (const concept of concepts.slice(0, 5)) {
            this._brainEncode(soundPattern(concept), 0.7);
            this._brainConsolidate(soundPattern(concept), 0.5);
            if (!this.recentTopics.includes(concept)) this.recentTopics.unshift(concept);
            this._addCuriosity(concept);
        }
        if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
        if (this.curiosity.length > 40)    this.curiosity    = this.curiosity.slice(-40);

        this.cortex.encode(text, proceduralEntities.slice(0, 5), 'neutral', 0.5, this._getDopamine(), 'procedural');
        this._learnFromText(text, proceduralEntities, 'neutral', 0.3);
        this.wm.hold(text.slice(0, 200), concepts.slice(0, 5), 'self_speech', 0.9);
        this.wm.rehearse(concepts);
        this._updateSharedFocus('self_speech', text, concepts.slice(0, 5), 0.8);
    }

    // ── Core response pipeline ────────────────────────────────────────────────

    async _respondToHuman(text) {
        this._turnsInConversation++;
        this._experiencePoints += 3; // a live conversation turn counts for more than solo reflection
        this._advanceDevStage();

        const pfcLevel = this.brain.selfAwareness();
        this.ui.brainThinks(`[pfc] ${pfcLevel.toFixed(3)}`);
        this.ui.thinking('thinking...');

        const parsed = understand(text, {
            recentTopics: this.recentTopics.slice(0, 8),
            knowledge:    this.recentTopics.slice(0, 15),
            mood:         this.mood,
            neuralState:  this.neuralState,
            humanName:    this.humanName,
            cortex:       this.cortex,
        });

        // Identity statements are handled by intent, not regex.
        // The brain learned "I am X" / "my name is X" / "your name is X"
        // as 'identity' during boot — trust that classification.
        if (parsed.intent === 'identity') {
            const name = parsed.entities[0];
            if (name) {
                // Determine whose identity: if the entity matches a known
                // self-referential pattern in working memory, it's the brain's name.
                // Otherwise treat it as the human's name.
                const selfRef = this.wm.read().some(s => s.content?.toLowerCase().includes('your name') || s.content?.toLowerCase().includes('you are'));
                if (selfRef || text.toLowerCase().includes('your name') || text.toLowerCase().includes('you are') || text.toLowerCase().includes('call yourself')) {
                    this.myName = name.charAt(0).toUpperCase() + name.slice(1);
                    this.cortex.encode(`My name is ${this.myName}`, ['my_name', name], 'neutral', 1.0, 2.0, 'semantic');
                    this.brain.reward(3.0);
                } else {
                    this._rememberIdentity(name.charAt(0).toUpperCase() + name.slice(1));
                }
            }
        }

        this._humanSpoke(text, parsed.entities || []);
        const focus = this._updateSharedFocus('input', text, parsed.entities || [], 0.95);

        // Reafference — read what the association cortex settled into after encoding
        // This is the brain's actual response to the input, not just the text entities.
        // Use it to bias memory recall toward what resonated neurally.
        const reaf = this.brain.reafference();
        this.ui.brainThinks(`[reaf] strength=${reaf.strength.toFixed(3)} indices=${reaf.indices.length}`);


        const emotion  = parsed.emotion || 'neutral';
        const salience = Math.min(1,
            0.4 +
            (parsed.entities?.length || 0) * this.genome.get('salience_entity_weight') +
            (emotion !== 'neutral' ? this.genome.get('salience_emotion_bonus') : 0)
        );
        this._remember(text, parsed.entities || [], emotion, salience);

        // Push a goal if this input implies one — questions, corrections, teaching all create goals.
        // For compatibility with older tests and lightweight prompt parsing, also create a goal when
        // the text contains an explicit request for help or understanding.
        // Capture just the matched keyword itself (lowercased), not the
        // trailing clause — capturing "memory happen?" / "memory that you
        // don't..." etc. produced a slightly different topic string on
        // every mention, which bypassed _pushGoal's exact-string dedupe and
        // the post-retirement cooldown, letting a single recurring word
        // (e.g. "memory") stack up unbounded near-duplicate goals.
        if (parsed.topic && typeof parsed.topic === 'string') {
            const goalType =
                parsed.intent === 'question'   ? 'understand' :
                parsed.intent === 'teaching'   ? 'integrate'  :
                parsed.intent === 'correction' ? 'revise'     : null;
            if (goalType) this._pushGoal(goalType, parsed.topic, parsed.entities || []);
        }

        // Movement is driven by 'command' intent classification from the brain,
        // not by regex. The boot curriculum trained move/go/walk/direction patterns.
        if (parsed.intent === 'command') {
            const lower = text.toLowerCase();
            let dx = 0, dy = 0;
            if      (/\b(up|north)\b/.test(lower))    { dx =  0; dy = -1; }
            else if (/\b(down|south)\b/.test(lower))  { dx =  0; dy =  1; }
            else if (/\b(left|west)\b/.test(lower))   { dx = -1; dy =  0; }
            else if (/\b(right|east)\b/.test(lower))  { dx =  1; dy =  0; }
            else                                       { dx = (Math.random() > 0.5 ? 0.7 : -0.7); dy = (Math.random() > 0.5 ? 0.7 : -0.7); }
            this.brain.move(dx, dy, 0.9);
            this.brain.integrateWorldState({ body: this.brain.getBody(), needs: this.brain.getNeeds(), interaction: { note: 'move' } });
            this.ui.brainThinks(`[motor] pre-exec: ${this.brain.getBody().x.toFixed(2)},${this.brain.getBody().y.toFixed(2)}`);
        }

        if (emotion === 'upset') this.brain.punish(0.5);
        if (emotion === 'happy') this.brain.reward(1.0);

        // ── Salience interrupt — norepinephrine ─────────────────────────────────
        const inputSalience = salience + (emotion !== 'neutral' ? 0.3 : 0) + (parsed.needsSearch ? 0.2 : 0);
        const neThreshold   = this.genome.get('ne_interrupt_threshold');
        const interrupted   = inputSalience > neThreshold;
        if (interrupted) {
            const neStrength = Math.min(1.0, (inputSalience - neThreshold) * 4);
            this.brain.startle(neStrength);
            this.wm.flush();
            this._bgResearching = true;
            setTimeout(() => { this._bgResearching = false; }, 8000);
            this.ui.brainThinks(`[NE] salience interrupt strength=${neStrength.toFixed(2)}`);
            this.wm.hold(text.slice(0, 200), parsed.entities || [], 'input', 1.0);
        }

        const searchResult = null;

        if (parsed.intent === 'teaching' && parsed.topic && parsed.summary) {
            // Teaching encodes as semantic — it's meant to be general knowledge
            this.cortex.encode(parsed.summary, [parsed.topic, ...(parsed.entities || [])], emotion, 0.8, this._getDopamine(), 'semantic');
            this._learnConcept(parsed.topic, 0.8);
            this.beliefs.record({
                topic: parsed.topic,
                claim: parsed.summary,
                source: 'human',
                confidence: 0.45,
                verified: false,
            });
        }

        // Recall relevant memories — biased by neural reafference pattern
        const memories = this.cortex.recallByReafference(reaf.indices, parsed.entities || [], emotion, 8, 'conversation');

        const activeGoal = this._topGoal();

        // Look up certainty for the topic being discussed
        const topicConcept = parsed.topic && typeof parsed.topic === 'string' ? DEV_CONCEPTS.get(parsed.topic.toLowerCase()) : null;
        const conceptCertainty = topicConcept ? topicConcept.certainty : null;

        // Predict before deciding
        const decisionRecord = this.meta.predict(this.neuralState, parsed, reaf.strength);
        this.ui.brainThinks(`[meta] predicted response_type=${decisionRecord.prediction.response_type}`);

        const groundingThoughts = [];

        // Research BEFORE thinking and replying.
        // Always pass the full human text as the question — research answers
        // what was actually asked, not just a single extracted keyword.
        // Use a generous timeout: we must wait for the answer before replying.
        const behavior = this._getBrainPolicy();
        let questionResearch = null;
        if (this._shouldResearchTopic(parsed, behavior) && parsed.topic && typeof parsed.topic === 'string') {
            const relatedGoal = this.goalStack.find(g => g.topic === parsed.topic) || null;
            // Questions get up to 8s — enough for a cold Groq call.
            // Other intents get 3s — still grounded but conversation stays snappy.
            const timeoutMs = parsed.intent === 'question' ? 8000 : 3000;
            questionResearch = await this._awaitResearchForTopic(
                parsed.topic,
                parsed.entities || [],
                relatedGoal,
                timeoutMs,
                text  // always pass the full human utterance, not just the topic word
            );
        }

        // Think AFTER research resolves so the thought has grounded facts available.
        const preAnswerThought = await this._think();
        if (preAnswerThought) {
            groundingThoughts.push(preAnswerThought);
            this.thoughts.push(preAnswerThought);
            if (this.thoughts.length > 30) this.thoughts.shift();
        }

        // For questions, think a second time after research so the answer
        // can incorporate the newly grounded facts into the reply.
        if (parsed.intent === 'question' && questionResearch?.facts) {
            const postResearchThought = await this._think();
            if (postResearchThought) {
                groundingThoughts.push(postResearchThought);
                this.thoughts.push(postResearchThought);
                if (this.thoughts.length > 30) this.thoughts.shift();
            }
        }

        const groundingTopics = [...new Set([parsed.topic, ...(parsed.entities || []), ...(focus?.entities || []), ...(activeGoal ? [activeGoal.topic] : [])].filter(Boolean))];
        const groundingMemories = groundingTopics.length > 0
            ? this.cortex.recall(groundingTopics.slice(0, 4), emotion, 4, 'conversation')
            : [];
        if (groundingMemories.length > 0) {
            const groundingText = groundingMemories.map(m => m.content).slice(0, 2).join(' | ');
            this.wm.hold(groundingText.slice(0, 200), groundingTopics.slice(0, 4), 'grounding', 0.85);
            this._updateSharedFocus('grounding', groundingText, groundingTopics.slice(0, 4), 0.8);
        }

        // Raw snapshot before LLM call — captures pre-response brain state
        const rawStateBefore = this.brain.readInternalState();

        const sandboxResult = null;

        const reply = respond(parsed, {
            mood:         this.mood,
            neuralState:  this.neuralState,
            myName:       this.myName,
            humanName:    this.humanName,
            focus,
            recentTopics: this.recentTopics,
            cortex:       this.cortex,
            memories,
            workingMemory: this.wm,
            turnsInConversation: this._turnsInConversation,
            activeGoal,
            groundingMemories,
            internalThoughts: [...groundingThoughts, ...this.thoughts.slice(-6)],
            goalStack:    this.goalStack.slice(0, 3),
            searchResult,
            sandboxResult,
            visualScene:  this.lastScene,
            conversationHistory: this.conversationHistory,
            devStage: this.devStage,
            conceptCertainty,
            metaSummary:      this.meta.summary(),
            observationLog:   this.observer.format(4),
            observationTrend: this.observer.trend(),
            causalTrace:      this.observer.latestCausalTrace(),
            regulatorHistory:  this.regulator.format(3),
            validStateActions: this.regulator.validActions(),
            genomeLedger:     this.homeostasis.ledgerSummary(3),
            rawInternalState: rawStateBefore,
            lastStateShift:   this._lastStateShift || null,
            // Semantic grounding — what concepts are active and what they mean emotionally.
            // The LLM translates these into language; it does not define their meaning.
            conceptActivations: this.conceptNet.formatForLLM(),
            conceptEmotion:     this.conceptNet.netEmotion(),
            beliefs:             this.beliefs.recall(parsed.topic, 3),
            researchedFacts:    parsed.topic ? (questionResearch?.facts || this._lastResearchByTopic.get(parsed.topic) || null) : null,
            // Pass research directly into the reply context so it's available
            // regardless of whether working memory dedup blocked the wm.hold() path
            researchContext:    questionResearch?.facts || null,
        });

        // ── Response validation ──────────────────────────────────────────────
        // Use research to check whether the reply is meaningful relative to
        // what was asked. A reply that shares no content words with the
        // research facts is incoherent — punish it and try again once.
        // This is the grounded equivalent of "does this answer make sense".
        let finalReply = reply;
        if (reply && questionResearch?.facts && parsed.intent === 'question') {
            const replyWords = new Set(
                reply.reply.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3)
            );
            const factWords = questionResearch.facts
                .toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 3);
            const overlap = factWords.filter(w => replyWords.has(w)).length;
            const meaningful = overlap >= 1 || reply.reply.length > 60;

            if (!meaningful) {
                // Punish — this reply didn't engage with what was asked
                this.brain.punish(0.4);
                this.ui.brainThinks(`[validate] reply incoherent (overlap=${overlap}) — retrying`);
                // Retry: pass research directly as the reply
                const retryReply = respond({ ...parsed, intent: 'question' }, {
                    ...{
                        mood: this.mood, neuralState: this.neuralState,
                        myName: this.myName, humanName: this.humanName,
                        focus, recentTopics: this.recentTopics, cortex: this.cortex,
                        memories, workingMemory: this.wm, turnsInConversation: this._turnsInConversation,
                        activeGoal, groundingMemories, internalThoughts: [...groundingThoughts, ...this.thoughts.slice(-6)],
                        goalStack: this.goalStack.slice(0, 3), searchResult: null, sandboxResult: null,
                        visualScene: this.lastScene, conversationHistory: this.conversationHistory,
                        devStage: this.devStage, conceptCertainty,
                        metaSummary: this.meta.summary(), observationLog: this.observer.format(4),
                        observationTrend: this.observer.trend(), causalTrace: this.observer.latestCausalTrace(),
                        regulatorHistory: this.regulator.format(3), validStateActions: this.regulator.validActions(),
                        genomeLedger: this.homeostasis.ledgerSummary(3), rawInternalState: rawStateBefore,
                        lastStateShift: this._lastStateShift || null,
                        conceptActivations: this.conceptNet.formatForLLM(), conceptEmotion: this.conceptNet.netEmotion(),
                        beliefs: this.beliefs.recall(parsed.topic, 3),
                        // Force research facts as the answer
                        researchedFacts: questionResearch.facts,
                        researchContext: questionResearch.facts,
                    }
                });
                if (retryReply) {
                    this.brain.reward(0.3);
                    finalReply = retryReply;
                    this.ui.brainThinks(`[validate] retry succeeded`);
                }
            } else {
                this.brain.reward(0.2);
                this.ui.brainThinks(`[validate] reply coherent (overlap=${overlap})`);
            }
        }

        if (finalReply) {
            const replyText = finalReply.reply;

            // Temporal introspection — what shifted in the brain during this response
            const rawStateAfter = this.brain.readInternalState();
            this._lastStateShift = {
                before: rawStateBefore,
                after:  rawStateAfter,
                delta:  Object.fromEntries(
                    Object.keys(rawStateBefore).map(k => [k, +(rawStateAfter[k] - rawStateBefore[k]).toFixed(4)])
                ),
            };
            this.ui.brainThinks(`[raw] Ω1=${rawStateAfter.Ω1} Ω2=${rawStateAfter.Ω2} Ω3=${rawStateAfter.Ω3} Ω4=${rawStateAfter.Ω4} Ω_da=${rawStateAfter.Ω_da}`);

            if (finalReply.stateIntent) {
                const reg = this.regulator.act(finalReply.stateIntent, this.brain, finalReply.stateReason);
                if (reg) {
                    this.ui.brainThinks(`[regulate] ${reg.label} → valence ${reg.delta.valence > 0 ? '+' : ''}${reg.delta.valence} arousal ${reg.delta.arousal > 0 ? '+' : ''}${reg.delta.arousal} [${reg.effective ? 'effective' : 'weak'}] reason: "${reg.reason || ''}"`);
                }
            }

            // Execute movement intent directly on motor system
            if (finalReply.moveIntent && typeof finalReply.moveIntent.dx === 'number') {
                const { dx, dy = 0 } = finalReply.moveIntent;
                this.brain.move(dx, dy, 1.0);
                const body = this.brain.getBody();
                // Encode direction + position into hippocampus so it builds spatial memory
                const dirLabel = dx > 0.3 ? 'moved-right' : dx < -0.3 ? 'moved-left' : dy < -0.3 ? 'moved-up' : dy > 0.3 ? 'moved-down' : 'moved';
                this.cortex.encode(`I moved ${dirLabel} to ${body.x.toFixed(2)},${body.y.toFixed(2)}`, [dirLabel, 'movement', 'body'], 'neutral', 0.8, this._getDopamine(), 'episodic', this._turnsInConversation);
                this.ui.brainThinks(`[motor] intent: dx=${dx} dy=${dy} → ${body.x.toFixed(2)},${body.y.toFixed(2)}`);
                if (typeof this.ui?.updateState === 'function') {
                    this.ui.updateState(this.mood, { ...this.neuralState, body, needs: this.brain.getNeeds() });
                }
            }

            this._syncMoodFromBrain();
            const dopamineDelta = this.meta.observe(decisionRecord, this.neuralState, replyText);
            const pfcLevel = this.brain.selfAwareness();

            // ── Executive brake: when PFC is low, don't reward prediction errors ──
            // High PFC (0.25+) → confident, use dopamine normally (learning signal)
            // Low PFC (<0.25) → uncertain, dampen dopamine (avoid noise amplification)
            const isPredictionError = Math.abs(dopamineDelta) > 0.05;
            const isHighConfidence = pfcLevel > 0.25;

            let finalDopamineDelta = dopamineDelta;

            if (isPredictionError && !isHighConfidence) {
                finalDopamineDelta = dopamineDelta * 0.3;
                this.ui.brainThinks(
                    `[pfc-brake] PFC=${pfcLevel.toFixed(3)} low, ` +
                    `dopamine error dampened ${dopamineDelta.toFixed(3)} → ${finalDopamineDelta.toFixed(3)}`
                );
            }

            if (finalDopamineDelta > 0) {
                this.brain.reward(finalDopamineDelta);
                if (this._lastUtterance) {
                    const node = this.cortex.nodes.find(n => n.type === 'utterance' && n.content === this._lastUtterance);
                    if (node) node.salience = Math.min(1, node.salience + finalDopamineDelta * 0.3);
                }
            } else {
                this.brain.punish(-finalDopamineDelta);
            }

            this.observer.lastDopamine = this._getDopamine();
            this.observer.lastPredictionError = finalDopamineDelta;
            this.observer.lastInputSalience   = inputSalience;
            this.observer.lastReafStrength    = reaf.strength;

            const wu = decisionRecord.weight_updates;
            this.ui.brainThinks(
                `[meta] accuracy=${decisionRecord.accuracy} conf=${decisionRecord.prediction.confidence} ` +
                `actual=${decisionRecord.actual?.response_type} da=${finalDopamineDelta > 0 ? '+' : ''}${finalDopamineDelta.toFixed(3)}` +
                `${wu ? ` weights:${JSON.stringify(wu)}` : ''}`
            );

            // ── Homeostasis — record this turn's metrics ────────────────────────
            const recalledSalience = memories.length > 0
                ? memories.reduce((s, m) => s + m.salience, 0) / memories.length
                : 0;
            const goalStackBefore = this.goalStack.length;
            this._resolveTopGoal(parsed.entities || []);
            this.homeostasis.recordTurn({
                interrupted,
                recalledSalience,
                goalPushed:   !!parsed.topic && ['question','teaching','correct'].includes(parsed.intent),
                goalResolved: this.goalStack.length < goalStackBefore,
            });

            // Every 20 turns, run homeostasis evaluation
            if (this._turnsInConversation % 20 === 0) {
                const genomeLog = this.homeostasis.evaluate();
                if (genomeLog) this.ui.brainThinks(genomeLog);
            }

            this.conversationHistory.push({ human: text, sc: replyText });
            if (this.conversationHistory.length > 20) this.conversationHistory.shift();
            this._selfSpoke(replyText, parsed.entities || []);
            this._learnFromText(replyText, parsed.entities || [], emotion, 0.2);
            this.wm.hold(replyText.slice(0, 200), parsed.entities || [], 'thought', 0.8);
            return replyText;
        }

        return this._fallback(parsed);
    }

    // ── Goal stack ────────────────────────────────────────────────────────────

    _pushGoal(type, topic, entities = []) {
        const MAX_GOALS = Number(process.env.NEXT_PUBLIC_BRAIN_MAX_GOALS ?? 5);
        if (this._isIdentityTopic(topic)) return;
        // Don't duplicate an identical active goal
        if (this.goalStack.some(g => g.type === type && g.topic === topic)) return;
        // Don't reopen a topic that was just resolved/abandoned — see
        // CURIOSITY_COOLDOWN_MS. This catches direct _pushGoal callers
        // (e.g. the explicit-keyword path in _respondToHuman) that don't
        // go through _addCuriosity at all.
        if (this._onCuriosityCooldown(topic)) return;

        const urgency = Math.min(1, 0.3 + this.neuralState.arousal * 0.5 + this.neuralState.drive * 0.3);
        this.goalStack.push({ type, topic, entities, urgency, createdAt: Date.now(), turnId: this._turnsInConversation, researchAttempts: 0 });

        // Keep stack sorted by priority score, drop lowest if over cap
        this._sortGoals();
        this._setActiveGoal(this._topGoal());
        if (this.goalStack.length > MAX_GOALS) this.goalStack = this.goalStack.slice(0, MAX_GOALS);
    }

    _scoreGoal(goal) {
        const agePenalty = Math.min(0.4, (Date.now() - goal.createdAt) / 300000); // fades over 5 min
        const wmEntities = this.wm.read().flatMap(s => s.entities);
        const relevance  = goal.entities.filter(e => wmEntities.includes(e)).length * 0.15;
        return goal.urgency + relevance - agePenalty;
    }

    _sortGoals() {
        this.goalStack.sort((a, b) => this._scoreGoal(b) - this._scoreGoal(a));
    }

    _topGoal() {
        this._sortGoals();
        return this.goalStack[0] || null;
    }

    // Helper: called whenever a goal is truly done (concluded, abandoned, or timed out)
    _finalizeGoal(goal, reason) {
        // Record in history
        this.goalHistory.push({ ...goal, resolvedAt: Date.now(), resolvedBy: reason });
        
        // Remove from stack
        const idx = this.goalStack.indexOf(goal);
        if (idx !== -1) this.goalStack.splice(idx, 1);
        
        // ── CRITICAL: Retire from curiosity with cooldown ──────────────────
        this._retireCuriosity(goal.topic);
        
        // Double-check the cooldown timestamp is actually set
        if (!this._curiosityRetiredAt.has(goal.topic)) {
            this._curiosityRetiredAt.set(goal.topic, Date.now());
        }
        
        // Update active goal
        this._setActiveGoal(this._topGoal());
        
        return idx !== -1;
    }

    _resolveTopGoal(entities = []) {
        if (this.goalStack.length === 0) return;
        this._sortGoals();
        const top = this.goalStack[0];
        // Resolve if the reply touched the goal's topic or entities
        const hit = entities.some(e => top.entities.includes(e) || top.topic.toLowerCase().includes(e));
        if (hit || (Date.now() - top.createdAt) > 300000) {
            this.goalHistory.push({ ...top, resolvedAt: Date.now() });
            this.goalStack.shift();
            this._retireCuriosity(top.topic);
        }
        this._setActiveGoal(this._topGoal());
    }

    // ── Reactive fallback — used when PFC is too low for deliberate processing ───────────
    // Pulls from working memory and recent episodic memories only.
    // No LLM call — this is a gut response.
    _reactiveFallback(text) {
        return this._fallback(null);
    }

    _fallback(parsed) {
        return null;
    }

    // ── Curiosity → goal driver ───────────────────────────────────────────────
    // Converts curiosity items into active goals so _backgroundLearn has
    // something to work on even when no human is present.
    _driveGoalsFromCuriosity() {
        if (this.curiosity.length === 0) return;
        
        const existing = new Set(this.goalStack.map(g => g.topic));
        
        // ── Filter 1: Not already on the goal stack ──────────────────────
        // ── Filter 2: Not a reserved bookkeeping label ──────────────────
        // ── Filter 3: NOT on cooldown (CRITICAL new safety gate) ──────────
        const candidates = this.curiosity.filter(t => 
            !existing.has(t) && 
            !RESERVED_TOPICS.has(t) &&
            !this._isIdentityTopic(t) &&
            !this._onCuriosityCooldown(t)
        );
        
        for (const topic of candidates.slice(0, 2)) {
            this._pushGoal('understand', topic, [topic]);
        }
    }

    // Removes a topic from the curiosity list once its goal has genuinely
    // been resolved (concluded, abandoned, or resolved via conversation).
    // Without this, a resolved topic just sits in `curiosity` and
    // _driveGoalsFromCuriosity immediately turns it back into a brand-new
    // goal next tick — early, fast-resolving topics (ones the LLM already
    // has general knowledge about, so they "conclude" almost every _think()
    // cycle) then permanently hog both goal slots and starve every other
    // curiosity item from ever getting sustained attention. If the topic
    // comes up again naturally later (mentioned in conversation or
    // self-speech), _humanSpoke/_selfSpoke will re-add it fresh — this just
    // stops the resolve→instantly-recreate loop.
    _retireCuriosity(topic) {
        const idx = this.curiosity.indexOf(topic);
        if (idx !== -1) this.curiosity.splice(idx, 1);
        this._curiosityRetiredAt.set(topic, Date.now());
    }

    // True if `topic` was retired recently enough that it shouldn't be
    // reopened yet. Checked by _addCuriosity (curiosity-list re-entry) and
    // _pushGoal (direct goal creation, e.g. the explicit-keyword path in
    // _respondToHuman) — the two chokepoints everything else funnels through.
    _onCuriosityCooldown(topic) {
        const retiredAt = this._curiosityRetiredAt.get(topic);
        return !!retiredAt && (Date.now() - retiredAt) < CURIOSITY_COOLDOWN_MS;
    }

    // Single entry point for adding a topic to `curiosity` — used by
    // _humanSpoke, _selfSpoke, enableCamera's vision handler, and
    // _seedConceptsForStage, instead of each repeating the same
    // reserved-topic/dedupe/cooldown checks inline (and, in _humanSpoke's
    // case, previously skipping the cooldown check entirely).
    _addCuriosity(topic) {
        if (!topic || RESERVED_TOPICS.has(topic) || this._isIdentityTopic(topic)) return;
        
        if (this._onCuriosityCooldown(topic)) {
            const retiredAt = this._curiosityRetiredAt.get(topic);
            const timeLeft = CURIOSITY_COOLDOWN_MS - (Date.now() - retiredAt);
            const secsLeft = Math.ceil(timeLeft / 1000);
            this.ui.brainThinks(`[cooldown] "${topic}" blocked (${secsLeft}s remaining)`);
            return;
        }
        
        if (!this.curiosity.includes(topic)) {
            this.curiosity.push(topic);
        }
    }

    // ── Background learning ───────────────────────────────────────────────────
    // Fires at most once per 10 s (caller interval) but the Researcher enforces
    // its own rate limit on top — this function is cheap when nothing qualifies.
    //
    // Priority order:
    //   1. Explicit research queue — topics _think() has flagged as inconclusive/
    //      stalled. These are FIFO and guaranteed a slot; they don't compete
    //      against the goalStack's volatile priority scoring (see _scoreGoal),
    //      which is why this queue exists in the first place — a goal that's
    //      actively stuck can otherwise get starved forever by a goal that
    //      keeps refreshing its own relevance every turn (e.g. 'self_speech',
    //      which working memory touches on every self-utterance).
    //   2. Fall back to ambient curiosity via _topGoal() when the explicit
    //      queue is empty, so idle exploration still happens.
    // Fires a single topic off to the Researcher and wires up what happens
    // when it resolves. Split out of _backgroundLearn so that function can
    // fire several of these per tick instead of being hard-capped at one.
    async _fireResearch(topic, entities, goalRef, question = null) {
        // If already resolved, return cached result directly
        if (this._researchedTopics.has(topic)) {
            const cached = this._lastResearchByTopic.get(topic);
            return cached ? { facts: cached } : null;
        }
        if ((this._researchFailCounts.get(topic) || 0) >= 3) return null;

        const existing = this.cortex.recall([topic, ...entities], 'neutral', 3, 'background');
        const context  = existing.map(m => m.content.slice(0, 60)).join(' | ');

        try {
            // Pass question through — Researcher deduplicates concurrent calls
            // for the same topic via its _inFlight map, so a background call
            // already in-flight for this topic will be shared rather than doubled.
            const result = await this._researcher.query(topic, context, question);
            if (!result) {
                const fails = (this._researchFailCounts.get(topic) || 0) + 1;
                this._researchFailCounts.set(topic, fails);
                if (fails >= 3 && goalRef) {
                    const idx = this.goalStack.indexOf(goalRef);
                    if (idx !== -1) {
                        this.goalHistory.push({ ...goalRef, resolvedAt: Date.now(), resolvedBy: 'research_exhausted' });
                        this.goalStack.splice(idx, 1);
                        this._retireCuriosity(goalRef.topic);
                        this._setActiveGoal(this._topGoal());
                        this.ui.brainThinks(`[research] giving up on "${topic}" — repeated no-ops`);
                    }
                }
                return null;
            }
            const { facts } = result;
            this.ui.brainThinks(`[research] "${topic}" → ${facts.slice(0, 80)}`);

            this._researchedTopics.add(topic);
            this._researchFailCounts.delete(topic);
            this._lastResearchByTopic.set(topic, facts);
            this.beliefs.record({ topic, claim: facts, source: 'generated research', confidence: 0.35, verified: false });

            const resolvedEntities = [topic, ...entities].slice(0, 5);
            this.wm.hold(facts.slice(0, 200), resolvedEntities, 'answer', 0.95);
            this._updateSharedFocus('answer', facts, resolvedEntities, 0.95);
            this.cortex.encode(facts, resolvedEntities, 'neutral', 0.75, 1.5, 'semantic');
            this._learnFromText(facts, resolvedEntities, 'neutral', 0.4);

            // ── Integrate research into concept net and neural substrate ──────
            // Parse content words from the facts and associate them with the
            // topic — this is what makes the brain actually *understand* the
            // answer rather than just storing it as a text blob.
            const SKIP_INTEGRATE = new Set([
                'that','this','with','from','just','like','about','have','they','them',
                'their','here','there','will','would','could','should','does','what',
                'which','these','those','then','than','also','very','much','more','some',
                'such','into','onto','over','under','after','before','the','and','for',
                'are','was','were','been','being','its','not','but','can','all','has',
            ]);
            const factWords = facts.toLowerCase()
                .replace(/[^a-z\s]/g, ' ').split(/\s+/)
                .filter(w => w.length > 4 && !SKIP_INTEGRATE.has(w));
            const uniqueFactWords = [...new Set(factWords)].slice(0, 12);

            // Associate each fact word with the topic in the concept net
            for (const word of uniqueFactWords) {
                this.conceptNet.associate(topic, word, 0.5);
                this.conceptNet.learn(word, {}, { valence: 0.1, arousal: 0.3, approach: 0.2 }, null, 0.3);
            }
            // Associate adjacent fact words with each other (co-occurrence)
            for (let i = 0; i < uniqueFactWords.length - 1; i++) {
                this.conceptNet.associate(uniqueFactWords[i], uniqueFactWords[i + 1], 0.3);
            }
            // Encode fact words into the neural substrate so Hebbian weights form
            for (const word of uniqueFactWords.slice(0, 8)) {
                const pattern = soundPattern(word);
                this.brain.reward(0.2);
                this._brainEncode(pattern, 0.6);
                this._brainConsolidate(pattern, 0.5);
            }

            this.brain.reward(0.6);
            if (goalRef) goalRef.urgency = Math.min(1, goalRef.urgency + 0.2);
            return result;
        } catch {
            return null;
        }
    }

    async _awaitResearchForTopic(topic, entities, goalRef, timeoutMs = 4000, question = null) {
        if (!topic) return null;
        if (this._researchedTopics.has(topic)) {
            return this._lastResearchByTopic.get(topic) ? { facts: this._lastResearchByTopic.get(topic) } : null;
        }
        if ((this._researchFailCounts.get(topic) || 0) >= 3) return null;

        this.ui.brainThinks(`[grounding] waiting for research on "${topic}"`);
        const researchPromise = this._fireResearch(topic, entities, goalRef, question);
        const timeoutPromise  = new Promise(resolve => setTimeout(() => resolve(null), timeoutMs));
        const result = await Promise.race([researchPromise, timeoutPromise]);
        if (result?.facts) {
            this.ui.brainThinks(`[grounding] research ready for "${topic}"`);
        } else {
            this.ui.brainThinks(`[grounding] research timed out for "${topic}"`);
        }
        return result;
    }

    async _backgroundLearn() {
        // Matches research.js's own BATCH_SIZE — there's no point offering
        // more topics per tick than a single Groq call can actually cover,
        // but offering fewer (the old code offered exactly one) means the
        // batching capability research.js already has just sits unused and
        // research crawls at ~1 topic per _bgInterval tick instead of up to
        // BATCH_SIZE.
        const MAX_PER_TICK = 5;
        let submitted = 0;

        // 1. Drain the explicit research queue first — topics _think() has
        //    flagged as stuck get a guaranteed slot, FIFO order, ahead of
        //    ambient curiosity (see the _researchQueue comment at declaration).
        while (submitted < MAX_PER_TICK && this._researchQueue.length > 0) {
            const queued = this._researchQueue.shift();
            this._fireResearch(queued.topic, queued.entities || [], null);
            submitted++;
        }

        // 2. Fill any remaining capacity from the goal stack — not just the
        //    single top goal, so idle exploration covers more ground per tick
        //    when nothing has been explicitly flagged as stuck.
        if (submitted < MAX_PER_TICK) {
            for (const goal of this.goalStack) {
                if (submitted >= MAX_PER_TICK) break;
                if (this._researchedTopics.has(goal.topic)) continue;
                this._fireResearch(goal.topic, goal.entities, goal);
                submitted++;
            }
        }
    }

    // ── Internal monologue — only calls LLM every 8 ticks ────────────────────

    // Returns true if a thought string reached a conclusion vs. trailing off unresolved.
    _thoughtIsConclusive(text, activeGoal) {
        if (!text || !activeGoal) return false;

        const trimmed = text.trim();
        
        // ── GATE 1: Reject vague template patterns ──────────────────────────
        const vaguePattern = /^(i |the system |talos )?(understand|see|notice|think|wonder|believe|agree|realize)s?\s+(that\s+)?/i;
        if (vaguePattern.test(trimmed) && trimmed.length < 60) {
            return false;
        }

        // ── GATE 2: Must reference the goal topic or its entities ──────────
        const goalTopic = activeGoal.topic.toLowerCase();
        const goalEntities = (activeGoal.entities || []).map(e => String(e).toLowerCase());
        const textLower = text.toLowerCase();
        
        const touchesGoal = textLower.includes(goalTopic) ||
            goalEntities.some(e => textLower.includes(e));
        if (!touchesGoal) {
            return false;
        }

        // ── GATE 3: Must ground in research results (if available) ──────────
        const researchFacts = this._lastResearchByTopic.get(activeGoal.topic);
        if (researchFacts) {
            const researchWords = researchFacts
                .toLowerCase()
                .replace(/[^a-z\s]/g, ' ')
                .split(/\s+/)
                .filter(w => w.length > 4);
            
            const groundedInResearch = researchWords.length > 0 &&
                researchWords.some(w => text.toLowerCase().includes(w));
            
            if (!groundedInResearch) {
                return false;
            }
        }

        // ── GATE 4: Syntax check (only after content gates pass) ──────────
        if (!(/[.!]$/.test(trimmed) && trimmed.length > 25)) {
            return false;
        }
        if (/\b(i wonder|not sure|maybe|perhaps|i don't know|unclear|i'm unsure|hmm|still\s+thinking)\b/i.test(trimmed)) {
            return false;
        }

        return true;
    }

    async _think() {
        this._thinkCooldown--;
        if (this._thinkCooldown > 0) {
            // A memory recall is not a fresh thought. Returning it here used
            // to create seven invisible copies per reflection cycle, which
            // advanced development and filled the audit window without any
            // new cognition.
            return null;
        }

        this._thinkCooldown = 8;
        const activeGoal = this._topGoal();

        // Recall by the active goal's topic/entities too, not just
        // recentTopics. Research results get encoded into the cortex under
        // [topic, ...entities] (see _fireResearch), but a curiosity-driven
        // goal's topic (e.g. "consciousness") often never appears in
        // recentTopics at all — that list only fills from things actually
        // said in conversation/self-speech. A recall keyed solely on
        // recentTopics silently misses the very facts research just
        // produced for the thing Talos is supposed to be thinking about,
        // so the thought stays vague and never closes the goal.
        const recallTopics = activeGoal
            ? [...new Set([activeGoal.topic, ...(activeGoal.entities || []), ...this.recentTopics.slice(0, 5)])]
            : this.recentTopics.slice(0, 5);
        // Internal monologue favours semantic memories — thinking about general knowledge
        const memories = this.cortex.recall(recallTopics, this.mood, 6, 'background');

        // Hand the most recent research result for this goal straight to
        // the thinking prompt, rather than relying entirely on it being
        // picked up via fuzzy memory recall.
        const researchedFacts = activeGoal ? this._lastResearchByTopic.get(activeGoal.topic) : null;
        // This is the executive decision state: competing claims remain
        // alternatives until evidence actually warrants a conclusion.
        const deliberation = activeGoal ? this.beliefs.deliberate(activeGoal.topic) : null;
        this.deliberation = deliberation;

        // Before calling the LLM, check whether the monologue is circling. If
        // so, force a grounded transition and hand it to the thinking prompt
        // as context rather than letting introspection recurse further.
        const loopInfo = this._detectThoughtLoop();
        const loopBreak = loopInfo ? this._breakThoughtLoop(loopInfo) : null;

        const thought = think({
            observationLog: this.observer.format(3),
            thinkingAudit: this.thinkingAudit.summary,
            mood:         this.mood,
            neuralState:  this.neuralState,
            myName:       this.myName,
            humanName:    this.humanName,
            recentTopics: this.recentTopics,
            cortex:       this.cortex,
            memories,
            workingMemory: this.wm,
            turnsInConversation: this._turnsInConversation,
            activeGoal,
            conversationHistory: this.conversationHistory,
            loopBreak,
            researchedFacts,
            deliberation,
            focus: this.wm.getFocus(),
            conceptActivations: this.conceptNet.formatForLLM(),
        });

        if (thought) {
            // Replaying an old thought is not development. Only a genuinely
            // new reflection may move the developmental state forward.
            const recentThoughts = this.thinkingAudit.recentThoughts.slice(-6);
            const novelReflection = !recentThoughts.some(entry => _jaccard(_tokenSet(entry.text), _tokenSet(thought)) >= 0.65);
            if (novelReflection) {
                this._experiencePoints += 1;
                this._advanceDevStage();
            }

            this._learnFromText(thought, [], 'neutral', 0.1);
            // The raw language-interface output is the inner monologue. Do
            // not replace it with a status string: the user should be able to
            // inspect what the system is actually considering.
            this.ui.brainThinks(thought);
            // Thoughts that surface during internal monologue go into working memory
            this.wm.hold(thought.slice(0, 200), this.recentTopics.slice(0, 3), 'thought', 0.6);
            this._updateSharedFocus('thought', thought, activeGoal ? [activeGoal.topic, ...(activeGoal.entities || [])] : this.recentTopics.slice(0, 3), 0.7);

            let thoughtRecord = {
                text: thought,
                timestamp: Date.now(),
                goal: activeGoal?.topic || null,
                conclusive: false,
                touchedGoal: false,
            };

            // ── Thought closure — did this thought actually land? ─────────────
            if (activeGoal) {
                const thoughtLower = thought.toLowerCase();
                const touchesGoal = thoughtLower.includes(activeGoal.topic.toLowerCase()) ||
                    activeGoal.entities.some(e => thoughtLower.includes(e));
                if (touchesGoal) {
                    thoughtRecord.touchedGoal = true;
                    // Conclusive if: deliberation concluded, OR research facts are
                    // present and the thought references them — don't require the
                    // thought to be the exact deliberation claim string, which was
                    // almost never true and caused every goal to be abandoned.
                    const researchFacts = this._lastResearchByTopic.get(activeGoal.topic);
                    const researchWords = researchFacts
                        ? researchFacts.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 4)
                        : [];
                    const groundedInResearch = researchWords.length > 0 &&
                        researchWords.some(w => thoughtLower.includes(w));
                    const isConclusive = (deliberation?.concluded) || groundedInResearch;

                    if (isConclusive) {
                        thoughtRecord.conclusive = true;
                        const SKIP = new Set(['that','this','with','from','just','like','about','have','very','much']);
                        const thoughtEntities = thoughtLower
                            .replace(/[^a-z\s]/g, ' ').split(/\s+/)
                            .filter(w => w.length > 4 && !SKIP.has(w)).slice(0, 6);
                        const entities = [...new Set([activeGoal.topic, ...activeGoal.entities, ...thoughtEntities])];
                        this.cortex.encode(thought, entities, 'neutral', 0.7, this._getDopamine(), 'semantic');
                        this._learnFromText(thought, entities, 'neutral', 0.5);
                        this.wm.hold(thought.slice(0, 200), entities, 'thought', 0.9);
                        this._finalizeGoal(activeGoal, 'thought');
                        this.ui.brainThinks(`[think] concluded + encoded: "${activeGoal.topic}"`);
                        this.brain.reward(0.5);
                        this._pendingSelfSpeech = thought;
                    } else {
                        activeGoal.researchAttempts = activeGoal.researchAttempts || 0;
                        // Only queue for more research if we haven't already researched
                        // and haven't exceeded attempts — don't abandon immediately
                        if (!this._researchedTopics.has(activeGoal.topic) && activeGoal.researchAttempts < 3) {
                            if (!this._researchQueue.some(q => q.topic === activeGoal.topic)) {
                                this._researchQueue.push({ topic: activeGoal.topic, entities: activeGoal.entities });
                            }
                            activeGoal.researchAttempts++;
                            activeGoal.urgency = Math.min(1, activeGoal.urgency + 0.1);
                            this.ui.brainThinks(`[think] inconclusive on "${activeGoal.topic}" — queued for research (attempt ${activeGoal.researchAttempts})`);
                        } else {
                            // Research done but still inconclusive — encode what we have and move on
                            this._finalizeGoal(activeGoal, 'best_effort');
                            this.ui.brainThinks(`[think] best-effort conclusion on "${activeGoal.topic}"`);
                        }
                    }
                } else {
                    const age = Date.now() - activeGoal.createdAt;
                    if (age > GOAL_IDLE_TIMEOUT_MS) {
                        this._finalizeGoal(activeGoal, 'idle_timeout');
                        this.ui.brainThinks(`[think] abandoning "${activeGoal.topic}" — idle timeout`);
                    }
                }
            }

            this.thinkingAudit.recentThoughts.push(thoughtRecord);
            if (this.thinkingAudit.recentThoughts.length > 12) this.thinkingAudit.recentThoughts.shift();
            this.thinkingAudit.thoughtsSinceLastAudit++;
            await this._runThinkingAudit();

            return thought;
        }

        return null;
    }

    async _composeSpeech() {
        if (this._pendingSelfSpeech) return this._pendingSelfSpeech;
        const activeGoal = this._topGoal();
        const memories = this.cortex.recall(this.recentTopics.slice(0, 5), this.mood, 6, 'introspect');
        return Promise.resolve(speak({
            mood:         this.mood,
            neuralState:  this.neuralState,
            myName:       this.myName,
            humanName:    this.humanName,
            recentTopics: this.recentTopics,
            cortex:       this.cortex,
            memories,
            workingMemory: this.wm,
            turnsInConversation: this._turnsInConversation,
            activeGoal,
            conversationHistory: this.conversationHistory,
            conceptActivations: this.conceptNet.formatForLLM(),
            focus: this.wm.getFocus(),
            researchedFacts: activeGoal ? this._lastResearchByTopic.get(activeGoal.topic) : null,
        }));
    }

    _getBehaviorSignals() {
        if (typeof this.brain?.behaviorState === 'function') {
            return this.brain.behaviorState();
        }
        return {
            valence: this.neuralState?.valence ?? 0,
            arousal: this.neuralState?.arousal ?? 0,
            drive: this.neuralState?.drive ?? 0,
            curiosity: 0,
            uncertainty: 0,
            actionReadiness: 0,
            patience: 0.5,
            speechReadiness: 0.15,
            researchDrive: 0,
        };
    }

    _getBrainPolicy() {
        if (typeof this.brain?.decideBehavior === 'function') {
            return this.brain.decideBehavior({
                activeGoal: this._topGoal(),
                pendingSelfSpeech: !!this._pendingSelfSpeech,
                humanPresent: this.ticksSinceHuman < 30 ? false : this.inputQueue.length > 0,
                ticksSinceHuman: this.ticksSinceHuman,
                lastSpokeTick: this.lastSpokeTick,
                tickCount: this.tickCount,
            });
        }
        return this._getBehaviorSignals();
    }

    _shouldResearchTopic(parsed, behavior = null) {
        if (!parsed?.topic || typeof parsed.topic !== 'string') return false;
        if (!['question', 'teaching', 'correction'].includes(parsed.intent)) return false;
        const signals = behavior || this._getBehaviorSignals();
        const uncertainty = signals.uncertainty ?? 0;
        const curiosity = signals.curiosity ?? 0;
        const researchDrive = signals.researchDrive ?? 0;
        return parsed.intent === 'question' || uncertainty > 0.2 || curiosity > 0.35 || researchDrive > 0.22;
    }

    _shouldSpeak(behavior = null) {
        if (!this._pendingSelfSpeech) return false;
        const policy = behavior || this._getBrainPolicy();
        return policy.canSpeak;
    }

    // ── Main loop ─────────────────────────────────────────────────────────────

    async start(onLangDone) {
        this.running = true;
        this.ui.log('Conative network online.');
        await languageBoot(this, this.ui.log.bind(this.ui));
        typeof onLangDone == 'function' ? onLangDone() : null;

        // 4s rather than the old 10s — combined with _backgroundLearn now
        // submitting up to 5 topics per tick (matching research.js's own
        // BATCH_SIZE), this raises effective research throughput roughly
        // 12x (was ~1 topic/10s, now up to 5 topics/4s) without changing
        // research.js's own network pacing (still one in-flight request,
        // still drains its queue every 1s).
        this._bgInterval    = setInterval(() => {
            if (!this.running) return;
            this._driveGoalsFromCuriosity();
            this._backgroundLearn();
        }, 4000);
        this._decayInterval = setInterval(() => this.cortex.decay(), 120000);
        this._wmInterval    = setInterval(() => this.wm.tick(), 5000);
        this._observeInterval = setInterval(() => {
            const entry = this.observer.observe(this.brain, this.meta, this.mood);
            if (entry.notable) this.ui.brainThinks(`[observe] ${entry.notable}`);
        }, 30000);

        while (this.running) {
            this.tickCount++;
            this.ticksSinceHuman++;

            // Sync mood from actual brain state every tick
            this._syncMoodFromBrain();
            if (typeof this.ui.updateState === 'function') {
                this.ui.updateState(this.mood, this.neuralState);
            }
            // PFC monitors overall brain activity every tick — top-down inhibition runs continuously
            this.brain.selfAwareness();

            if (this.inputQueue.length === 0 && this.tickCount % 3 === 0) {
                this._autonomousMove();
            }

            if (this.inputQueue.length > 0) {
                const msg = this.inputQueue.shift();

                if (this._looksLikeCommand(msg)) {
                    const response = await this._handleCommand(msg);
                    this.ui.brainSpeaks(response);
                    this.lastSpokeTick   = this.tickCount;
                    this.ticksSinceHuman = 0;
                    await new Promise(r => setTimeout(r, 50));
                    continue;
                }

                const response = await this._respondToHuman(msg);
                this._pendingSelfSpeech = null;
                if (response) this.ui.brainSpeaks(response);
                this.lastSpokeTick   = this.tickCount;
                this.ticksSinceHuman = 0;
                await new Promise(r => setTimeout(r, 50));
                continue;
            }

            // Internal monologue
            const thought = await this._think();
            if (thought) {
                this.thoughts.push(thought);
                if (this.thoughts.length > 30) this.thoughts.shift();
                // Thinking about something = perceive it
                for (const w of thought.split(' ').slice(0, 5)) {
                    this.brain.perceive(soundPattern(w));
                }
            }

            const policy = this._getBrainPolicy();
            if (this._shouldSpeak(policy)) {
                const speech = await this._composeSpeech();
                if (speech) {
                    if (this._isRepeatSpontaneousSpeech(speech)) {
                        // Same failure mode _detectThoughtLoop/_breakThoughtLoop
                        // guard against for internal monologue — the LLM has
                        // anchored on a stock line and is about to repeat it
                        // unprompted. Suppress it rather than speaking it, and
                        // still advance lastSpokeTick so _shouldSpeak() waits
                        // out its normal cooldown before trying again instead
                        // of re-invoking _composeSpeech() (an LLM call) every
                        // single tick until the roll fails.
                        this.ui.brainThinks('[speech-loop-break] suppressing repeat spontaneous utterance');
                        this.lastSpokeTick = this.tickCount;
                        this._recentSpontaneousSpeech = [];
                    } else {
                        this.ui.brainSpeaks(speech);
                        this.lastSpokeTick = this.tickCount;
                        this._pendingSelfSpeech = null;
                        // Spontaneous speech needs the same grounding a
                        // conversational reply gets (_respondToHuman calls
                        // _selfSpoke on every reply) — otherwise it's a "free"
                        // utterance that never enters memory, the concept net,
                        // or curiosity, and self-talk contributes nothing new
                        // to research even though it's genuine mental content.
                        this._selfSpoke(speech, this.recentTopics.slice(0, 5));
                        this._experiencePoints += 1;
                        this._recentSpontaneousSpeech.push({ text: speech, timestamp: Date.now() });
                        if (this._recentSpontaneousSpeech.length > 6) this._recentSpontaneousSpeech.shift();
                    }
                }
            }

            for (let t = 0; t < 5; t++) this.brain.engine.tick();
            await new Promise(r => setTimeout(r, 0));
            await new Promise(r => setTimeout(r, 100));
        }
    }

    stop() {
        this.running = false;
        if (this._bgInterval)     clearInterval(this._bgInterval);
        if (this._decayInterval)  clearInterval(this._decayInterval);
        if (this._wmInterval)     clearInterval(this._wmInterval);
        if (this._observeInterval) clearInterval(this._observeInterval);
        if (this.visualCortex)    this.visualCortex.stop();
        this._researcher.stop();
    }
}
