// snapshot.js — save/load trained brain weights for fast startup (browser build)
// Uses IndexedDB instead of the filesystem. IndexedDB's structured-clone
// algorithm stores TypedArrays (Float32Array/Float64Array) and plain
// JSON-shaped objects natively, so there's no need to hand-pack buffers,
// chunk large writes, or worry about Node's 2GB writeSync limit — the
// browser's storage quota (usually GBs, and negotiable via the Storage API)
// takes care of it.
//
// All functions are async (IndexedDB is inherently async) and are safe to
// call from SSR — they just no-op and resolve to `false` if `indexedDB`
// isn't available (e.g. during a Next.js server render).

const DB_NAME = 'talos-brain';
const DB_VERSION = 1;
const STORE = 'kv';

const KEY_SNAPSHOT = 'snapshot';
const KEY_STATE = 'state';
const KEY_GENOME = 'genome';

function hasIndexedDB() {
    return typeof indexedDB !== 'undefined';
}

let dbPromise = null;
function openDB() {
    if (!hasIndexedDB()) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE);
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function idbGet(key) {
    const db = await openDB();
    if (!db) return undefined;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbSet(key, value) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

async function idbDelete(key) {
    const db = await openDB();
    if (!db) return false;
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => reject(tx.error);
    });
}

// ── Trained weights + activity state ────────────────────────────────────

export async function saveSnapshot(engine) {
    if (!hasIndexedDB()) return false;
    try {
        // Structured clone copies the TypedArrays' underlying bytes, so this
        // is a real snapshot, not a live reference to engine's buffers.
        await idbSet(KEY_SNAPSHOT, {
            weights: engine.synapseWeights,
            firedAt: engine.firedAt,
        });
        return true;
    } catch {
        return false;
    }
}

export async function loadSnapshot(engine) {
    if (!hasIndexedDB()) return false;
    try {
        const data = await idbGet(KEY_SNAPSHOT);
        if (!data || !data.weights) return false;

        if (data.weights.length !== engine.synapseWeights.length) {
            await idbDelete(KEY_SNAPSHOT);
            return false;
        }
        engine.synapseWeights.set(data.weights);

        if (data.firedAt && data.firedAt.length === engine.firedAt.length) {
            engine.firedAt.set(data.firedAt);
        }
        return true;
    } catch {
        return false;
    }
}

// ── Full consciousness state ────────────────────────────────────────────
// Everything that makes the brain "alive" beyond weights.

export async function saveState(consciousness) {
    if (!hasIndexedDB()) return false;
    const {
        brain, cortex, wm, meta, myName, humanName, selfModel,
        devStage, devStageProgress, _turnsInConversation,
        conversationHistory, thoughts, recentTopics, curiosity,
        goalStack, goalHistory, mood, neuralState, thinkingAudit, beliefs,
    } = consciousness;

    const state = {
        myName, humanName, selfModel,
        devStage, devStageProgress,
        turnsInConversation: _turnsInConversation,
        conversationHistory, thoughts, recentTopics, curiosity,
        goalStack, goalHistory, mood, neuralState, thinkingAudit,
        needs: brain.needs,
        body: brain.body,
        valence: brain._valence,
        arousal: brain._arousal,
        drive: brain._drive,
        dopamine: brain.engine.dopamine,
        norepinephrine: brain.engine.norepinephrine,
        cortexNodes: cortex.nodes,
        cortexNextId: cortex._nextId,
        wmSlots: wm.slots,
        metaLog: meta.log,
        metaWeights: meta.weights,
        beliefs: beliefs ? { items: beliefs.items, nextId: beliefs._nextId } : null,
    };

    try {
        await idbSet(KEY_STATE, state);
        return true;
    } catch {
        return false;
    }
}

export async function loadState(consciousness) {
    if (!hasIndexedDB()) return false;
    try {
        const s = await idbGet(KEY_STATE);
        if (!s) return false;

        const { brain, cortex, wm, meta } = consciousness;
        if (s.myName) consciousness.myName = s.myName;
        if (s.humanName) consciousness.humanName = s.humanName;
        if (s.selfModel) consciousness.selfModel = s.selfModel;
        if (s.devStage != null) consciousness.devStage = s.devStage;
        if (s.devStageProgress != null) consciousness.devStageProgress = s.devStageProgress;
        if (s.turnsInConversation != null) consciousness._turnsInConversation = s.turnsInConversation;
        if (s.conversationHistory) consciousness.conversationHistory = s.conversationHistory;
        if (s.thoughts) consciousness.thoughts = s.thoughts;
        if (s.recentTopics) consciousness.recentTopics = s.recentTopics;
        if (s.curiosity) consciousness.curiosity = s.curiosity;
        if (s.goalStack) consciousness.goalStack = s.goalStack;
        if (s.goalHistory) consciousness.goalHistory = s.goalHistory;
        if (s.mood) consciousness.mood = s.mood;
        if (s.neuralState) consciousness.neuralState = s.neuralState;
        if (s.needs) brain.needs = s.needs;
        if (s.thinkingAudit) consciousness.thinkingAudit = s.thinkingAudit;
        if (s.body) brain.body = s.body;
        if (s.valence != null) brain._valence = s.valence;
        if (s.arousal != null) brain._arousal = s.arousal;
        if (s.drive != null) brain._drive = s.drive;
        if (s.dopamine != null) brain.engine.dopamine = s.dopamine;
        if (s.norepinephrine != null) brain.engine.norepinephrine = s.norepinephrine;
        if (s.cortexNodes) {
            cortex.nodes = s.cortexNodes;
            cortex._nextId = s.cortexNextId ?? cortex._nextId;
        }
        if (s.wmSlots) wm.slots = s.wmSlots;
        if (s.metaLog) meta.log = s.metaLog;
        if (s.metaWeights) meta.weights = s.metaWeights;
        if (s.beliefs && consciousness.beliefs) {
            consciousness.beliefs.items = Array.isArray(s.beliefs.items) ? s.beliefs.items : [];
            consciousness.beliefs._nextId = s.beliefs.nextId ?? consciousness.beliefs.items.length;
        }
        return true;
    } catch {
        return false;
    }
}

// ── Genome (tuned parameters) ────────────────────────────────────────────

export async function saveGenome(genome) {
    if (!hasIndexedDB()) return false;
    try {
        await idbSet(KEY_GENOME, genome.snapshot());
        return true;
    } catch {
        return false;
    }
}

export async function loadGenome(genome) {
    if (!hasIndexedDB()) return false;
    try {
        const data = await idbGet(KEY_GENOME);
        if (!data) return false;
        genome.restore(data);
        return true;
    } catch {
        return false;
    }
}
