// neuropile_core.cpp - implementation of the native Neuropile substrate.

#include "neuropile_core.hpp"

#include <algorithm>
#include <cctype>
#include <cstddef>
#include <cstring>
#include <limits>

namespace neuropile {

namespace {

inline float clampf(float v, float lo, float hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

inline float tanhf_(double v) {
    return static_cast<float>(std::tanh(v));
}

inline float safeNeed(float v) {
    if (!std::isfinite(v)) return 0.0f;
    return clampf(v, 0.0f, 1.0f);
}

inline std::string lowerAscii(std::string s) {
    for (char& c : s) {
        c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
    }
    return s;
}

}  // namespace

// ─────────────────────────────────────────────────────────────────────────────
// NeuralEngine
// ─────────────────────────────────────────────────────────────────────────────

NeuralEngine::NeuralEngine(uint32_t neuronCount, uint32_t synapsesPerNeuron) {
    n = neuronCount == 0 ? 1 : neuronCount;
    synapseCapacity = synapsesPerNeuron == 0 ? 1 : synapsesPerNeuron;

    potential.assign(n, 0.0f);
    threshold.assign(n, 1.0f);
    decayRate.assign(n, 0.95f);
    firedAt.assign(n, 0.0);
    inhibitory.assign(n, 0);

    const size_t synapseTotal = static_cast<size_t>(n) * static_cast<size_t>(synapseCapacity);
    synapseTargets.assign(synapseTotal, 0);
    synapseWeights.assign(synapseTotal, 0.0f);
    synapseCounts.assign(n, 0);

    active_.assign(n, 0);
    inQueue_.assign(n, 0);
    activeList_.reserve(n);
    queueBuf_.resize(MAX_QUEUE);
}

double NeuralEngine::nowMs() {
    using namespace std::chrono;
    return static_cast<double>(
        duration_cast<microseconds>(steady_clock::now().time_since_epoch()).count()) / 1000.0;
}

void NeuralEngine::connect(uint32_t src, uint32_t dst, float weight) {
    if (src >= n || dst >= n) return;
    const size_t base = static_cast<size_t>(src) * synapseCapacity;
    const uint32_t count = synapseCounts[src];
    if (count >= synapseCapacity) return;
    synapseTargets[base + count] = dst;
    synapseWeights[base + count] = weight;
    synapseCounts[src] = count + 1;
}

void NeuralEngine::receive(uint32_t i, float signal) {
    if (i >= n) return;
    const float prev = potential[i];
    potential[i] += signal;

    if (prev == 0.0f && signal != 0.0f && !active_[i]) {
        active_[i] = 1;
        activeList_.push_back(static_cast<int32_t>(i));
    }

    if (potential[i] >= threshold[i]) {
        if (firing_) {
            if (!inQueue_[i]) {
                inQueue_[i] = 1;
                if (fqLen_ < MAX_QUEUE) {
                    queueBuf_[fqLen_++] = static_cast<int32_t>(i);
                }
            }
        } else {
            propagate(i);
        }
    }
}

float NeuralEngine::inject(uint32_t i, float signal) {
    if (i >= n) return 0.0f;
    const float prev = potential[i];
    potential[i] += signal;
    if (prev == 0.0f && signal != 0.0f && !active_[i]) {
        active_[i] = 1;
        activeList_.push_back(static_cast<int32_t>(i));
    }
    return potential[i];
}

void NeuralEngine::pulse(uint32_t i, float signal) {
    if (i >= n) return;
    potential[i] += signal;
    if (!active_[i]) {
        active_[i] = 1;
        activeList_.push_back(static_cast<int32_t>(i));
    }
    if (potential[i] >= threshold[i]) {
        const float residual = threshold[i] * 0.8f;
        propagate(i);
        potential[i] = residual;
        if (!active_[i]) {
            active_[i] = 1;
            activeList_.push_back(static_cast<int32_t>(i));
        }
    }
}

void NeuralEngine::propagate(uint32_t start) {
    fqLen_ = 0;
    queueBuf_[fqLen_++] = static_cast<int32_t>(start);
    inQueue_[start] = 1;
    firing_ = true;
    const double now = nowMs();

    for (int32_t qi = 0; qi < fqLen_; ++qi) {
        fire(static_cast<uint32_t>(queueBuf_[qi]), now);
    }

    for (int32_t qi = 0; qi < fqLen_; ++qi) {
        inQueue_[static_cast<uint32_t>(queueBuf_[qi])] = 0;
    }
    firing_ = false;
    fqLen_ = 0;
}

void NeuralEngine::fire(uint32_t i, double now) {
    if (firedAt[i] != 0.0 && now - firedAt[i] < REFRACTORY_MS) return;

    firedAt[i] = now;
    potential[i] = 0.0f;

    const size_t base = static_cast<size_t>(i) * synapseCapacity;
    const uint32_t count = synapseCounts[i];
    const float sign = inhibitory[i] ? -1.0f : 1.0f;
    const double da = dopamine;
    const bool doHebbian = da > 0.05 || da < -0.05;

    for (uint32_t k = 0; k < count; ++k) {
        const uint32_t dst = synapseTargets[base + k];

        if (doHebbian) {
            const bool coActive = firedAt[dst] != 0.0 && now - firedAt[dst] < 50.0;
            if (coActive) {
                const float rate = HEBBIAN_RATE * std::max(0.1f, static_cast<float>(1.0 + da));
                const float w = synapseWeights[base + k] + rate;
                synapseWeights[base + k] = w > MAX_WEIGHT ? MAX_WEIGHT : w;
            } else {
                const float decay = WEIGHT_DECAY * static_cast<float>(1.0 - da * 0.5);
                const float w = synapseWeights[base + k] - decay;
                synapseWeights[base + k] = w < MIN_WEIGHT ? MIN_WEIGHT : w;
            }
        }

        const float newPot = potential[dst] + sign * synapseWeights[base + k];
        potential[dst] = newPot;

        if (!active_[dst]) {
            active_[dst] = 1;
            activeList_.push_back(static_cast<int32_t>(dst));
        }

        if (newPot >= threshold[dst] && fqLen_ < MAX_QUEUE) {
            if (!inQueue_[dst]) {
                inQueue_[dst] = 1;
                queueBuf_[fqLen_++] = static_cast<int32_t>(dst);
            }
        }
    }
}

void NeuralEngine::tick() {
    const size_t listSize = activeList_.size();
    const bool overload = listSize > 50000;
    const float inhibScale = overload ? 0.35f : 1.0f;

    size_t writeIdx = 0;
    for (size_t i = 0; i < listSize; ++i) {
        const uint32_t idx = static_cast<uint32_t>(activeList_[i]);
        const float v = potential[idx] * decayRate[idx] * inhibScale * 0.92f;
        if (std::fabs(v) > 1e-6f) {
            potential[idx] = v;
            activeList_[writeIdx++] = static_cast<int32_t>(idx);
        } else {
            potential[idx] = 0.0f;
            active_[idx] = 0;
        }
    }
    activeList_.resize(writeIdx);

    dopamine *= DOPAMINE_DECAY;
    norepinephrine *= NE_DECAY;
}

void NeuralEngine::setThreshold(uint32_t start, uint32_t end, float value) {
    if (start >= n) return;
    end = std::min(end, n);
    if (start >= end) return;
    std::fill(threshold.begin() + start, threshold.begin() + end, value);
}

void NeuralEngine::setInhibitory(uint32_t start, uint32_t end) {
    if (start >= n) return;
    end = std::min(end, n);
    if (start >= end) return;
    std::fill(inhibitory.begin() + start, inhibitory.begin() + end, static_cast<uint8_t>(1));
}

float NeuralEngine::meanAbs(uint32_t start, uint32_t end, uint32_t step) const {
    if (start >= n) return 0.0f;
    end = std::min(end, n);
    if (start >= end) return 0.0f;
    if (step == 0) step = 1;

    double sum = 0.0;
    uint64_t count = 0;
    for (uint32_t i = start; i < end; i += step) {
        const float v = potential[i];
        sum += v < 0.0f ? -static_cast<double>(v) : static_cast<double>(v);
        ++count;
    }
    return count == 0 ? 0.0f : static_cast<float>(sum / static_cast<double>(count));
}

float NeuralEngine::peakAbs(uint32_t start, uint32_t end) const {
    if (start >= n) return 0.0f;
    end = std::min(end, n);
    if (start >= end) return 0.0f;

    const uint32_t step = std::max<uint32_t>(1, (end - start) / 2000);
    float peak = 0.0f;
    for (uint32_t i = start; i < end; i += step) {
        const float v = std::fabs(potential[i]);
        if (v > peak) peak = v;
    }
    return peak;
}

void NeuralEngine::rebuildActiveSet() {
    active_.assign(n, 0);
    inQueue_.assign(n, 0);
    activeList_.clear();
    activeList_.reserve(n);
    firing_ = false;
    fqLen_ = 0;
    for (uint32_t i = 0; i < n; ++i) {
        if (potential[i] != 0.0f) {
            active_[i] = 1;
            activeList_.push_back(static_cast<int32_t>(i));
        }
    }
}

std::vector<float> NeuralEngine::activation(uint32_t start, uint32_t end) const {
    if (start >= n) return {};
    end = std::min(end, n);
    if (start >= end) return {};
    return std::vector<float>(potential.begin() + start, potential.begin() + end);
}

void NeuralEngine::remapFrom(const NeuralEngine& src, const std::vector<uint32_t>& remap) {
    const uint32_t oldN = src.n;
    const uint32_t copyCapacity = std::min(synapseCapacity, src.synapseCapacity);

    for (uint32_t i = 0; i < oldN && i < remap.size(); ++i) {
        const uint32_t j = remap[i];
        if (j >= n) continue;

        potential[j] = src.potential[i];
        threshold[j] = src.threshold[i];
        decayRate[j] = src.decayRate[i];
        firedAt[j] = src.firedAt[i];
        inhibitory[j] = src.inhibitory[i];

        const size_t oldBase = static_cast<size_t>(i) * src.synapseCapacity;
        const size_t newBase = static_cast<size_t>(j) * synapseCapacity;
        uint32_t count = src.synapseCounts[i];
        if (count > copyCapacity) count = copyCapacity;
        synapseCounts[j] = count;

        for (uint32_t k = 0; k < count; ++k) {
            const uint32_t target = src.synapseTargets[oldBase + k];
            synapseTargets[newBase + k] = target < remap.size() ? remap[target] : target;
            synapseWeights[newBase + k] = src.synapseWeights[oldBase + k];
        }
    }

    dopamine = src.dopamine;
    norepinephrine = src.norepinephrine;
    rebuildActiveSet();
}

// ─────────────────────────────────────────────────────────────────────────────
// BrainCore — region table
// ─────────────────────────────────────────────────────────────────────────────

const std::vector<Region>& BrainCore::baseRegions() {
    static const std::vector<Region> regions = {
        // name, start, end, size, threshold, inhibRatio
        {"thalamus",       0, 0,  80000, 0.15f, 0.10f},
        {"hypothalamus",   0, 0,  50000, 0.10f, 0.05f},
        {"amygdala",       0, 0,  40000, 0.12f, 0.05f},
        {"sensory",        0, 0, 400000, 0.25f, 0.20f},
        {"visual",         0, 0, 100000, 0.20f, 0.15f},
        {"hippocampus",    0, 0, 160000, 0.20f, 0.15f},
        {"temporal",       0, 0, 200000, 0.25f, 0.10f},
        {"association",    0, 0, 600000, 0.30f, 0.20f},
        {"prefrontal",     0, 0, 300000, 0.20f, 0.10f},
        {"acc",            0, 0, 120000, 0.26f, 0.18f},
        {"basalGanglia",   0, 0, 180000, 0.32f, 0.35f},
        {"motor",          0, 0, 240000, 0.35f, 0.20f},
        {"cerebellum",     0, 0, 300000, 0.30f, 0.30f},
        {"vta",            0, 0,  20000, 0.08f, 0.05f},
        {"locusCoeruleus", 0, 0,  15000, 0.08f, 0.05f},
        {"raphe",          0, 0,  15000, 0.08f, 0.05f},
    };
    return regions;
}

uint32_t BrainCore::scaledSize(uint32_t base, double scale) {
    long long rounded = static_cast<long long>(std::llround(static_cast<double>(base) * scale / 1000.0)) * 1000LL;
    if (rounded < 4) rounded = 4;
    if (rounded > static_cast<long long>(std::numeric_limits<uint32_t>::max())) {
        rounded = std::numeric_limits<uint32_t>::max();
    }
    return static_cast<uint32_t>(rounded);
}

BrainCore::BrainCore(const BrainOptions& options)
    : engine_(1, 200), options_(options) {
    if (options_.hasSeed) {
        rng_.seed(options_.seed);
    } else {
        rng_.seed(std::random_device{}());
    }

    double baseTotal = 0.0;
    for (const Region& r : baseRegions()) baseTotal += static_cast<double>(r.size);
    if (baseTotal <= 0.0) baseTotal = 1.0;

    const double scale = (options_.useStartNeurons && options_.startNeurons > 0)
        ? static_cast<double>(options_.startNeurons) / baseTotal
        : (options_.useExplicitNeurons && options_.neurons > 0)
            ? static_cast<double>(options_.neurons) / baseTotal
            : options_.sizeGB / 1.82;

    uint32_t offset = 0;
    regions_.reserve(baseRegions().size());
    for (const Region& base : baseRegions()) {
        Region r = base;
        r.baseSize = base.size;
        r.size = scaledSize(base.size, scale);
        r.start = offset;
        r.end = offset + r.size;
        offset += r.size;
        regionIndex_[r.name] = regions_.size();
        regions_.push_back(r);
    }

    // Growth defaults. maxNeurons is clamped to the initial size so a smaller
    // explicit cap can never shrink the brain.
    if (!options_.hasMaxNeurons || options_.maxNeurons < offset) {
        options_.maxNeurons = offset;
    }
    if (!options_.hasAutoGrow) {
        options_.autoGrow = options_.maxNeurons > offset;
    }
    if (options_.growthBatch == 0) {
        options_.growthBatch = std::max<uint32_t>(1, offset / 100);
    }
    if (!options_.hasGrowthInterval) {
        options_.growthInterval = 100;
    }
    if (options_.growthFanout == 0) {
        options_.growthFanout = 8;
    }

    engine_ = NeuralEngine(offset, options_.synapsesPerNeuron);

    const Region& assoc = regionRef("association");
    baseline_.assign(assoc.size, 0.0f);
    reafBaseline_.assign(assoc.size, 0.0f);

    needs_ = Needs{};
    body_ = Body{};
    motorState_ = MotorState{};

    applyRegionProperties();
    if (options_.wire) wire();
}

void BrainCore::applyRegionProperties() {
    for (const Region& r : regions_) {
        engine_.setThreshold(r.start, r.end, r.threshold);
        const uint32_t inhibEnd = r.start + static_cast<uint32_t>(std::floor(r.size * r.inhibRatio));
        engine_.setInhibitory(r.start, inhibEnd);
    }
}

const Region* BrainCore::region(const std::string& name) const {
    const auto it = regionIndex_.find(name);
    if (it == regionIndex_.end()) return nullptr;
    return &regions_[it->second];
}

const Region& BrainCore::regionRef(const std::string& name) const {
    const Region* r = region(name);
    if (r != nullptr) return *r;
    return regions_.front();
}

void BrainCore::setBaseline(const std::vector<float>& values) {
    baseline_.assign(values.begin(), values.end());
    baseline_.resize(regionRef("association").size, 0.0f);
}

void BrainCore::setReafBaseline(const std::vector<float>& values) {
    reafBaseline_.assign(values.begin(), values.end());
    reafBaseline_.resize(regionRef("association").size, 0.0f);
}

void BrainCore::wireRegions(const std::string& srcName,
                            const std::string& dstName,
                            float density,
                            float wMin,
                            float wMax) {
    const Region* src = region(srcName);
    const Region* dst = region(dstName);
    if (src == nullptr || dst == nullptr || src->size == 0 || dst->size == 0) return;

    const uint32_t requested = static_cast<uint32_t>(std::floor(static_cast<double>(src->size) * density));
    const uint32_t sampleSize = std::min(options_.maxConnections, requested);

    std::uniform_int_distribution<uint32_t> srcDist(0, src->size - 1);
    std::uniform_int_distribution<uint32_t> dstDist(0, dst->size - 1);
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);

    for (uint32_t k = 0; k < sampleSize; ++k) {
        const uint32_t i = src->start + srcDist(rng_);
        const uint32_t j = dst->start + dstDist(rng_);
        const float w = wMin + unit(rng_) * (wMax - wMin);
        engine_.connect(i, j, w);
    }
}

namespace {

struct WireSpec {
    const char* src;
    const char* dst;
    float density;
    float wMin;
    float wMax;
};

const std::vector<WireSpec>& wiringSpecs() {
    static const std::vector<WireSpec> specs = {
        // Thalamus
        {"visual",         "thalamus",       0.8f, 0.5f, 1.0f},
        {"sensory",        "thalamus",       0.8f, 0.5f, 1.0f},
        {"thalamus",       "visual",         0.3f, 0.2f, 0.5f},
        {"thalamus",       "sensory",        0.3f, 0.2f, 0.5f},
        {"thalamus",       "association",    0.6f, 0.4f, 0.9f},
        {"thalamus",       "hippocampus",    0.4f, 0.3f, 0.7f},
        {"prefrontal",     "thalamus",       0.3f, 0.2f, 0.6f},
        // Hypothalamus: drives -> thalamus, amygdala, VTA
        {"hypothalamus",   "thalamus",       0.5f, 0.4f, 0.9f},
        {"hypothalamus",   "amygdala",       0.4f, 0.3f, 0.8f},
        {"hypothalamus",   "prefrontal",     0.3f, 0.2f, 0.6f},
        {"hypothalamus",   "vta",            0.4f, 0.3f, 0.8f},
        {"prefrontal",     "hypothalamus",   0.2f, 0.1f, 0.4f},
        // Amygdala
        {"thalamus",       "amygdala",       0.6f, 0.5f, 1.0f},
        {"sensory",        "amygdala",       0.4f, 0.3f, 0.8f},
        {"visual",         "amygdala",       0.3f, 0.3f, 0.7f},
        {"amygdala",       "thalamus",       0.4f, 0.4f, 0.8f},
        {"amygdala",       "prefrontal",     0.4f, 0.3f, 0.7f},
        {"amygdala",       "acc",            0.4f, 0.3f, 0.7f},
        {"amygdala",       "hippocampus",    0.5f, 0.4f, 0.9f},
        {"amygdala",       "motor",          0.3f, 0.3f, 0.7f},
        {"amygdala",       "locusCoeruleus", 0.4f, 0.3f, 0.8f},
        {"prefrontal",     "amygdala",       0.3f, 0.2f, 0.5f},
        {"hippocampus",    "amygdala",       0.3f, 0.2f, 0.5f},
        // Cortical feedforward
        {"visual",         "association",    0.5f, 0.3f, 0.7f},
        {"sensory",        "association",    0.5f, 0.3f, 0.7f},
        {"association",    "hippocampus",    0.7f, 0.4f, 0.9f},
        {"hippocampus",    "association",    0.7f, 0.4f, 0.9f},
        {"hippocampus",    "temporal",       0.8f, 0.5f, 1.0f},
        {"temporal",       "hippocampus",    0.6f, 0.3f, 0.8f},
        {"temporal",       "association",    0.6f, 0.3f, 0.8f},
        {"association",    "prefrontal",     0.5f, 0.3f, 0.8f},
        {"prefrontal",     "association",    0.4f, 0.2f, 0.6f},
        {"prefrontal",     "motor",          0.4f, 0.3f, 0.8f},
        {"association",    "motor",          0.4f, 0.3f, 0.7f},
        {"motor",          "cerebellum",     0.5f, 0.3f, 0.7f},
        {"cerebellum",     "motor",          0.5f, 0.3f, 0.7f},
        {"cerebellum",     "sensory",        0.3f, 0.2f, 0.5f},
        {"sensory",        "motor",          0.3f, 0.2f, 0.6f},
        // ACC: conflict monitor
        {"association",    "acc",            0.4f, 0.3f, 0.7f},
        {"prefrontal",     "acc",            0.3f, 0.2f, 0.6f},
        {"acc",            "prefrontal",     0.5f, 0.4f, 0.8f},
        {"acc",            "basalGanglia",   0.4f, 0.3f, 0.7f},
        {"acc",            "association",    0.3f, 0.2f, 0.5f},
        {"acc",            "locusCoeruleus", 0.3f, 0.2f, 0.6f},
        // Basal ganglia: winner-take-all gating
        {"prefrontal",     "basalGanglia",   0.5f, 0.4f, 0.9f},
        {"association",    "basalGanglia",   0.4f, 0.3f, 0.7f},
        {"hippocampus",    "basalGanglia",   0.3f, 0.2f, 0.6f},
        {"basalGanglia",   "motor",          0.5f, 0.4f, 0.9f},
        {"basalGanglia",   "prefrontal",     0.3f, 0.2f, 0.5f},
        {"basalGanglia",   "thalamus",       0.4f, 0.3f, 0.7f},
        {"vta",            "basalGanglia",   0.5f, 0.4f, 0.9f},
        // Neuromodulator nuclei
        {"hippocampus",    "vta",            0.3f, 0.2f, 0.6f},
        {"prefrontal",     "vta",            0.2f, 0.1f, 0.4f},
        {"vta",            "prefrontal",     0.4f, 0.3f, 0.7f},
        {"vta",            "hippocampus",    0.4f, 0.3f, 0.7f},
        {"vta",            "association",    0.3f, 0.2f, 0.5f},
        {"locusCoeruleus", "thalamus",       0.4f, 0.3f, 0.7f},
        {"locusCoeruleus", "prefrontal",     0.3f, 0.2f, 0.6f},
        {"locusCoeruleus", "association",    0.3f, 0.2f, 0.5f},
        {"prefrontal",     "raphe",          0.2f, 0.1f, 0.4f},
        {"raphe",          "amygdala",       0.3f, 0.2f, 0.5f},
        {"raphe",          "prefrontal",     0.3f, 0.2f, 0.5f},
        {"raphe",          "association",    0.2f, 0.1f, 0.4f},
        {"raphe",          "basalGanglia",   0.2f, 0.1f, 0.4f},
    };
    return specs;
}

}  // namespace

void BrainCore::wire() {
    for (const WireSpec& s : wiringSpecs()) {
        wireRegions(s.src, s.dst, s.density, s.wMin, s.wMax);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Growth
// ─────────────────────────────────────────────────────────────────────────────

std::vector<float> BrainCore::growthWeights() const {
    static const float defaults[] = {
        0.8f, 0.4f, 0.7f, 1.4f, 1.2f, 3.0f, 1.6f, 2.6f,
        2.2f, 1.2f, 1.0f, 1.0f, 1.0f, 0.3f, 0.2f, 0.2f,
    };
    const size_t count = regions_.size();
    std::vector<float> weights(count, 0.0f);
    const bool custom = options_.growthProfile.size() == count;
    for (size_t i = 0; i < count; ++i) {
        float multiplier = custom ? options_.growthProfile[i] : defaults[i];
        if (multiplier < 0.0f) multiplier = 0.0f;
        weights[i] = multiplier * static_cast<float>(regions_[i].baseSize);
    }
    return weights;
}

std::vector<uint32_t> BrainCore::distributeGrowth(uint32_t count) {
    const size_t n = regions_.size();
    std::vector<uint32_t> additions(n, 0);
    if (n == 0 || count == 0) return additions;

    const std::vector<float> weights = growthWeights();
    double total = 0.0;
    for (float w : weights) total += w;
    if (total <= 0.0) {
        additions[0] = count;
        return additions;
    }

    std::vector<double> remainders(n, 0.0);
    uint32_t assigned = 0;
    for (size_t i = 0; i < n; ++i) {
        const double exact = static_cast<double>(count) * (weights[i] / total);
        additions[i] = static_cast<uint32_t>(std::floor(exact));
        remainders[i] = exact - static_cast<double>(additions[i]);
        assigned += additions[i];
    }

    // Largest-remainder apportionment keeps the sum exact.
    uint32_t left = count - assigned;
    while (left > 0) {
        size_t best = 0;
        double bestRemainder = -1.0;
        for (size_t i = 0; i < n; ++i) {
            if (remainders[i] > bestRemainder) {
                bestRemainder = remainders[i];
                best = i;
            }
        }
        additions[best]++;
        remainders[best] = -1.0;
        --left;
    }
    return additions;
}

void BrainCore::wireNewNeurons(const std::vector<Region>& oldRegions,
                               const std::vector<uint32_t>& additions) {
    const uint32_t fanout = options_.growthFanout == 0 ? 8 : options_.growthFanout;
    std::uniform_real_distribution<float> unit(0.0f, 1.0f);

    for (size_t idx = 0; idx < regions_.size() && idx < oldRegions.size(); ++idx) {
        if (additions[idx] == 0) continue;

        const Region& oldRegion = oldRegions[idx];
        const Region& grown = regions_[idx];
        const uint32_t newStart = grown.start + oldRegion.size;
        const uint32_t newEnd = grown.end;
        if (newStart >= newEnd) continue;

        std::uniform_int_distribution<uint32_t> selfDist(grown.start, grown.end - 1);

        for (uint32_t neuron = newStart; neuron < newEnd; ++neuron) {
            // Local recurrent connections so the newborn is not isolated.
            for (uint32_t k = 0; k < fanout; ++k) {
                const uint32_t dst = selfDist(rng_);
                if (dst == neuron) continue;
                engine_.connect(neuron, dst, 0.1f + unit(rng_) * 0.4f);
            }
            for (uint32_t k = 0; k < fanout; ++k) {
                const uint32_t src = selfDist(rng_);
                if (src == neuron) continue;
                engine_.connect(src, neuron, 0.1f + unit(rng_) * 0.4f);
            }

            // Long-range connections follow the same wiring table as the
            // original brain, so a grown region keeps its role in the circuit.
            for (const WireSpec& spec : wiringSpecs()) {
                if (std::strcmp(spec.src, grown.name.c_str()) == 0) {
                    const Region* dstRegion = region(spec.dst);
                    if (dstRegion != nullptr && dstRegion->size > 0) {
                        std::uniform_int_distribution<uint32_t> dstDist(dstRegion->start, dstRegion->end - 1);
                        for (uint32_t k = 0; k < fanout; ++k) {
                            const float w = spec.wMin + unit(rng_) * (spec.wMax - spec.wMin);
                            engine_.connect(neuron, dstDist(rng_), w);
                        }
                    }
                }
                if (std::strcmp(spec.dst, grown.name.c_str()) == 0) {
                    const Region* srcRegion = region(spec.src);
                    if (srcRegion != nullptr && srcRegion->size > 0) {
                        std::uniform_int_distribution<uint32_t> srcDist(srcRegion->start, srcRegion->end - 1);
                        for (uint32_t k = 0; k < fanout; ++k) {
                            const float w = spec.wMin + unit(rng_) * (spec.wMax - spec.wMin);
                            engine_.connect(srcDist(rng_), neuron, w);
                        }
                    }
                }
            }
        }
    }
}

uint32_t BrainCore::grow(uint32_t count) {
    const uint32_t remaining = engine_.n < options_.maxNeurons
        ? options_.maxNeurons - engine_.n
        : 0;
    const uint32_t add = std::min(count, remaining);
    if (add == 0) return 0;

    const std::vector<uint32_t> additions = distributeGrowth(add);
    uint32_t actualAdd = 0;
    for (uint32_t a : additions) actualAdd += a;
    if (actualAdd == 0) return 0;

    const std::vector<Region> oldRegions = regions_;

    std::vector<Region> nextRegions = regions_;
    std::vector<uint32_t> remap(engine_.n, 0);
    uint32_t offset = 0;
    for (size_t idx = 0; idx < nextRegions.size(); ++idx) {
        const Region& oldRegion = oldRegions[idx];
        Region& region = nextRegions[idx];
        region.start = offset;
        region.size = oldRegion.size + additions[idx];
        region.end = offset + region.size;
        offset += region.size;
        for (uint32_t o = 0; o < oldRegion.size; ++o) {
            remap[oldRegion.start + o] = region.start + o;
        }
    }

    NeuralEngine grown(offset, engine_.synapseCapacity);
    grown.remapFrom(engine_, remap);
    engine_ = std::move(grown);

    regions_ = std::move(nextRegions);
    rebuildRegionIndex();
    applyRegionProperties();
    wireNewNeurons(oldRegions, additions);

    const Region& assoc = regionRef("association");
    baseline_.resize(assoc.size, 0.0f);
    reafBaseline_.resize(assoc.size, 0.0f);

    ++growthEvents_;
    return actualAdd;
}

uint32_t BrainCore::growTo(uint32_t target) {
    if (target <= engine_.n) return 0;
    return grow(target - engine_.n);
}

uint32_t BrainCore::maybeGrow() {
    if (!options_.autoGrow) return 0;
    if (engine_.n >= options_.maxNeurons) return 0;
    if (options_.growthInterval == 0) return 0;
    if (tickCount_ < lastGrowthTick_ + options_.growthInterval) return 0;
    lastGrowthTick_ = tickCount_;
    return grow(options_.growthBatch);
}

float BrainCore::growthProgress() const {
    if (options_.maxNeurons == 0) return 1.0f;
    return clampf(static_cast<float>(engine_.n) / static_cast<float>(options_.maxNeurons), 0.0f, 1.0f);
}

void BrainCore::rebuildRegionIndex() {
    regionIndex_.clear();
    for (size_t i = 0; i < regions_.size(); ++i) {
        regionIndex_[regions_[i].name] = i;
    }
}

void BrainCore::setRegions(const std::vector<Region>& regions) {
    regions_ = regions;
    rebuildRegionIndex();
    const Region& assoc = regionRef("association");
    baseline_.resize(assoc.size, 0.0f);
    reafBaseline_.resize(assoc.size, 0.0f);
}

void BrainCore::resizeEngine(uint32_t newN, uint32_t synapseCapacity) {
    engine_ = NeuralEngine(newN, synapseCapacity);
}

void BrainCore::restoreOptions(const BrainOptions& options) {
    options_.useStartNeurons = options.useStartNeurons;
    options_.startNeurons = options.startNeurons;
    options_.hasMaxNeurons = options.hasMaxNeurons;
    options_.maxNeurons = options.maxNeurons;
    options_.hasAutoGrow = options.hasAutoGrow;
    options_.autoGrow = options.autoGrow;
    options_.growthBatch = options.growthBatch;
    options_.hasGrowthInterval = options.hasGrowthInterval;
    options_.growthInterval = options.growthInterval;
    options_.growthFanout = options.growthFanout;
    options_.growthProfile = options.growthProfile;
}

// ─────────────────────────────────────────────────────────────────────────────
// Drives, body, interaction
// ─────────────────────────────────────────────────────────────────────────────

void BrainCore::tick(uint32_t count) {
    for (uint32_t i = 0; i < count; ++i) {
        engine_.tick();
        ++tickCount_;
    }
    maybeGrow();
}

void BrainCore::reward(float strength) {
    engine_.dopamine = std::min(engine_.dopamine + static_cast<double>(strength), 3.0);
}

void BrainCore::punish(float strength) {
    engine_.dopamine = std::max(engine_.dopamine - static_cast<double>(strength), -1.0);
}

Needs BrainCore::setNeeds(const Needs& needs) {
    needs_.hunger = safeNeed(needs.hunger);
    needs_.energy = safeNeed(needs.energy);
    needs_.joy = safeNeed(needs.joy);
    return needs_;
}

Needs BrainCore::getNeeds() const {
    return needs_;
}

Body BrainCore::getBody() const {
    return body_;
}

MotorState BrainCore::getMotorState() const {
    return motorState_;
}

void BrainCore::tickNeeds() {
    needs_.hunger = clampf(needs_.hunger - 0.002f, 0.0f, 1.0f);
    needs_.energy = clampf(needs_.energy - 0.0015f, 0.0f, 1.0f);
    needs_.joy = clampf(needs_.joy - 0.0018f, 0.0f, 1.0f);
}

Body BrainCore::move(float dx, float dy, float intensity) {
    const float speed = clampf(intensity, 0.0f, 1.0f);
    const float step = 0.10f * speed;

    body_.x = clampf(body_.x + dx * step, 0.0f, 1.0f);
    body_.y = clampf(body_.y + dy * step, 0.0f, 1.0f);
    if (dx != 0.0f || dy != 0.0f) {
        body_.heading = static_cast<float>(std::atan2(dy, dx));
    }
    body_.speed = std::sqrt(dx * dx + dy * dy) * speed;
    body_.energy = clampf(body_.energy - 0.01f * speed, 0.0f, 1.0f);
    needs_.energy = clampf(needs_.energy - 0.01f * speed, 0.0f, 1.0f);
    needs_.joy = clampf(needs_.joy - 0.003f * speed, 0.0f, 1.0f);
    motorState_.moveX = dx;
    motorState_.moveY = dy;
    motorState_.lastAction = "move";

    const Region& motor = regionRef("motor");
    const Region& cereb = regionRef("cerebellum");
    const Region& sensory = regionRef("sensory");
    const uint32_t qSize = motorQuadrantSize();

    const int rightQ = dx > 0.0f ? 0 : 1;
    const int downQ = dy > 0.0f ? 2 : 3;
    engine_.pulse(motor.start + static_cast<uint32_t>(rightQ) * qSize, 1.8f * speed);
    engine_.pulse(motor.start + static_cast<uint32_t>(downQ) * qSize, 1.8f * speed);

    engine_.pulse(cereb.start, 1.4f * speed);
    engine_.inject(cereb.start + 8, 1.2f * speed);

    engine_.pulse(sensory.start + 64, 1.6f * speed * std::fabs(dx));
    engine_.pulse(sensory.start + 72, 1.6f * speed * std::fabs(dy));
    engine_.inject(sensory.start + 80, 1.2f * speed);

    reward(0.06f * speed);
    return body_;
}

Needs BrainCore::handleInteraction(const std::string& kind, float intensity) {
    tickNeeds();
    const float strength = clampf(intensity, 0.1f, 1.0f);

    if (kind == "feed") {
        needs_.hunger = std::min(1.0f, needs_.hunger + 0.28f * strength);
        needs_.joy = std::min(1.0f, needs_.joy + 0.08f * strength);
        reward(0.7f + 0.2f * strength);
    } else if (kind == "rest") {
        needs_.energy = std::min(1.0f, needs_.energy + 0.3f * strength);
        needs_.joy = std::min(1.0f, needs_.joy + 0.04f * strength);
        reward(0.45f + 0.15f * strength);
    } else if (kind == "play" || kind == "poke") {
        needs_.joy = std::min(1.0f, needs_.joy + 0.18f * strength);
        needs_.energy = std::max(0.0f, needs_.energy - 0.04f * strength);
        reward(0.25f + 0.1f * strength);
    } else if (kind == "danger") {
        needs_.energy = std::max(0.0f, needs_.energy - 0.08f * strength);
        needs_.joy = std::max(0.0f, needs_.joy - 0.06f * strength);
        punish(0.2f + 0.1f * strength);
    } else {
        needs_.joy = std::max(0.0f, needs_.joy - 0.02f * strength);
        punish(0.05f * strength);
    }

    return needs_;
}

float BrainCore::amygdalaActivate(float threatLevel) {
    const Region& amyg = regionRef("amygdala");
    engine_.pulse(amyg.start, threatLevel * 2.5f);
    engine_.pulse(amyg.start + 8, threatLevel * 2.0f);

    const float amygLevel = engine_.meanAbs(amyg.start, amyg.end, 2);
    if (amygLevel > 0.001f) {
        startle(std::min(1.0f, amygLevel * 80.0f * threatLevel));
    }
    return amygLevel;
}

void BrainCore::startle(float strength) {
    engine_.norepinephrine = std::min(engine_.norepinephrine + static_cast<double>(strength), 3.0);

    const float boost = strength * 0.1f;
    const Region& sensory = regionRef("sensory");
    const Region& assoc = regionRef("association");

    const uint32_t sStep = std::max<uint32_t>(5, sensory.size / 2000);
    for (uint32_t i = sensory.start; i < sensory.end; i += sStep) {
        engine_.threshold[i] = std::min(engine_.threshold[i] + boost, 2.0f);
    }

    const uint32_t aStep = std::max<uint32_t>(5, assoc.size / 2000);
    for (uint32_t i = assoc.start; i < assoc.end; i += aStep) {
        engine_.threshold[i] = std::min(engine_.threshold[i] + boost, 2.0f);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// World integration
// ─────────────────────────────────────────────────────────────────────────────

EmotionalState BrainCore::integrateWorldState(const WorldState& state) {
    const Region& thalamus = regionRef("thalamus");
    const Region& sensory = regionRef("sensory");
    const Region& visual = regionRef("visual");
    const Region& assoc = regionRef("association");
    const Region& motor = regionRef("motor");
    const Region& hypo = regionRef("hypothalamus");
    const Region& amyg = regionRef("amygdala");
    const Region& cereb = regionRef("cerebellum");

    if (state.hasBody) {
        body_.x = state.body.x;
        body_.y = state.body.y;
        body_.heading = state.body.heading;
        body_.speed = state.body.speed;
        body_.energy = state.body.energy;

        const float x = body_.x;
        const float y = body_.y;
        const float heading = body_.heading;
        const float speed = body_.speed;
        const float vx = state.vx;
        const float vy = state.vy;

        const float borderX = (x < 0.12f || x > 0.88f) ? 1.3f : 0.0f;
        const float borderY = (y < 0.12f || y > 0.88f) ? 1.3f : 0.0f;
        const float bodySignal = 2.6f + std::max(0.0f, speed) * 1.8f;

        engine_.pulse(thalamus.start + 0, bodySignal * (0.9f + std::fabs(x - 0.5f) * 1.4f + borderX));
        engine_.pulse(thalamus.start + 8, bodySignal * (0.9f + std::fabs(y - 0.5f) * 1.4f + borderY));
        engine_.pulse(thalamus.start + 16, bodySignal * (0.8f + std::fabs(heading) * 0.4f + borderX + borderY));

        const float motionSignal = 1.8f + std::min(1.5f, std::sqrt(vx * vx + vy * vy) * 8.0f);
        engine_.pulse(sensory.start + 88, motionSignal * 1.8f);
        engine_.inject(sensory.start + 96, motionSignal * 1.2f);
        engine_.inject(assoc.start + 12, motionSignal * 0.8f);
        engine_.pulse(thalamus.start + 48, motionSignal * 0.7f);
    }

    if (state.hasOpticFlow) {
        const float flowX = state.flowX;
        const float flowY = state.flowY;
        const float flowMag = std::min(
            1.0f,
            static_cast<float>(std::sqrt(flowX * flowX + flowY * flowY + state.flowMagnitude * state.flowMagnitude)));

        if (flowMag > 0.02f) {
            const float flowDir = static_cast<float>(std::atan2(flowY, flowX));
            const uint32_t visualSize = visual.size;
            int quadrant = static_cast<int>(std::floor(((flowDir + static_cast<float>(PI)) / static_cast<float>(PI / 2.0))));
            quadrant = ((quadrant % 4) + 4) % 4;
            const uint32_t qStep = std::max<uint32_t>(8, visualSize / 16);
            const uint32_t baseIdx = visual.start + static_cast<uint32_t>(quadrant) * qStep;
            const uint32_t opposite = visual.start + static_cast<uint32_t>((quadrant + 2) % 4) * qStep;

            engine_.pulse(baseIdx, 1.4f + flowMag * 2.0f);
            engine_.inject(opposite, 0.9f + flowMag * 1.1f);
            engine_.pulse(sensory.start + 112, 1.0f + flowMag * 1.3f);
            engine_.inject(assoc.start + 24, 0.7f + flowMag * 0.8f);
            engine_.pulse(thalamus.start + 56, 0.5f + flowMag * 0.8f);
        }
    }

    if (state.hasMotorHint) {
        const float x = state.motorHintX;
        const float y = state.motorHintY;
        const float intensity = clampf(state.motorHintIntensity, 0.0f, 1.0f);
        if (x == 0.0f && y == 0.0f) {
            motorHintActive_ = false;
        } else {
            motorHintActive_ = true;
            motorHintX_ = x;
            motorHintY_ = y;
            motorHintIntensity_ = intensity;
            motorHintMode_ = state.motorHintMode;
        }
    } else {
        motorHintActive_ = false;
    }

    if (state.hasNeeds) {
        setNeeds(state.needs);
        const float needAverage = (needs_.hunger + needs_.energy + needs_.joy) / 3.0f;
        const float needSignal = 2.4f + (1.0f - needAverage) * 1.8f;

        engine_.pulse(hypo.start, needSignal * (1.0f + (needs_.hunger < 0.4f ? 1.2f : 0.0f)));
        engine_.pulse(hypo.start + 8, needSignal * (1.0f + (needs_.energy < 0.3f ? 0.9f : 0.0f)));
        engine_.pulse(hypo.start + 16, needSignal * (1.0f + (needs_.joy < 0.3f ? 0.7f : 0.0f)));
        engine_.pulse(thalamus.start + 24, needSignal * (1.0f + (needs_.hunger < 0.4f ? 0.8f : 0.0f)));
        engine_.pulse(thalamus.start + 32, needSignal * (1.0f + (needs_.energy < 0.3f ? 0.6f : 0.0f)));
        engine_.pulse(thalamus.start + 40, needSignal * (1.0f + (needs_.joy < 0.3f ? 0.5f : 0.0f)));

        if (needs_.hunger < 0.4f) {
            const float pain = (0.4f - needs_.hunger) * 4.0f;
            engine_.pulse(sensory.start + 32, pain * 2.2f);
            engine_.inject(sensory.start + 40, pain * 1.8f);
            amygdalaActivate(pain * 0.2f);
        }
        if (needs_.energy < 0.3f) {
            const float fatigue = (0.3f - needs_.energy) * 4.0f;
            engine_.pulse(sensory.start + 48, fatigue * 2.0f);
        }
        if (needs_.joy < 0.3f) {
            const float distress = (0.3f - needs_.joy) * 4.0f;
            engine_.pulse(sensory.start + 56, distress * 1.8f);
            punish(distress * 0.05f);
        }

        if (needs_.hunger < 0.5f && hasLastFood_) {
            const float toFoodX = lastFoodX_ - body_.x;
            const float toFoodY = lastFoodY_ - body_.y;
            const float hunger = 1.0f - needs_.hunger;
            const uint32_t qSize = motorQuadrantSize();
            engine_.inject(motor.start + (toFoodX > 0.0f ? 0u : qSize), hunger * 1.2f);
            engine_.inject(motor.start + (toFoodY > 0.0f ? qSize * 2 : qSize * 3), hunger * 1.2f);
        }
    }

    if (!state.detections.empty()) {
        const uint32_t stride = std::max<uint32_t>(64, visual.size / 256);
        const uint32_t span = visual.size > stride ? visual.size - stride : 1;

        bool hasSalient = false;
        for (const Detection& det : state.detections) {
            const std::string label = lowerAscii(det.label.empty() ? "object" : det.label);

            uint32_t hash = 5381;
            for (unsigned char c : label) {
                hash = ((hash << 5) + hash) ^ static_cast<uint32_t>(c);
            }

            const uint32_t idx = visual.start + (hash % span);
            const float w = det.w != 0.0f ? det.w : 0.2f;
            const float value = 2.4f + w * 0.8f;

            engine_.pulse(idx, value);
            engine_.pulse(idx + stride, value * 0.8f);
            engine_.inject(visual.start + static_cast<uint32_t>(std::floor(visual.size * 0.1f)) + (hash % 128), value * 0.6f);
            engine_.pulse(thalamus.start + (hash % 32), value * 0.7f);

            if (label == "self" || label == "violet-glow" ||
                label == "cyan-light" || label == "warm-glow") {
                hasSalient = true;
            }
        }

        if (hasSalient) {
            reward(0.08f);
            amygdalaActivate(0.15f);
        }
    }

    if (state.interaction.present && !state.interaction.note.empty()) {
        const std::string note = lowerAscii(state.interaction.note);
        const bool isFood = note.find("feed") != std::string::npos || note.find("food") != std::string::npos;
        const bool isPoke = note.find("poke") != std::string::npos;
        const bool isAverse = note.find("aversive") != std::string::npos;
        const bool isDanger = note.find("danger") != std::string::npos || note.find("hurt") != std::string::npos;

        if (isFood) {
            const float hungerLevel = state.interaction.hasHungerLevel
                ? state.interaction.hungerLevel
                : needs_.hunger;
            const float rawReward = 0.3f + (1.0f - hungerLevel) * 1.4f;
            needs_.hunger = std::min(1.0f, needs_.hunger + 0.28f);
            needs_.joy = std::min(1.0f, needs_.joy + 0.06f);
            reward(rawReward);

            if (state.interaction.hasX && state.interaction.hasY) {
                hasLastFood_ = true;
                lastFoodX_ = state.interaction.x;
                lastFoodY_ = state.interaction.y;
            }

            engine_.pulse(thalamus.start, 2.8f);
            engine_.pulse(assoc.start, 2.5f);
            engine_.inject(assoc.start + 8, 1.8f);
            amygdalaActivate(0.1f);
        } else if (isPoke || isAverse || isDanger) {
            amygdalaActivate(0.8f);
            punish(0.4f);
            needs_.energy = std::max(0.0f, needs_.energy - 0.05f);
            needs_.joy = std::max(0.0f, needs_.joy - 0.04f);

            engine_.pulse(sensory.start + 0, 2.5f);
            engine_.pulse(sensory.start + 8, 2.2f);
            engine_.inject(assoc.start + 0, 2.1f);
            engine_.inject(assoc.start + 8, 1.9f);

            const uint32_t qSize = motorQuadrantSize();
            const float px = state.interaction.hasX ? state.interaction.x : 0.5f;
            const float py = state.interaction.hasY ? state.interaction.y : 0.5f;
            const float awayX = body_.x < px ? -1.0f : 1.0f;
            const float awayY = body_.y < py ? -1.0f : 1.0f;
            engine_.inject(motor.start + (awayX > 0.0f ? 0u : qSize), 1.8f);
            engine_.inject(motor.start + (awayY > 0.0f ? qSize * 2 : qSize * 3), 1.8f);
        } else {
            handleInteraction(note, 1.0f);
            engine_.pulse(sensory.start, 1.9f);
            engine_.inject(assoc.start, 1.7f);
            engine_.inject(motor.start + 24, 0.6f);
        }
    }

    const uint32_t qSize = motorQuadrantSize();
    engine_.inject(motor.start + 0 * qSize, 0.18f);
    engine_.inject(motor.start + 1 * qSize, 0.18f);
    engine_.inject(motor.start + 2 * qSize, 0.18f);
    engine_.inject(motor.start + 3 * qSize, 0.18f);

    return emotionalState();
}

// ─────────────────────────────────────────────────────────────────────────────
// Affect and behaviour
// ─────────────────────────────────────────────────────────────────────────────

float BrainCore::meanOfRegion(const std::string& name, uint32_t step) const {
    const Region* r = region(name);
    if (r == nullptr || r->size == 0) return 0.0f;
    return engine_.meanAbs(r->start, r->end, std::max<uint32_t>(1, step));
}

float BrainCore::peakOfRegion(const std::string& name) const {
    const Region* r = region(name);
    if (r == nullptr || r->size == 0) return 0.0f;
    return engine_.peakAbs(r->start, r->end);
}

EmotionalState BrainCore::emotionalState() {
    tickNeeds();

    const float sensoryMean = meanOfRegion("sensory", 8);
    const float assocMean = meanOfRegion("association", 8);
    const float hippMean = meanOfRegion("hippocampus", 4);
    const float hypothMean = meanOfRegion("hypothalamus", 2);
    const float accMean = meanOfRegion("acc", 2);
    const float rapheMean = meanOfRegion("raphe", 2);

    const float needAverage = (needs_.hunger + needs_.energy + needs_.joy) / 3.0f;
    const float pressure = 1.0f - needAverage;

    const float hypothPressure = tanhf_(hypothMean * 20.0 + pressure * 0.5);
    const float rawArousal = tanhf_((sensoryMean + assocMean) * 10.0 + hypothPressure * 0.35) + 0.1f;
    const float rawDrive = tanhf_(hippMean * 15.0 + hypothPressure * 0.6);

    const float serotoninStability = tanhf_(rapheMean * 30.0);
    const float rawValence = tanhf_(
        engine_.dopamine + 0.2 - pressure * 0.7 * (1.0 - serotoninStability * 0.3));
    const float conflictPenalty = tanhf_(accMean * 25.0) * 0.15f;

    valence_ = valence_ * 0.7f + (rawValence - conflictPenalty) * 0.3f;
    arousal_ = arousal_ * 0.6f + rawArousal * 0.4f;
    drive_ = drive_ * 0.8f + rawDrive * 0.2f;

    EmotionalState out;
    out.valence = valence_;
    out.arousal = arousal_;
    out.drive = drive_;
    out.norepinephrine = tanhf_(engine_.norepinephrine);
    out.needs = needs_;
    out.body = body_;
    return out;
}

BehaviorState BrainCore::behaviorState() {
    const EmotionalState emotional = emotionalState();

    const float hypoMean = meanOfRegion("hypothalamus", 2);
    const float accMean = meanOfRegion("acc", 2);
    const float bgMean = meanOfRegion("basalGanglia", 4);
    const float vtaMean = meanOfRegion("vta", 2);
    const float rapheMean = meanOfRegion("raphe", 2);
    const float pfcMean = meanOfRegion("prefrontal", 8);
    const float assocMean = meanOfRegion("association", 8);

    const float needAverage = (needs_.hunger + needs_.energy + needs_.joy) / 3.0f;
    const float pressure = 1.0f - needAverage;

    BehaviorState out;
    out.valence = emotional.valence;
    out.arousal = emotional.arousal;
    out.drive = emotional.drive;
    out.curiosity = clampf(tanhf_(
        hypoMean * 24.0 + pressure * 0.4 + assocMean * 2.0 +
        (1.0f - std::fabs(emotional.valence)) * 0.2), 0.0f, 1.0f);
    out.uncertainty = clampf(tanhf_(
        accMean * 22.0 + emotional.arousal * 0.5 +
        (1.0f - std::fabs(emotional.valence)) * 0.25), 0.0f, 1.0f);
    out.actionReadiness = clampf(tanhf_(
        bgMean * 24.0 + vtaMean * 16.0 + emotional.drive * 0.8 + pfcMean * 1.4), 0.0f, 1.0f);
    out.patience = clampf(
        0.45f + tanhf_(rapheMean * 24.0) * 0.45 + (1.0f - emotional.arousal) * 0.1f,
        0.0f, 1.0f);
    out.speechReadiness = clampf(
        0.1f + emotional.drive * 0.2f + emotional.valence * 0.12f +
        out.actionReadiness * 0.16f - out.uncertainty * 0.18f -
        emotional.arousal * 0.15f + pfcMean * 0.04f,
        0.0f, 1.0f);
    out.researchDrive = clampf(
        out.curiosity * 0.45f + out.uncertainty * 0.35f + pressure * 0.2f + emotional.drive * 0.2f,
        0.0f, 1.0f);
    return out;
}

Decision BrainCore::decideBehavior(bool hasActiveGoal,
                                   float activeGoalUrgency,
                                   bool humanPresent,
                                   uint64_t tickCount,
                                   uint64_t lastSpokeTick,
                                   bool pendingSelfSpeech) {
    const BehaviorState state = behaviorState();
    const bool hasUrgentGoal = hasActiveGoal && activeGoalUrgency > 0.55f;

    const bool shouldResearch = hasActiveGoal && (
        hasUrgentGoal ||
        state.uncertainty > 0.28f ||
        state.researchDrive > 0.34f ||
        humanPresent);

    const uint64_t gap = tickCount > lastSpokeTick ? tickCount - lastSpokeTick : 0;

    const bool canSpeak =
        pendingSelfSpeech &&
        humanPresent &&
        gap >= 60 &&
        state.speechReadiness > 0.22f &&
        state.drive > 0.1f &&
        state.arousal < 0.85f &&
        (hasUrgentGoal || state.valence > -0.05f);

    Decision out;
    out.state = state;
    out.canSpeak = canSpeak;
    out.shouldResearch = shouldResearch;
    out.shouldAct = hasActiveGoal && state.actionReadiness > 0.3f;
    out.responseMode = shouldResearch ? "grounded" : (canSpeak ? "speak" : "quiet");
    return out;
}

void BrainCore::actionSelection() {
    const Region& bg = regionRef("basalGanglia");
    const Region& acc = regionRef("acc");
    const Region& motor = regionRef("motor");

    const float bgMean = engine_.meanAbs(bg.start, bg.end, 4);
    if (bgMean < 0.001f) return;

    const float inhibStrength = tanhf_(bgMean * 40.0) * 0.25f;
    const uint32_t step = std::max<uint32_t>(4, motor.size / 500);
    for (uint32_t i = motor.start; i < motor.end; i += step) {
        engine_.potential[i] *= (1.0f - inhibStrength);
    }

    const float bgPeak = engine_.peakAbs(bg.start, bg.end);
    const float conflict = std::max(0.0f, bgPeak - bgMean * 2.0f);
    if (conflict > 0.01f) {
        engine_.pulse(acc.start, conflict * 1.5f);
        engine_.pulse(acc.start + 8, conflict * 1.2f);
    }

    const Region& vta = regionRef("vta");
    if (bgPeak > 0.05f) {
        engine_.pulse(vta.start, bgPeak * 1.2f);
    }
}

float BrainCore::novelty() {
    const Region& assoc = regionRef("association");
    if (assoc.size == 0) return 0.0f;

    const uint32_t step = std::max<uint32_t>(4, assoc.size / 2000);
    float diff = 0.0f;
    uint64_t count = 0;

    for (uint32_t i = assoc.start; i < assoc.end; i += step) {
        const uint32_t idx = i - assoc.start;
        if (idx >= baseline_.size()) break;
        const float v = engine_.potential[i];
        const float d = v - baseline_[idx];
        diff += std::fabs(d);
        baseline_[idx] = baseline_[idx] * (1.0f - baselineAlpha_) + v * baselineAlpha_;
        ++count;
    }

    if (count == 0) return 0.0f;
    return tanhf_(static_cast<double>(diff) / static_cast<double>(count));
}

Reafference BrainCore::reafference(uint32_t topN) {
    Reafference out;
    const Region& assoc = regionRef("association");
    if (assoc.size == 0) return out;
    if (topN == 0) topN = 1;

    const uint32_t step = std::max<uint32_t>(1, assoc.size / 10000);
    std::vector<int32_t> topIdx(topN, -1);
    std::vector<float> topVal(topN, 0.0f);

    float minVal = 0.0f;
    uint32_t minPos = 0;
    uint32_t filled = 0;

    for (uint32_t i = assoc.start; i < assoc.end; i += step) {
        const uint32_t idx = i - assoc.start;
        if (idx >= reafBaseline_.size()) break;

        const float raw = engine_.potential[i];
        const float dev = raw - reafBaseline_[idx];
        const float v = std::fabs(dev);

        reafBaseline_[idx] = reafBaseline_[idx] * (1.0f - reafBaselineAlpha_) + raw * reafBaselineAlpha_;

        if (v == 0.0f) continue;

        if (filled < topN) {
            topIdx[filled] = static_cast<int32_t>(idx);
            topVal[filled] = v;
            ++filled;
            if (filled == topN) {
                minVal = topVal[0];
                minPos = 0;
                for (uint32_t k = 1; k < topN; ++k) {
                    if (topVal[k] < minVal) {
                        minVal = topVal[k];
                        minPos = k;
                    }
                }
            }
        } else if (v > minVal) {
            topIdx[minPos] = static_cast<int32_t>(idx);
            topVal[minPos] = v;
            minVal = topVal[0];
            minPos = 0;
            for (uint32_t k = 1; k < topN; ++k) {
                if (topVal[k] < minVal) {
                    minVal = topVal[k];
                    minPos = k;
                }
            }
        }
    }

    float sum = 0.0f;
    out.indices.reserve(filled);
    for (uint32_t k = 0; k < filled; ++k) {
        sum += topVal[k];
        out.indices.push_back(topIdx[k]);
    }
    out.strength = tanhf_((filled > 0 ? static_cast<double>(sum) / static_cast<double>(filled) : 0.0) * 5.0);
    return out;
}

float BrainCore::selfAwareness() {
    const Region& assoc = regionRef("association");
    const Region& pfc = regionRef("prefrontal");
    const Region& motor = regionRef("motor");
    const Region& visual = regionRef("visual");

    const float needAverage = (needs_.hunger + needs_.energy + needs_.joy) / 3.0f;
    const float needsPressure = 1.0f - needAverage;
    const float assocPeak = engine_.peakAbs(assoc.start, assoc.end);

    const uint32_t pfcSize = pfc.end - pfc.start;
    const float sizeCompensation = std::max(
        1.0f,
        static_cast<float>(std::sqrt(300000.0 / static_cast<double>(std::max<uint32_t>(1, pfcSize)))));
    const float tonicSignal = (0.30f + needsPressure * 0.25f + assocPeak * 1.5f) * sizeCompensation;

    const uint32_t seedCount = std::max<uint32_t>(
        8, std::min<uint32_t>(64, static_cast<uint32_t>(std::floor(pfcSize / 500.0))));
    const uint32_t seedStep = std::max<uint32_t>(1, pfcSize / seedCount);
    for (uint32_t i = 0; i < seedCount; ++i) {
        engine_.pulse(pfc.start + i * seedStep, tonicSignal);
    }

    const uint32_t pfcStep = std::max<uint32_t>(1, pfcSize / 2000);
    const float pfcGain = 8.0f * sizeCompensation;
    const float pfcLevel = tanhf_(
        static_cast<double>(engine_.meanAbs(pfc.start, pfc.end, pfcStep)) * pfcGain);

    if (pfcLevel > 0.05f) {
        const float mul = 1.0f - pfcLevel * 0.12f;
        for (uint32_t i = regionRef("sensory").start; i < regionRef("sensory").end; i += 20) {
            engine_.potential[i] *= mul;
        }
        for (uint32_t i = assoc.start; i < assoc.end; i += 20) {
            engine_.potential[i] *= mul;
        }

        if (motorHintActive_) {
            const float visualMean = meanOfRegion("visual", 8);
            const float motorSignal = pfcLevel * (0.3f + visualMean * 1.0f + needsPressure * 0.4f);
            const uint32_t qSize = motorQuadrantSize();
            const float dx = motorHintX_;
            const float dy = motorHintY_;
            const float mag = std::sqrt(dx * dx + dy * dy);

            if (mag > 0.01f) {
                const float normX = dx / mag;
                const float normY = dy / mag;
                const uint32_t xQuadrant = normX >= 0.0f ? 0u : qSize;
                const uint32_t yQuadrant = normY >= 0.0f ? qSize * 2 : qSize * 3;
                const float xWeight = std::min(1.0f, std::fabs(normX));
                const float yWeight = std::min(1.0f, std::fabs(normY));
                const float strength = motorSignal * motorHintIntensity_;

                if (xWeight > 0.0f) engine_.inject(motor.start + xQuadrant, strength * xWeight);
                if (yWeight > 0.0f) engine_.inject(motor.start + yQuadrant, strength * yWeight);
                engine_.inject(assoc.start + 40, 0.4f + motorHintIntensity_ * 0.4f);
                engine_.pulse(pfc.start + 4, 0.5f + motorHintIntensity_ * 0.6f);
            }
        }
    }

    actionSelection();
    return pfcLevel;
}

MotorIntent BrainCore::getMotorIntent() const {
    const Region& motor = regionRef("motor");
    const uint32_t qSize = motorQuadrantSize();
    const uint32_t sampleStep = std::max<uint32_t>(8, qSize / 32);

    const float right = engine_.meanAbs(motor.start, motor.start + qSize, sampleStep);
    const float left = engine_.meanAbs(motor.start + qSize, motor.start + qSize * 2, sampleStep);
    const float down = engine_.meanAbs(motor.start + qSize * 2, motor.start + qSize * 3, sampleStep);
    const float up = engine_.meanAbs(motor.start + qSize * 3, motor.end, sampleStep);

    float dx = right - left;
    float dy = down - up;
    const float mag = std::sqrt(dx * dx + dy * dy);
    const float strength = tanhf_(static_cast<double>(mag) * 6.0);

    MotorIntent out;
    if (mag > 0.0f) {
        out.dx = dx / mag;
        out.dy = dy / mag;
    }
    out.strength = strength;
    return out;
}

std::vector<std::pair<std::string, float>> BrainCore::readInternalState() const {
    const Region& association = regionRef("association");
    const Region& prefrontal = regionRef("prefrontal");
    const Region& hippocampus = regionRef("hippocampus");
    const Region& sensory = regionRef("sensory");
    const Region& motor = regionRef("motor");
    const Region& acc = regionRef("acc");
    const Region& basalGanglia = regionRef("basalGanglia");
    const Region& hypothalamus = regionRef("hypothalamus");

    const uint32_t pfcStep = std::max<uint32_t>(1, (prefrontal.end - prefrontal.start) / 500);
    const uint32_t assocStep = std::max<uint32_t>(1, (association.end - association.start) / 500);
    const uint32_t hippStep = std::max<uint32_t>(1, (hippocampus.end - hippocampus.start) / 500);
    const uint32_t sensStep = std::max<uint32_t>(1, (sensory.end - sensory.start) / 500);
    const uint32_t motorStep = std::max<uint32_t>(1, (motor.end - motor.start) / 500);
    const uint32_t accStep = std::max<uint32_t>(1, (acc.end - acc.start) / 500);
    const uint32_t bgStep = std::max<uint32_t>(1, (basalGanglia.end - basalGanglia.start) / 500);
    const uint32_t hypoStep = std::max<uint32_t>(1, (hypothalamus.end - hypothalamus.start) / 500);

    std::vector<std::pair<std::string, float>> out;
    out.emplace_back("\xCE\xA9" "1", engine_.meanAbs(association.start, association.end, assocStep));
    out.emplace_back("\xCE\xA9" "2", engine_.meanAbs(prefrontal.start, prefrontal.end, pfcStep));
    out.emplace_back("\xCE\xA9" "3", engine_.meanAbs(hippocampus.start, hippocampus.end, hippStep));
    out.emplace_back("\xCE\xA9" "4", engine_.meanAbs(sensory.start, sensory.end, sensStep));
    out.emplace_back("\xCE\xA9" "5", engine_.meanAbs(motor.start, motor.end, motorStep));
    out.emplace_back("\xCE\xA9_acc", engine_.meanAbs(acc.start, acc.end, accStep));
    out.emplace_back("\xCE\xA9_bg", engine_.meanAbs(basalGanglia.start, basalGanglia.end, bgStep));
    out.emplace_back("\xCE\xA9_hypo", engine_.meanAbs(hypothalamus.start, hypothalamus.end, hypoStep));
    out.emplace_back("\xCE\xA9_da", static_cast<float>(engine_.dopamine));
    out.emplace_back("\xCE\xA9_ne", static_cast<float>(engine_.norepinephrine));
    return out;
}

std::unordered_map<std::string, RegionStat> BrainCore::neuronMap() const {
    std::unordered_map<std::string, RegionStat> out;
    const std::vector<float>& pot = engine_.potential;

    for (const Region& r : regions_) {
        const uint32_t regionSize = r.end - r.start;
        if (regionSize == 0) {
            out[r.name] = RegionStat{};
            continue;
        }
        const uint32_t step = std::max<uint32_t>(1, regionSize / SAMPLES_PER_REGION);
        double sum = 0.0;
        float peak = 0.0f;
        uint64_t firingCount = 0;
        uint64_t count = 0;

        for (uint32_t i = r.start; i < r.end; i += step) {
            const float v = std::fabs(pot[i]);
            sum += static_cast<double>(v);
            if (v > peak) peak = v;
            if (v >= r.threshold) ++firingCount;
            ++count;
        }

        const float mean = count > 0 ? static_cast<float>(sum / static_cast<double>(count)) : 0.0f;
        RegionStat stat;
        stat.mean = tanhf_(static_cast<double>(mean) / static_cast<double>(r.threshold) * 3.0);
        stat.peak = tanhf_(static_cast<double>(peak) / static_cast<double>(r.threshold) * 2.0);
        stat.firing = count > 0 ? static_cast<float>(firingCount) / static_cast<float>(count) : 0.0f;
        out[r.name] = stat;
    }
    return out;
}

std::vector<float> BrainCore::thought() const {
    const Region& assoc = regionRef("association");
    return std::vector<float>(
        engine_.potential.begin() + assoc.start,
        engine_.potential.begin() + assoc.end);
}

uint32_t BrainCore::motorQuadrantSize() const {
    return regionRef("motor").size / 4;
}

// ─────────────────────────────────────────────────────────────────────────────
// Sensory input
// ─────────────────────────────────────────────────────────────────────────────

void BrainCore::perceive(const std::vector<uint32_t>& indices) {
    const Region& sensory = regionRef("sensory");
    if (sensory.size == 0) return;
    for (uint32_t idx : indices) {
        engine_.inject(sensory.start + (idx % sensory.size), 1.2f);
    }
}

void BrainCore::perceiveDense(const std::vector<float>& values) {
    const Region& sensory = regionRef("sensory");
    const size_t len = std::min(values.size(), static_cast<size_t>(sensory.size));
    for (size_t i = 0; i < len; ++i) {
        if (values[i] > 0.0f) engine_.inject(sensory.start + static_cast<uint32_t>(i), values[i]);
    }
}

void BrainCore::perceiveVisual(const std::vector<uint32_t>& indices) {
    const Region& visual = regionRef("visual");
    if (visual.size == 0) return;
    for (uint32_t idx : indices) {
        engine_.pulse(visual.start + (idx % visual.size), 2.0f);
    }
}

void BrainCore::hear(const std::vector<uint32_t>& indices) {
    const Region& thalamus = regionRef("thalamus");
    const Region& sensory = regionRef("sensory");
    const Region& amygdala = regionRef("amygdala");
    if (thalamus.size == 0 || sensory.size == 0) return;

    for (uint32_t idx : indices) {
        engine_.pulse(thalamus.start + (idx % thalamus.size), 2.2f);
    }
    for (uint32_t idx : indices) {
        engine_.pulse(sensory.start + (idx % sensory.size), 1.8f);
    }
    engine_.pulse(amygdala.start, 0.6f);
    engine_.pulse(amygdala.start + 8, 0.4f);
}

void BrainCore::hearDense(const std::vector<float>& values) {
    const Region& thalamus = regionRef("thalamus");
    const Region& sensory = regionRef("sensory");
    const Region& amygdala = regionRef("amygdala");
    if (thalamus.size == 0 || sensory.size == 0) return;

    for (size_t i = 0; i < values.size(); ++i) {
        const float v = values[i];
        if (v <= 0.0f) continue;
        engine_.pulse(thalamus.start + static_cast<uint32_t>(i % thalamus.size), 2.2f * v);
        engine_.pulse(sensory.start + static_cast<uint32_t>(i % sensory.size), 1.8f * v);
    }
    engine_.pulse(amygdala.start, 0.6f);
    engine_.pulse(amygdala.start + 8, 0.4f);
}

void BrainCore::encode(const std::vector<uint32_t>& indices, float strength) {
    const Region& hippocampus = regionRef("hippocampus");
    if (hippocampus.size == 0) return;
    for (uint32_t idx : indices) {
        engine_.receive(hippocampus.start + (idx % hippocampus.size), strength);
    }
}

void BrainCore::encodeDense(const std::vector<float>& values, float strength) {
    const Region& hippocampus = regionRef("hippocampus");
    const size_t len = std::min(values.size(), static_cast<size_t>(hippocampus.size));
    for (size_t i = 0; i < len; ++i) {
        if (values[i] > 0.0f) {
            engine_.receive(hippocampus.start + static_cast<uint32_t>(i), values[i] * strength);
        }
    }
}

void BrainCore::consolidate(const std::vector<uint32_t>& indices, float strength) {
    const Region& temporal = regionRef("temporal");
    if (temporal.size == 0) return;
    for (uint32_t idx : indices) {
        engine_.receive(temporal.start + (idx % temporal.size), strength);
    }
}

void BrainCore::consolidateDense(const std::vector<float>& values, float strength) {
    const Region& temporal = regionRef("temporal");
    const size_t len = std::min(values.size(), static_cast<size_t>(temporal.size));
    for (size_t i = 0; i < len; ++i) {
        if (values[i] > 0.0f) {
            engine_.receive(temporal.start + static_cast<uint32_t>(i), values[i] * strength);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pattern hashing
// ─────────────────────────────────────────────────────────────────────────────

std::vector<uint32_t> soundPattern(const std::string& text, uint32_t size, uint32_t length) {
    uint32_t h = 5381;
    for (unsigned char c : text) {
        h = (h * 31u) ^ static_cast<uint32_t>(c);
    }

    if (length == 0) length = 200;
    std::vector<uint32_t> out(length);
    for (uint32_t j = 0; j < length; ++j) {
        const uint32_t mixed = (h ^ j) * 2654435761u;
        out[j] = size == 0 ? 0 : (mixed % size);
    }
    return out;
}

}  // namespace neuropile
