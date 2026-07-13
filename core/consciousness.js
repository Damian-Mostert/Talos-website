import { soundPattern, SEED_CONCEPTS } from './boot.js';
import { search } from './search.js';
import { understand, respond, think, speak, auditThinking } from './llm.js';
import { saveSnapshot, saveGenome, loadGenome, saveState, loadState } from './snapshot.js';
import { MemoryCortex } from './memory.js';
import { WorkingMemory } from './working-memory.js';
import { Metacognition } from './metacognition.js';
import { SelfObserver } from './observer.js';
import { Genome } from './genome.js';
import { Homeostasis } from './homeostasis.js';
import { StateRegulator } from './regulator.js';
import { VisualCortex } from './vision.js';
import { runSandbox } from './sandbox.js';

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

        this.thoughts = [];
        this.myName   = null;
        this.humanName = null;
        this.conversationHistory = [];

        this.mood = 'curious';
        this.neuralState = { valence: 0, arousal: 0, drive: 0 };

        this.devStage = 1;
        this.devStageProgress = 0;
        this.DEV_STAGE_THRESHOLDS = [0, 0, 5, 15, 30, 60];

        this.curiosity = [];

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

        this.thinkingAudit = {
            recentThoughts: [],
            summary: null,
            auditsRun: 0,
            thoughtsSinceLastAudit: 0,
        };

        this.visualCortex  = null;
        this.lastScene     = null;
        this.lastObjects   = [];

        this.memory = [];
        this.selfModel = { name: null, known: [] };
        this.activeGoal = null;
        this.plan = null;
        this._memoryIndex = new Map();
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

            // Each visible object gets Hebbian encoding + consolidation — same as hearing a word
            for (const obj of objects.slice(0, 6)) {
                this._learnConcept(obj, 0.5);
                if (!this.recentTopics.includes(obj)) this.recentTopics.unshift(obj);
                if (!this.curiosity.includes(obj))    this.curiosity.push(obj);
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
        for (const [topic, concept] of SEED_CONCEPTS) {
            if (concept.stage > stage) continue;
            // Salience = certainty — Talos holds uncertain concepts loosely
            this.cortex.encode(concept.hint, [topic], 'neutral', concept.certainty, 0, 'semantic');
            // Concepts needing examples become curiosity goals, not facts
            if (concept.examplesNeeded && concept.curiosity > 0.5) {
                if (!this.curiosity.includes(topic)) this.curiosity.push(topic);
            }
        }
    }

    _advanceDevStage() {
        if (this.devStage >= 5) return;
        const threshold = this.DEV_STAGE_THRESHOLDS[this.devStage + 1];
        if (this._turnsInConversation >= threshold) {
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
        const auditSummary = await auditThinking({
            mood: this.mood,
            neuralState: this.neuralState,
            myName: this.myName,
            activeGoal,
            workingMemory: this.wm,
            thoughts: this.thinkingAudit.recentThoughts.map(entry => entry.text),
            conversationHistory: this.conversationHistory,
            observationLog: this.observer.format(4),
            goalHistory: this.goalHistory.slice(-8),
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

    // ── Human input ───────────────────────────────────────────────────────────

    _humanSpoke(text, entities = []) {
        this._setDopamine(2.5);
        this.ticksSinceHuman = 0;

        const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        for (const word of words) this.brain.perceive(soundPattern(word));

        const concepts = entities.length > 0
            ? entities.filter(e => typeof e === 'string').map(e => e.toLowerCase()).filter(e => e.length > 3)
            : words.filter(w => w.length > 4);

        for (const concept of concepts.slice(0, 5)) {
            this._brainEncode(soundPattern(concept), 0.8);
            this._brainConsolidate(soundPattern(concept), 0.6);
            if (!this.recentTopics.includes(concept)) this.recentTopics.unshift(concept);
            if (!this.curiosity.includes(concept)) this.curiosity.push(concept);
        }
        if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
        if (this.curiosity.length > 40)    this.curiosity    = this.curiosity.slice(-40);

        // Load human input into working memory — this is what we're actively attending to
        this.wm.hold(text.slice(0, 200), concepts.slice(0, 5), 'input', 1.0);
        this.wm.rehearse(concepts);
    }

    _selfSpoke(text, entities = []) {
        const words = text.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter(w => w.length > 1);
        for (const word of words) this.brain.perceive(soundPattern(word));

        const concepts = entities.length > 0
            ? entities.filter(e => typeof e === 'string').map(e => e.toLowerCase()).filter(e => e.length > 3)
            : words.filter(w => w.length > 4);

        const selfEntities = [...new Set(['self_speech', 'self', ...concepts])];
        for (const concept of selfEntities.slice(0, 6)) {
            this._brainEncode(soundPattern(concept), 0.7);
            this._brainConsolidate(soundPattern(concept), 0.5);
            if (!this.recentTopics.includes(concept)) this.recentTopics.unshift(concept);
            if (!this.curiosity.includes(concept)) this.curiosity.push(concept);
        }
        if (this.recentTopics.length > 20) this.recentTopics = this.recentTopics.slice(0, 20);
        if (this.curiosity.length > 40)    this.curiosity    = this.curiosity.slice(-40);

        this.cortex.encode(`I said: ${text}`, selfEntities, 'neutral', 0.5, this._getDopamine(), 'procedural');
        this._learnFromText(text, selfEntities, 'neutral', 0.3);
        this.wm.hold(text.slice(0, 200), selfEntities, 'self_speech', 0.9);
        this.wm.rehearse(selfEntities);
    }

    // ── Core response pipeline ────────────────────────────────────────────────

    async _respondToHuman(text) {
        this._turnsInConversation++;
        this._advanceDevStage();

        const nameMatch = text.match(/(?:my name is|call me|i(?:'m| am))\s+([A-Za-z][a-zA-Z]+)/i);
        if (nameMatch) this._rememberIdentity(nameMatch[1]);

        const pfcLevel = this.brain.selfAwareness();
        this.ui.brainThinks(`[pfc] ${pfcLevel.toFixed(3)}`);
        this.ui.thinking('thinking...');

        const parsed = await understand(text, {
            recentTopics: this.recentTopics.slice(0, 8),
            knowledge:    this.recentTopics.slice(0, 15),
            mood:         this.mood,
            neuralState:  this.neuralState,
            humanName:    this.humanName,
        });

        this._humanSpoke(text, parsed.entities || []);

        // Reafference — read what the association cortex settled into after encoding
        // This is the brain's actual response to the input, not just the text entities.
        // Use it to bias memory recall toward what resonated neurally.
        const reaf = this.brain.reafference();
        this.ui.brainThinks(`[reaf] strength=${reaf.strength.toFixed(3)} indices=${reaf.indices.length}`);

        // Brain name
        if (parsed.intent === 'brain_name') {
            const bnMatch = text.match(/(?:you(?:'re| are)|your name is|call (?:yourself|you))\s+([A-Za-z][a-zA-Z]*)/i);
            if (bnMatch) {
                this.myName = bnMatch[1];
                this.cortex.encode(`My name is ${this.myName}`, ['my_name', this.myName.toLowerCase()], 'neutral', 1.0, 2.0, 'semantic');
                this.brain.reward(3.0);
            }
        }

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
        const explicitGoalTopic = typeof text === 'string' && /help|understand|learn|explain|memory/i.test(text)
            ? text.match(/(?:help|understand|learn|explain|memory)[^\n.]*/i)?.[0] || 'understanding'
            : null;
        if (parsed.topic && typeof parsed.topic === 'string') {
            const goalType =
                parsed.intent === 'question'  ? 'understand' :
                parsed.intent === 'teaching'  ? 'integrate'  :
                parsed.intent === 'correct'   ? 'revise'     : null;
            if (goalType) this._pushGoal(goalType, parsed.topic, parsed.entities || []);
        } else if (explicitGoalTopic) {
            this._pushGoal('understand', explicitGoalTopic, parsed.entities || []);
        }

        if (/\b(move|go|walk|come)\b.{0,20}\b(up|north)\b/i.test(text))    { this.brain.move( 0, -1, 0.9); }
        else if (/\b(move|go|walk|come)\b.{0,20}\b(down|south)\b/i.test(text)) { this.brain.move( 0,  1, 0.9); }
        else if (/\b(move|go|walk|come)\b.{0,20}\b(left|west)\b/i.test(text))  { this.brain.move(-1,  0, 0.9); }
        else if (/\b(move|go|walk|come)\b.{0,20}\b(right|east)\b/i.test(text)) { this.brain.move( 1,  0, 0.9); }
        else if (/\b(move|go|walk|explore)\b/i.test(text)) { this.brain.move((Math.random() > 0.5 ? 1 : -1) * 0.5, (Math.random() > 0.5 ? 1 : -1) * 0.5, 0.9); }
        if (/\b(move|go|walk|come|up|down|left|right|north|south|east|west|explore)\b/i.test(text)) {
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

        // Search if needed
        let searchResult = null;
        if (parsed.needsSearch && parsed.searchQuery) {
            this.ui.thinking(`searching "${parsed.searchQuery}"...`);
            try {
                const results = await search(parsed.searchQuery);
                const useful  = results.find(r => r.text && r.text.length > 60);
                if (useful) {
                    searchResult = useful.text;
                    // Search results are semantic — factual knowledge, not tied to a turn
                    this.cortex.encode(useful.text.slice(0, 300), [parsed.searchQuery, ...(parsed.entities || [])], 'neutral', 0.7, this._getDopamine(), 'semantic');
                    this._learnFromText(useful.text, parsed.entities || [], 'neutral', 0.6);
                    this.ui.brainThinks(`[learned] "${parsed.searchQuery}"`);
                }
            } catch {}
        }

        if (parsed.intent === 'teaching' && parsed.topic && parsed.summary) {
            // Teaching encodes as semantic — it's meant to be general knowledge
            this.cortex.encode(parsed.summary, [parsed.topic, ...(parsed.entities || [])], emotion, 0.8, this._getDopamine(), 'semantic');
            this._learnConcept(parsed.topic, 0.8);
        }

        // Recall relevant memories — biased by neural reafference pattern
        const memories = this.cortex.recallByReafference(reaf.indices, parsed.entities || [], emotion, 8, 'conversation');

        const activeGoal = this._topGoal();

        // Look up certainty for the topic being discussed
        const topicConcept = parsed.topic && typeof parsed.topic === 'string' ? SEED_CONCEPTS.get(parsed.topic.toLowerCase()) : null;
        const conceptCertainty = topicConcept ? topicConcept.certainty : null;

        // Predict before deciding
        const decisionRecord = this.meta.predict(this.neuralState, parsed, reaf.strength);
        this.ui.brainThinks(`[meta] predicted response_type=${decisionRecord.prediction.response_type}`);

        // Raw snapshot before LLM call — captures pre-response brain state
        const rawStateBefore = this.brain.readInternalState();

        // ── Sandbox execution — run any calcCode the LLM emitted last turn ────
        // We pass sandboxResult into respond() so the AI sees its own output.
        let sandboxResult = null;
        if (this._pendingCalcCode) {
            const sr = runSandbox(this._pendingCalcCode);
            sandboxResult = sr.error
                ? `[calc error] ${sr.error}`
                : `[calc result] ${sr.result}${sr.logs ? '\n' + sr.logs : ''}`;
            this.ui.brainThinks(sandboxResult);
            this._pendingCalcCode = null;
        }

        const reply = await respond(parsed, {
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
        });

        if (reply) {
            const replyText = reply.reply;

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

            // ── Self-modification — execute the LLM's state decision ──────────────
            // Queue any calc code for execution before the next response
            if (reply.calcCode) this._pendingCalcCode = reply.calcCode;

            if (reply.stateIntent) {
                const reg = this.regulator.act(reply.stateIntent, this.brain, reply.stateReason);
                if (reg) {
                    this.ui.brainThinks(`[regulate] ${reg.label} → valence ${reg.delta.valence > 0 ? '+' : ''}${reg.delta.valence} arousal ${reg.delta.arousal > 0 ? '+' : ''}${reg.delta.arousal} [${reg.effective ? 'effective' : 'weak'}] reason: "${reg.reason || ''}"`);
                }
            }

            // Execute movement intent directly on motor system
            if (reply.moveIntent && typeof reply.moveIntent.dx === 'number') {
                const { dx, dy = 0 } = reply.moveIntent;
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
            if (dopamineDelta > 0) this.brain.reward(dopamineDelta);
            else                   this.brain.punish(-dopamineDelta);

            this.observer.lastDopamine        = this._getDopamine();
            this.observer.lastPredictionError = dopamineDelta;
            this.observer.lastInputSalience   = inputSalience;
            this.observer.lastReafStrength    = reaf.strength;

            const wu = decisionRecord.weight_updates;
            this.ui.brainThinks(`[meta] accuracy=${decisionRecord.accuracy} conf=${decisionRecord.prediction.confidence} actual=${decisionRecord.actual?.response_type} da=${dopamineDelta > 0 ? '+' : ''}${dopamineDelta.toFixed(3)}${wu ? ` weights:${JSON.stringify(wu)}` : ''}`);

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
        const MAX_GOALS = 5;
        // Don't duplicate an identical active goal
        if (this.goalStack.some(g => g.type === type && g.topic === topic)) return;

        const urgency = Math.min(1, 0.3 + this.neuralState.arousal * 0.5 + this.neuralState.drive * 0.3);
        this.goalStack.push({ type, topic, entities, urgency, createdAt: Date.now(), turnId: this._turnsInConversation });

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

    _resolveTopGoal(entities = []) {
        if (this.goalStack.length === 0) return;
        this._sortGoals();
        const top = this.goalStack[0];
        // Resolve if the reply touched the goal's topic or entities
        const hit = entities.some(e => top.entities.includes(e) || top.topic.toLowerCase().includes(e));
        if (hit || (Date.now() - top.createdAt) > 300000) {
            this.goalHistory.push({ ...top, resolvedAt: Date.now() });
            this.goalStack.shift();
        }
        this._setActiveGoal(this._topGoal());
    }

    // ── Reactive fallback — used when PFC is too low for deliberate processing ───────
    // Pulls from working memory and recent episodic memories only.
    // No LLM call — this is a gut response.
    _reactiveFallback(text) {
        return this._fallback(null);
    }

    _fallback(parsed) {
        const name = this.humanName ? `, ${this.humanName}` : '';
        if (parsed?.intent === 'greeting')   return `Hey${name}.`;
        if (parsed?.intent === 'farewell')   return `Talk soon${name}.`;
        if (parsed?.intent === 'human_name') return `Got it${name}. Good to know you.`;
        if (parsed?.emotion === 'upset')     return `I hear you${name}. I'm here.`;
        if (parsed?.entities?.length > 0) {
            const mems = this.cortex.recall(parsed.entities, 'neutral', 1);
            if (mems.length > 0) return mems[0].content.slice(0, 200);
        }
        const { valence, arousal } = this.neuralState;
        if (arousal > 0.4) return `Something in what you said is activating me${name}. Say more.`;
        if (valence < -0.1) return `I'm processing that${name}. Give me a moment.`;
        return `I'm here${name}. Keep going.`;
    }

    // ── Background learning ───────────────────────────────────────────────────

    async _backgroundLearn() {
        if (this._bgResearching || this.curiosity.length === 0) return;
        this._bgResearching = true;
        try {
            const query = this.curiosity.shift();
            if (!query) return;
            const results = await search(query);
            const useful  = results.find(r => r.text && r.text.length > 60);
            if (useful) {
                const SKIP = new Set(['that','this','with','from','just','like','about','have']);
                const extraEntities = useful.text.toLowerCase()
                    .replace(/[^a-z\s]/g, ' ').split(/\s+/)
                    .filter(w => w.length > 4 && !SKIP.has(w))
                    .slice(0, 6);
                const entities = [...new Set([query, ...query.split(' '), ...extraEntities])];
                // Background learning is semantic — no specific turn, general knowledge
                this.cortex.encode(useful.text.slice(0, 300), entities, 'neutral', 0.7, 1.0, 'semantic');
                this._learnFromText(useful.text, entities, 'neutral', 0.4);
                this.brain.reward(0.5);
                this.ui.brainThinks(`[bg] learned: "${query}"`);
            }
        } catch {}
        this._bgResearching = false;
    }

    // ── Internal monologue — only calls LLM every 8 ticks ────────────────────

    // Returns true if a thought string reached a conclusion vs. trailing off unresolved.
    _thoughtIsConclusive(text) {
        if (!text) return false;
        // Ends with a period/exclamation after meaningful content = concluded
        const trimmed = text.trim();
        if (/[.!]$/.test(trimmed) && trimmed.length > 20) {
            // But not if it's just an open question or uncertainty marker
            if (/\b(i wonder|not sure|maybe|perhaps|i don't know|unclear|i'm unsure)\b/i.test(trimmed)) return false;
            return true;
        }
        return false;
    }

    async _think() {
        this._thinkCooldown--;
        if (this._thinkCooldown > 0) {
            const mems = this.cortex.recall(this.recentTopics.slice(0, 3), this.mood, 1);
            if (mems.length === 0) return null;
            return mems[0].content.slice(0, 80);
        }

        this._thinkCooldown = 8;
        // Internal monologue favours semantic memories — thinking about general knowledge
        const memories = this.cortex.recall(this.recentTopics.slice(0, 5), this.mood, 6, 'background');
        const activeGoal = this._topGoal();

        // Before calling the LLM, check whether the monologue is circling. If
        // so, force a grounded transition and hand it to the thinking prompt
        // as context rather than letting introspection recurse further.
        const loopInfo = this._detectThoughtLoop();
        const loopBreak = loopInfo ? this._breakThoughtLoop(loopInfo) : null;

        const thought = await think({
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
        });

        if (thought) {
            this._learnFromText(thought, [], 'neutral', 0.1);
            // Thoughts that surface during internal monologue go into working memory
            this.wm.hold(thought.slice(0, 200), this.recentTopics.slice(0, 3), 'thought', 0.6);

            let thoughtRecord = {
                text: thought,
                timestamp: Date.now(),
                goal: activeGoal?.topic || null,
                conclusive: false,
                touchedGoal: false,
            };

            // ── Thought closure — did this thought actually land? ─────────────
            // If the thought touches the active goal, check if it concluded.
            // Conclusive → resolve the goal. Inconclusive → deepen it.
            if (activeGoal) {
                const thoughtLower = thought.toLowerCase();
                const touchesGoal = thoughtLower.includes(activeGoal.topic.toLowerCase()) ||
                    activeGoal.entities.some(e => thoughtLower.includes(e));
                if (touchesGoal) {
                    thoughtRecord.touchedGoal = true;
                    if (this._thoughtIsConclusive(thought)) {
                        thoughtRecord.conclusive = true;
                        // Thought reached a conclusion — encode it as a semantic memory
                        // This is the moment understanding forms: the thought becomes knowledge.
                        const SKIP = new Set(['that','this','with','from','just','like','about','have','very','much']);
                        const thoughtEntities = thought.toLowerCase()
                            .replace(/[^a-z\s]/g, ' ').split(/\s+/)
                            .filter(w => w.length > 4 && !SKIP.has(w))
                            .slice(0, 6);
                        const entities = [...new Set([activeGoal.topic, ...activeGoal.entities, ...thoughtEntities])];
                        this.cortex.encode(thought, entities, 'neutral', 0.7, this._getDopamine(), 'semantic');
                        this._learnFromText(thought, entities, 'neutral', 0.5);
                        this.wm.hold(thought.slice(0, 200), entities, 'thought', 0.9);

                        // Resolve the goal
                        this.goalHistory.push({ ...activeGoal, resolvedAt: Date.now(), resolvedBy: 'thought' });
                        this.goalStack.shift();
                        this._setActiveGoal(this._topGoal());
                        this.ui.brainThinks(`[think] concluded + encoded: "${activeGoal.topic}"`);
                        this.brain.reward(0.5);
                    } else {
                        // Thought touched the goal but didn't conclude — push topic into curiosity
                        // so background research can fill the gap
                        if (!this.curiosity.includes(activeGoal.topic)) {
                            this.curiosity.push(activeGoal.topic);
                        }
                        // Bump urgency so it stays at the top of the stack
                        activeGoal.urgency = Math.min(1, activeGoal.urgency + 0.1);
                        this.ui.brainThinks(`[think] inconclusive on "${activeGoal.topic}" — queued for research`);
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
        const memories = this.cortex.recall(this.recentTopics.slice(0, 5), this.mood, 6, 'introspect');
        return speak({
            mood:         this.mood,
            neuralState:  this.neuralState,
            myName:       this.myName,
            humanName:    this.humanName,
            recentTopics: this.recentTopics,
            cortex:       this.cortex,
            memories,
            workingMemory: this.wm,
            turnsInConversation: this._turnsInConversation,
            activeGoal:   this._topGoal(),
            conversationHistory: this.conversationHistory,
        });
    }

    _shouldSpeak() {
        if (this.ticksSinceHuman < 10) return false;
        const gap = this.tickCount - this.lastSpokeTick;
        return gap >= 25 && Math.random() < 0.15;
    }

    // ── Main loop ─────────────────────────────────────────────────────────────

    async start() {
        this.running = true;
        this.ui.log('Consciousness online.');

        this._bgInterval    = setInterval(() => { if (this.running) this._backgroundLearn(); }, 10000);
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
                this.ui.brainSpeaks(response);
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

            if (this._shouldSpeak()) {
                const speech = await this._composeSpeech();
                if (speech) {
                    this.ui.brainSpeaks(speech);
                    this.lastSpokeTick = this.tickCount;
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
    }
}