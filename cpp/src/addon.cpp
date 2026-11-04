// addon.cpp - Node-API bindings for the native Neuropile brain.
//
// The native layer deliberately mirrors the JavaScript API in core/engine.js
// and core/brain.js. Every method here has a JS counterpart with the same
// name and semantics, so the same application code can run on either engine.

#include <napi.h>

#include <cmath>
#include <cstring>
#include <limits>
#include <string>
#include <vector>

#include "neuropile_core.hpp"

namespace {

using neuropile::BehaviorState;
using neuropile::Body;
using neuropile::BrainCore;
using neuropile::BrainOptions;
using neuropile::Decision;
using neuropile::Detection;
using neuropile::EmotionalState;
using neuropile::Interaction;
using neuropile::MotorIntent;
using neuropile::MotorState;
using neuropile::Needs;
using neuropile::NeuralEngine;
using neuropile::Region;
using neuropile::RegionStat;
using neuropile::WorldState;

// ── Small parsing helpers ────────────────────────────────────────────────────

bool IsMissing(const Napi::Value& v) { return v.IsUndefined() || v.IsNull(); }

bool ReadNumber(const Napi::Value& value, double fallback, double& out) {
    if (IsMissing(value)) {
        out = fallback;
        return true;
    }
    if (!value.IsNumber()) return false;
    out = value.As<Napi::Number>().DoubleValue();
    return true;
}

bool ReadFloat(const Napi::Value& value, float fallback, float& out) {
    double d = fallback;
    if (!ReadNumber(value, fallback, d)) return false;
    out = static_cast<float>(d);
    return true;
}

bool ReadUint32(const Napi::Value& value, uint32_t fallback, uint32_t& out) {
    double d = fallback;
    if (!ReadNumber(value, fallback, d)) return false;
    if (d < 0.0) d = 0.0;
    if (d > static_cast<double>(std::numeric_limits<uint32_t>::max())) {
        d = static_cast<double>(std::numeric_limits<uint32_t>::max());
    }
    out = static_cast<uint32_t>(d);
    return true;
}

bool ReadBool(const Napi::Value& value, bool fallback, bool& out) {
    if (IsMissing(value)) {
        out = fallback;
        return true;
    }
    if (!value.IsBoolean()) return false;
    out = value.As<Napi::Boolean>().Value();
    return true;
}

bool GetObjectProperty(Napi::Object obj, const char* name, Napi::Value& out) {
    if (!obj.Has(name)) return false;
    out = obj.Get(name);
    return !IsMissing(out);
}

Napi::Value TypeFailure(Napi::Env env, const char* message) {
    Napi::TypeError::New(env, message).ThrowAsJavaScriptException();
    return env.Undefined();
}

bool ThrowType(Napi::Env env, const char* message) {
    Napi::TypeError::New(env, message).ThrowAsJavaScriptException();
    return false;
}

// ── Array / typed-array parsing ──────────────────────────────────────────────

bool ReadNumericArray(Napi::Env env, const Napi::Value& value, std::vector<double>& out) {
    out.clear();
    if (value.IsTypedArray()) {
        napi_typedarray_type type;
        size_t length = 0;
        void* data = nullptr;
        napi_value buffer = nullptr;
        size_t offset = 0;
        if (napi_get_typedarray_info(env, value, &type, &length, &data, &buffer, &offset) != napi_ok) {
            return ThrowType(env, "could not read typed array");
        }
        out.resize(length);
        for (size_t i = 0; i < length; ++i) {
            switch (type) {
                case napi_int8_array:
                    out[i] = static_cast<double>(static_cast<int8_t*>(data)[i]);
                    break;
                case napi_uint8_array:
                case napi_uint8_clamped_array:
                    out[i] = static_cast<double>(static_cast<uint8_t*>(data)[i]);
                    break;
                case napi_int16_array:
                    out[i] = static_cast<double>(static_cast<int16_t*>(data)[i]);
                    break;
                case napi_uint16_array:
                    out[i] = static_cast<double>(static_cast<uint16_t*>(data)[i]);
                    break;
                case napi_int32_array:
                    out[i] = static_cast<double>(static_cast<int32_t*>(data)[i]);
                    break;
                case napi_uint32_array:
                    out[i] = static_cast<double>(static_cast<uint32_t*>(data)[i]);
                    break;
                case napi_float32_array:
                    out[i] = static_cast<double>(static_cast<float*>(data)[i]);
                    break;
                case napi_float64_array:
                    out[i] = static_cast<double*>(data)[i];
                    break;
                case napi_bigint64_array:
                    out[i] = static_cast<double>(static_cast<int64_t*>(data)[i]);
                    break;
                case napi_biguint64_array:
                    out[i] = static_cast<double>(static_cast<uint64_t*>(data)[i]);
                    break;
                default:
                    return ThrowType(env, "unsupported typed array element type");
            }
        }
        return true;
    }

    if (value.IsArray()) {
        Napi::Array array = value.As<Napi::Array>();
        const uint32_t length = array.Length();
        out.resize(length);
        for (uint32_t i = 0; i < length; ++i) {
            Napi::Value item = array.Get(i);
            if (!item.IsNumber()) {
                return ThrowType(env, "array elements must be numbers");
            }
            out[i] = item.As<Napi::Number>().DoubleValue();
        }
        return true;
    }

    return ThrowType(env, "expected an array or typed array");
}

bool ReadFloatArray(Napi::Env env, const Napi::Value& value, std::vector<float>& out) {
    std::vector<double> raw;
    if (!ReadNumericArray(env, value, raw)) return false;
    out.resize(raw.size());
    for (size_t i = 0; i < raw.size(); ++i) out[i] = static_cast<float>(raw[i]);
    return true;
}

bool ReadUint32Array(Napi::Env env, const Napi::Value& value, std::vector<uint32_t>& out) {
    std::vector<double> raw;
    if (!ReadNumericArray(env, value, raw)) return false;
    out.resize(raw.size());
    for (size_t i = 0; i < raw.size(); ++i) {
        double v = raw[i];
        if (v < 0.0) v = 0.0;
        if (v > static_cast<double>(std::numeric_limits<uint32_t>::max())) {
            v = static_cast<double>(std::numeric_limits<uint32_t>::max());
        }
        out[i] = static_cast<uint32_t>(v);
    }
    return true;
}

// Mirrors core/brain.js: a Uint32Array/Int32Array is treated as a list of
// indices, everything else is treated as a dense activation vector.
bool ReadIndicesOrDense(Napi::Env env,
                        const Napi::Value& value,
                        std::vector<uint32_t>& indices,
                        std::vector<float>& dense,
                        bool& isDense) {
    indices.clear();
    dense.clear();
    isDense = true;

    if (value.IsTypedArray()) {
        napi_typedarray_type type;
        size_t length = 0;
        void* data = nullptr;
        napi_value buffer = nullptr;
        size_t offset = 0;
        if (napi_get_typedarray_info(env, value, &type, &length, &data, &buffer, &offset) != napi_ok) {
            return ThrowType(env, "could not read typed array");
        }
        if (type == napi_uint32_array || type == napi_int32_array) {
            isDense = false;
            indices.resize(length);
            for (size_t i = 0; i < length; ++i) {
                const double raw = (type == napi_uint32_array)
                    ? static_cast<double>(static_cast<uint32_t*>(data)[i])
                    : static_cast<double>(static_cast<int32_t*>(data)[i]);
                indices[i] = raw <= 0.0 ? 0u : static_cast<uint32_t>(raw);
            }
            return true;
        }
    }

    return ReadFloatArray(env, value, dense);
}

// ── Snapshot helpers ─────────────────────────────────────────────────────────

Napi::Float32Array CopyFloat32(Napi::Env env, const std::vector<float>& values) {
    Napi::Float32Array out = Napi::Float32Array::New(env, values.size());
    if (!values.empty()) std::memcpy(out.Data(), values.data(), values.size() * sizeof(float));
    return out;
}

Napi::Float64Array CopyFloat64(Napi::Env env, const std::vector<double>& values) {
    Napi::Float64Array out = Napi::Float64Array::New(env, values.size());
    if (!values.empty()) std::memcpy(out.Data(), values.data(), values.size() * sizeof(double));
    return out;
}

Napi::Uint32Array CopyUint32(Napi::Env env, const std::vector<uint32_t>& values) {
    Napi::Uint32Array out = Napi::Uint32Array::New(env, values.size());
    if (!values.empty()) std::memcpy(out.Data(), values.data(), values.size() * sizeof(uint32_t));
    return out;
}

Napi::Uint8Array CopyUint8(Napi::Env env, const std::vector<uint8_t>& values) {
    Napi::Uint8Array out = Napi::Uint8Array::New(env, values.size());
    if (!values.empty()) std::memcpy(out.Data(), values.data(), values.size());
    return out;
}

bool RestoreFloat32(Napi::Env env,
                    const Napi::Value& value,
                    std::vector<float>& target,
                    const char* name) {
    std::vector<float> parsed;
    if (!ReadFloatArray(env, value, parsed)) return false;
    if (parsed.size() != target.size()) {
        Napi::RangeError::New(env, std::string(name) + " has the wrong length").ThrowAsJavaScriptException();
        return false;
    }
    target = std::move(parsed);
    return true;
}

bool RestoreFloat64(Napi::Env env,
                    const Napi::Value& value,
                    std::vector<double>& target,
                    const char* name) {
    std::vector<double> parsed;
    if (!ReadNumericArray(env, value, parsed)) return false;
    if (parsed.size() != target.size()) {
        Napi::RangeError::New(env, std::string(name) + " has the wrong length").ThrowAsJavaScriptException();
        return false;
    }
    target = std::move(parsed);
    return true;
}

bool RestoreUint32(Napi::Env env,
                   const Napi::Value& value,
                   std::vector<uint32_t>& target,
                   const char* name) {
    std::vector<uint32_t> parsed;
    if (!ReadUint32Array(env, value, parsed)) return false;
    if (parsed.size() != target.size()) {
        Napi::RangeError::New(env, std::string(name) + " has the wrong length").ThrowAsJavaScriptException();
        return false;
    }
    target = std::move(parsed);
    return true;
}

bool RestoreUint8(Napi::Env env,
                  const Napi::Value& value,
                  std::vector<uint8_t>& target,
                  const char* name) {
    std::vector<uint32_t> parsed;
    if (!ReadUint32Array(env, value, parsed)) return false;
    if (parsed.size() != target.size()) {
        Napi::RangeError::New(env, std::string(name) + " has the wrong length").ThrowAsJavaScriptException();
        return false;
    }
    for (size_t i = 0; i < parsed.size(); ++i) target[i] = parsed[i] ? 1 : 0;
    return true;
}

// ── Result object helpers ────────────────────────────────────────────────────

Napi::Object NeedsObject(Napi::Env env, const Needs& needs) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("hunger", Napi::Number::New(env, needs.hunger));
    out.Set("energy", Napi::Number::New(env, needs.energy));
    out.Set("joy", Napi::Number::New(env, needs.joy));
    return out;
}

Napi::Object BodyObject(Napi::Env env, const Body& body) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("x", Napi::Number::New(env, body.x));
    out.Set("y", Napi::Number::New(env, body.y));
    out.Set("heading", Napi::Number::New(env, body.heading));
    out.Set("speed", Napi::Number::New(env, body.speed));
    out.Set("energy", Napi::Number::New(env, body.energy));
    return out;
}

Napi::Object MotorStateObject(Napi::Env env, const MotorState& state) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("moveX", Napi::Number::New(env, state.moveX));
    out.Set("moveY", Napi::Number::New(env, state.moveY));
    if (state.lastAction.empty()) {
        out.Set("lastAction", env.Null());
    } else {
        out.Set("lastAction", Napi::String::New(env, state.lastAction));
    }
    return out;
}

Napi::Object EmotionalObject(Napi::Env env, const EmotionalState& state) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("valence", Napi::Number::New(env, state.valence));
    out.Set("arousal", Napi::Number::New(env, state.arousal));
    out.Set("drive", Napi::Number::New(env, state.drive));
    out.Set("norepinephrine", Napi::Number::New(env, state.norepinephrine));
    out.Set("needs", NeedsObject(env, state.needs));
    out.Set("body", BodyObject(env, state.body));
    return out;
}

Napi::Object BehaviorObject(Napi::Env env, const BehaviorState& state) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("valence", Napi::Number::New(env, state.valence));
    out.Set("arousal", Napi::Number::New(env, state.arousal));
    out.Set("drive", Napi::Number::New(env, state.drive));
    out.Set("curiosity", Napi::Number::New(env, state.curiosity));
    out.Set("uncertainty", Napi::Number::New(env, state.uncertainty));
    out.Set("actionReadiness", Napi::Number::New(env, state.actionReadiness));
    out.Set("patience", Napi::Number::New(env, state.patience));
    out.Set("speechReadiness", Napi::Number::New(env, state.speechReadiness));
    out.Set("researchDrive", Napi::Number::New(env, state.researchDrive));
    return out;
}

Napi::Object RegionObject(Napi::Env env, const Region& region) {
    Napi::Object out = Napi::Object::New(env);
    out.Set("name", Napi::String::New(env, region.name));
    out.Set("start", Napi::Number::New(env, region.start));
    out.Set("end", Napi::Number::New(env, region.end));
    out.Set("size", Napi::Number::New(env, region.size));
    out.Set("threshold", Napi::Number::New(env, region.threshold));
    out.Set("inhibRatio", Napi::Number::New(env, region.inhibRatio));
    out.Set("baseSize", Napi::Number::New(env, region.baseSize));
    return out;
}

// ── World state parsing ──────────────────────────────────────────────────────

WorldState ParseWorldState(Napi::Env env, const Napi::Value& value) {
    WorldState state;
    if (!value.IsObject()) return state;

    Napi::Object object = value.As<Napi::Object>();
    Napi::Value item;

    if (GetObjectProperty(object, "body", item) && item.IsObject()) {
        Napi::Object body = item.As<Napi::Object>();
        state.hasBody = true;
        ReadFloat(body.Get("x"), state.body.x, state.body.x);
        ReadFloat(body.Get("y"), state.body.y, state.body.y);
        ReadFloat(body.Get("heading"), state.body.heading, state.body.heading);
        ReadFloat(body.Get("speed"), state.body.speed, state.body.speed);
        ReadFloat(body.Get("energy"), state.body.energy, state.body.energy);
        ReadFloat(body.Get("vx"), 0.0f, state.vx);
        ReadFloat(body.Get("vy"), 0.0f, state.vy);
    }
    if (GetObjectProperty(object, "vx", item)) ReadFloat(item, state.vx, state.vx);
    if (GetObjectProperty(object, "vy", item)) ReadFloat(item, state.vy, state.vy);

    if (GetObjectProperty(object, "opticFlow", item) && item.IsObject()) {
        Napi::Object flow = item.As<Napi::Object>();
        state.hasOpticFlow = true;
        ReadFloat(flow.Get("x"), 0.0f, state.flowX);
        ReadFloat(flow.Get("y"), 0.0f, state.flowY);
        ReadFloat(flow.Get("magnitude"), 0.0f, state.flowMagnitude);
    }

    if (GetObjectProperty(object, "motorHint", item) && item.IsObject()) {
        Napi::Object hint = item.As<Napi::Object>();
        state.hasMotorHint = true;
        ReadFloat(hint.Get("x"), 0.0f, state.motorHintX);
        ReadFloat(hint.Get("y"), 0.0f, state.motorHintY);
        ReadFloat(hint.Get("intensity"), 1.0f, state.motorHintIntensity);
        Napi::Value mode = hint.Get("hintMode");
        if (mode.IsString()) state.motorHintMode = mode.As<Napi::String>().Utf8Value();
    }

    if (GetObjectProperty(object, "needs", item) && item.IsObject()) {
        Napi::Object needs = item.As<Napi::Object>();
        state.hasNeeds = true;
        ReadFloat(needs.Get("hunger"), state.needs.hunger, state.needs.hunger);
        ReadFloat(needs.Get("energy"), state.needs.energy, state.needs.energy);
        ReadFloat(needs.Get("joy"), state.needs.joy, state.needs.joy);
    }

    if (GetObjectProperty(object, "detections", item) && item.IsArray()) {
        Napi::Array detections = item.As<Napi::Array>();
        const uint32_t length = detections.Length();
        state.detections.reserve(length);
        for (uint32_t i = 0; i < length; ++i) {
            Napi::Value entry = detections.Get(i);
            if (!entry.IsObject()) continue;
            Napi::Object det = entry.As<Napi::Object>();
            Detection detection;
            Napi::Value label = det.Get("label");
            if (label.IsString()) detection.label = label.As<Napi::String>().Utf8Value();
            ReadFloat(det.Get("x"), detection.x, detection.x);
            ReadFloat(det.Get("y"), detection.y, detection.y);
            ReadFloat(det.Get("w"), detection.w, detection.w);
            ReadFloat(det.Get("h"), detection.h, detection.h);
            state.detections.push_back(std::move(detection));
        }
    }

    if (GetObjectProperty(object, "interaction", item) && item.IsObject()) {
        Napi::Object interaction = item.As<Napi::Object>();
        Napi::Value note = interaction.Get("note");
        if (note.IsString()) {
            state.interaction.present = true;
            state.interaction.note = note.As<Napi::String>().Utf8Value();
        }
        Napi::Value x = interaction.Get("x");
        Napi::Value y = interaction.Get("y");
        if (!IsMissing(x)) {
            state.interaction.hasX = true;
            ReadFloat(x, 0.5f, state.interaction.x);
        }
        if (!IsMissing(y)) {
            state.interaction.hasY = true;
            ReadFloat(y, 0.5f, state.interaction.y);
        }
        Napi::Value hunger = interaction.Get("hungerLevel");
        if (!IsMissing(hunger)) {
            state.interaction.hasHungerLevel = true;
            ReadFloat(hunger, 0.5f, state.interaction.hungerLevel);
        }
    }

    return state;
}

// ── Native typed-array views ─────────────────────────────────────────────────
//
// The views point straight at the engine's vectors. A strong reference to the
// owning JS wrapper is attached to the external ArrayBuffer so the C++ object
// cannot be collected while JavaScript still holds the view.

struct ViewHint {
    napi_ref owner = nullptr;
};

void ViewFinalizer(napi_env env, void* /*data*/, void* hint) {
    ViewHint* view = static_cast<ViewHint*>(hint);
    if (view == nullptr) return;
    if (view->owner != nullptr) napi_delete_reference(env, view->owner);
    delete view;
}

napi_value MakeView(napi_env env,
                    napi_value owner,
                    void* data,
                    size_t length,
                    napi_typedarray_type type) {
    ViewHint* hint = new ViewHint();
    if (napi_create_reference(env, owner, 1, &hint->owner) != napi_ok) {
        delete hint;
        return nullptr;
    }

    size_t elementSize = 1;
    switch (type) {
        case napi_uint32_array:
        case napi_int32_array:
        case napi_float32_array:
            elementSize = 4;
            break;
        case napi_float64_array:
            elementSize = 8;
            break;
        default:
            elementSize = 1;
            break;
    }

    napi_value buffer = nullptr;
    if (napi_create_external_arraybuffer(env, data, length * elementSize, ViewFinalizer, hint, &buffer) != napi_ok) {
        napi_delete_reference(env, hint->owner);
        delete hint;
        return nullptr;
    }

    napi_value result = nullptr;
    if (napi_create_typedarray(env, type, length, buffer, 0, &result) != napi_ok) {
        return nullptr;
    }
    return result;
}

// ── NeuralEngine wrapper ─────────────────────────────────────────────────────

class EngineWrap : public Napi::ObjectWrap<EngineWrap> {
public:
    static Napi::FunctionReference constructor;

    static Napi::Object Init(Napi::Env env, Napi::Object exports);
    static Napi::Object CreateExternal(Napi::Env env,
                                       NeuralEngine* engine,
                                       bool owns,
                                       Napi::Value owner);

    explicit EngineWrap(const Napi::CallbackInfo& info);
    ~EngineWrap() override;

private:
    NeuralEngine* engine_ = nullptr;
    bool owns_ = false;
    napi_env env_ = nullptr;
    napi_ref ownerRef_ = nullptr;

    Napi::Value RequireEngine(const Napi::CallbackInfo& info);

    Napi::Value Connect(const Napi::CallbackInfo& info);
    Napi::Value Receive(const Napi::CallbackInfo& info);
    Napi::Value Inject(const Napi::CallbackInfo& info);
    Napi::Value Pulse(const Napi::CallbackInfo& info);
    Napi::Value Tick(const Napi::CallbackInfo& info);
    Napi::Value SetThreshold(const Napi::CallbackInfo& info);
    Napi::Value SetInhibitory(const Napi::CallbackInfo& info);
    Napi::Value MeanAbs(const Napi::CallbackInfo& info);
    Napi::Value PeakAbs(const Napi::CallbackInfo& info);
    Napi::Value Activation(const Napi::CallbackInfo& info);
    Napi::Value RebuildActiveSet(const Napi::CallbackInfo& info);
    Napi::Value Snapshot(const Napi::CallbackInfo& info);
    Napi::Value Restore(const Napi::CallbackInfo& info);

    Napi::Value GetN(const Napi::CallbackInfo& info);
    Napi::Value GetSynapseCapacity(const Napi::CallbackInfo& info);
    Napi::Value GetActiveCount(const Napi::CallbackInfo& info);
    Napi::Value GetDopamine(const Napi::CallbackInfo& info);
    void SetDopamine(const Napi::CallbackInfo& info, const Napi::Value& value);
    Napi::Value GetNorepinephrine(const Napi::CallbackInfo& info);
    void SetNorepinephrine(const Napi::CallbackInfo& info, const Napi::Value& value);

    Napi::Value GetPotential(const Napi::CallbackInfo& info);
    Napi::Value GetThreshold(const Napi::CallbackInfo& info);
    Napi::Value GetDecayRate(const Napi::CallbackInfo& info);
    Napi::Value GetFiredAt(const Napi::CallbackInfo& info);
    Napi::Value GetInhibitory(const Napi::CallbackInfo& info);
    Napi::Value GetSynapseTargets(const Napi::CallbackInfo& info);
    Napi::Value GetSynapseWeights(const Napi::CallbackInfo& info);
    Napi::Value GetSynapseCounts(const Napi::CallbackInfo& info);

    static Napi::Value Now(const Napi::CallbackInfo& info);
};

Napi::FunctionReference EngineWrap::constructor;

Napi::Object EngineWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "NeuralEngine", {
        InstanceMethod("connect", &EngineWrap::Connect),
        InstanceMethod("receive", &EngineWrap::Receive),
        InstanceMethod("inject", &EngineWrap::Inject),
        InstanceMethod("pulse", &EngineWrap::Pulse),
        InstanceMethod("tick", &EngineWrap::Tick),
        InstanceMethod("setThreshold", &EngineWrap::SetThreshold),
        InstanceMethod("setInhibitory", &EngineWrap::SetInhibitory),
        InstanceMethod("meanAbs", &EngineWrap::MeanAbs),
        InstanceMethod("peakAbs", &EngineWrap::PeakAbs),
        InstanceMethod("activation", &EngineWrap::Activation),
        InstanceMethod("rebuildActiveSet", &EngineWrap::RebuildActiveSet),
        InstanceMethod("snapshot", &EngineWrap::Snapshot),
        InstanceMethod("restore", &EngineWrap::Restore),

        InstanceAccessor("n", &EngineWrap::GetN, nullptr),
        InstanceAccessor("synapseCapacity", &EngineWrap::GetSynapseCapacity, nullptr),
        InstanceAccessor("activeCount", &EngineWrap::GetActiveCount, nullptr),
        InstanceAccessor("dopamine", &EngineWrap::GetDopamine, &EngineWrap::SetDopamine),
        InstanceAccessor("norepinephrine", &EngineWrap::GetNorepinephrine, &EngineWrap::SetNorepinephrine),
        InstanceAccessor("potential", &EngineWrap::GetPotential, nullptr),
        InstanceAccessor("threshold", &EngineWrap::GetThreshold, nullptr),
        InstanceAccessor("decayRate", &EngineWrap::GetDecayRate, nullptr),
        InstanceAccessor("firedAt", &EngineWrap::GetFiredAt, nullptr),
        InstanceAccessor("inhibitory", &EngineWrap::GetInhibitory, nullptr),
        InstanceAccessor("synapseTargets", &EngineWrap::GetSynapseTargets, nullptr),
        InstanceAccessor("synapseWeights", &EngineWrap::GetSynapseWeights, nullptr),
        InstanceAccessor("synapseCounts", &EngineWrap::GetSynapseCounts, nullptr),

        StaticMethod("now", &EngineWrap::Now),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    exports.Set("NeuralEngine", func);
    return exports;
}

Napi::Object EngineWrap::CreateExternal(Napi::Env env,
                                        NeuralEngine* engine,
                                        bool owns,
                                        Napi::Value owner) {
    Napi::External<NeuralEngine> external = Napi::External<NeuralEngine>::New(env, engine);
    Napi::Object object = constructor.New({
        external,
        Napi::Boolean::New(env, owns),
        owner,
    });
    return object;
}

EngineWrap::EngineWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<EngineWrap>(info), env_(info.Env()) {
    if (info.Length() >= 1 && info[0].IsExternal()) {
        engine_ = info[0].As<Napi::External<NeuralEngine>>().Data();
        owns_ = info.Length() >= 2 && info[1].IsBoolean() && info[1].As<Napi::Boolean>().Value();
    } else {
        uint32_t neurons = 0;
        uint32_t synapses = 200;
        if (info.Length() >= 1) {
            if (!ReadUint32(info[0], 1, neurons)) {
                ThrowType(info.Env(), "neuronCount must be a number");
                return;
            }
        }
        if (info.Length() >= 2) {
            if (!ReadUint32(info[1], 200, synapses)) {
                ThrowType(info.Env(), "synapsesPerNeuron must be a number");
                return;
            }
        }
        engine_ = new NeuralEngine(neurons, synapses);
        owns_ = true;
    }

    if (info.Length() >= 3 && info[2].IsObject()) {
        napi_create_reference(info.Env(), info[2], 1, &ownerRef_);
    }
}

EngineWrap::~EngineWrap() {
    if (ownerRef_ != nullptr && env_ != nullptr) {
        napi_delete_reference(env_, ownerRef_);
        ownerRef_ = nullptr;
    }
    if (owns_ && engine_ != nullptr) {
        delete engine_;
        engine_ = nullptr;
    }
}

Napi::Value EngineWrap::RequireEngine(const Napi::CallbackInfo& info) {
    if (engine_ == nullptr) {
        Napi::Error::New(info.Env(), "NeuralEngine is not initialised").ThrowAsJavaScriptException();
        return info.Env().Undefined();
    }
    return info.Env().Undefined();
}

Napi::Value EngineWrap::Connect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t src = 0;
    uint32_t dst = 0;
    float weight = 0.0f;
    if (!ReadUint32(info[0], 0, src) || !ReadUint32(info[1], 0, dst) || !ReadFloat(info[2], 0.0f, weight)) {
        return TypeFailure(env, "connect(src, dst, weight) expects numbers");
    }
    engine_->connect(src, dst, weight);
    return env.Undefined();
}

Napi::Value EngineWrap::Receive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t index = 0;
    float signal = 0.0f;
    if (!ReadUint32(info[0], 0, index) || !ReadFloat(info[1], 0.0f, signal)) {
        return TypeFailure(env, "receive(index, signal) expects numbers");
    }
    engine_->receive(index, signal);
    return env.Undefined();
}

Napi::Value EngineWrap::Inject(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t index = 0;
    float signal = 0.0f;
    if (!ReadUint32(info[0], 0, index) || !ReadFloat(info[1], 0.0f, signal)) {
        return TypeFailure(env, "inject(index, signal) expects numbers");
    }
    return Napi::Number::New(env, engine_->inject(index, signal));
}

Napi::Value EngineWrap::Pulse(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t index = 0;
    float signal = 0.0f;
    if (!ReadUint32(info[0], 0, index) || !ReadFloat(info[1], 0.0f, signal)) {
        return TypeFailure(env, "pulse(index, signal) expects numbers");
    }
    engine_->pulse(index, signal);
    return env.Undefined();
}

Napi::Value EngineWrap::Tick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t count = 1;
    if (info.Length() >= 1 && !ReadUint32(info[0], 1, count)) {
        return TypeFailure(env, "tick(count) expects a number");
    }
    for (uint32_t i = 0; i < count; ++i) engine_->tick();
    return env.Undefined();
}

Napi::Value EngineWrap::SetThreshold(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t start = 0;
    uint32_t end = 0;
    float value = 1.0f;
    if (!ReadUint32(info[0], 0, start) || !ReadUint32(info[1], 0, end) || !ReadFloat(info[2], 1.0f, value)) {
        return TypeFailure(env, "setThreshold(start, end, value) expects numbers");
    }
    engine_->setThreshold(start, end, value);
    return env.Undefined();
}

Napi::Value EngineWrap::SetInhibitory(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t start = 0;
    uint32_t end = 0;
    if (!ReadUint32(info[0], 0, start) || !ReadUint32(info[1], 0, end)) {
        return TypeFailure(env, "setInhibitory(start, end) expects numbers");
    }
    engine_->setInhibitory(start, end);
    return env.Undefined();
}

Napi::Value EngineWrap::MeanAbs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t start = 0;
    uint32_t end = 0;
    uint32_t step = 1;
    if (!ReadUint32(info[0], 0, start) || !ReadUint32(info[1], 0, end) || !ReadUint32(info[2], 1, step)) {
        return TypeFailure(env, "meanAbs(start, end, step) expects numbers");
    }
    return Napi::Number::New(env, engine_->meanAbs(start, end, step));
}

Napi::Value EngineWrap::PeakAbs(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t start = 0;
    uint32_t end = 0;
    if (!ReadUint32(info[0], 0, start) || !ReadUint32(info[1], 0, end)) {
        return TypeFailure(env, "peakAbs(start, end) expects numbers");
    }
    return Napi::Number::New(env, engine_->peakAbs(start, end));
}

Napi::Value EngineWrap::Activation(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    uint32_t start = 0;
    uint32_t end = 0;
    if (!ReadUint32(info[0], 0, start) || !ReadUint32(info[1], 0, end)) {
        return TypeFailure(env, "activation(start, end) expects numbers");
    }
    return CopyFloat32(env, engine_->activation(start, end));
}

Napi::Value EngineWrap::RebuildActiveSet(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    engine_->rebuildActiveSet();
    return env.Undefined();
}

Napi::Value EngineWrap::Snapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);

    Napi::Object out = Napi::Object::New(env);
    out.Set("n", Napi::Number::New(env, engine_->n));
    out.Set("synapseCapacity", Napi::Number::New(env, engine_->synapseCapacity));
    out.Set("dopamine", Napi::Number::New(env, engine_->dopamine));
    out.Set("norepinephrine", Napi::Number::New(env, engine_->norepinephrine));
    out.Set("potential", CopyFloat32(env, engine_->potential));
    out.Set("threshold", CopyFloat32(env, engine_->threshold));
    out.Set("decayRate", CopyFloat32(env, engine_->decayRate));
    out.Set("firedAt", CopyFloat64(env, engine_->firedAt));
    out.Set("inhibitory", CopyUint8(env, engine_->inhibitory));
    out.Set("synapseTargets", CopyUint32(env, engine_->synapseTargets));
    out.Set("synapseWeights", CopyFloat32(env, engine_->synapseWeights));
    out.Set("synapseCounts", CopyUint32(env, engine_->synapseCounts));
    return out;
}

Napi::Value EngineWrap::Restore(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (engine_ == nullptr) return RequireEngine(info);
    if (info.Length() < 1 || !info[0].IsObject()) {
        return TypeFailure(env, "restore(snapshot) expects an object");
    }

    Napi::Object snapshot = info[0].As<Napi::Object>();
    Napi::Value nValue = snapshot.Get("n");
    if (!nValue.IsUndefined()) {
        uint32_t n = 0;
        ReadUint32(nValue, 0, n);
        if (n != 0 && n != engine_->n) {
            Napi::RangeError::New(env, "snapshot was taken from an engine with a different neuron count")
                .ThrowAsJavaScriptException();
            return env.Undefined();
        }
    }

    if (!RestoreFloat32(env, snapshot.Get("potential"), engine_->potential, "potential") ||
        !RestoreFloat32(env, snapshot.Get("threshold"), engine_->threshold, "threshold") ||
        !RestoreFloat32(env, snapshot.Get("decayRate"), engine_->decayRate, "decayRate") ||
        !RestoreFloat64(env, snapshot.Get("firedAt"), engine_->firedAt, "firedAt") ||
        !RestoreUint8(env, snapshot.Get("inhibitory"), engine_->inhibitory, "inhibitory") ||
        !RestoreUint32(env, snapshot.Get("synapseTargets"), engine_->synapseTargets, "synapseTargets") ||
        !RestoreFloat32(env, snapshot.Get("synapseWeights"), engine_->synapseWeights, "synapseWeights") ||
        !RestoreUint32(env, snapshot.Get("synapseCounts"), engine_->synapseCounts, "synapseCounts")) {
        return env.Undefined();
    }

    double dopamine = 0.0;
    double norepinephrine = 0.0;
    ReadNumber(snapshot.Get("dopamine"), 0.0, dopamine);
    ReadNumber(snapshot.Get("norepinephrine"), 0.0, norepinephrine);
    engine_->dopamine = dopamine;
    engine_->norepinephrine = norepinephrine;
    engine_->rebuildActiveSet();
    return env.Undefined();
}

Napi::Value EngineWrap::GetN(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine_ ? engine_->n : 0);
}

Napi::Value EngineWrap::GetSynapseCapacity(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine_ ? engine_->synapseCapacity : 0);
}

Napi::Value EngineWrap::GetActiveCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine_ ? engine_->activeCount() : 0);
}

Napi::Value EngineWrap::GetDopamine(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine_ ? engine_->dopamine : 0.0);
}

void EngineWrap::SetDopamine(const Napi::CallbackInfo& info, const Napi::Value& value) {
    if (engine_ == nullptr) return;
    double d = engine_->dopamine;
    if (ReadNumber(value, d, d)) engine_->dopamine = d;
}

Napi::Value EngineWrap::GetNorepinephrine(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), engine_ ? engine_->norepinephrine : 0.0);
}

void EngineWrap::SetNorepinephrine(const Napi::CallbackInfo& info, const Napi::Value& value) {
    if (engine_ == nullptr) return;
    double d = engine_->norepinephrine;
    if (ReadNumber(value, d, d)) engine_->norepinephrine = d;
}

#define NEUROPILE_VIEW_GETTER(NAME, FIELD, TYPE, NATIVE_TYPE)                              \
    Napi::Value EngineWrap::NAME(const Napi::CallbackInfo& info) {                     \
        Napi::Env env = info.Env();                                                    \
        if (engine_ == nullptr) return env.Undefined();                                \
        napi_value view = MakeView(env, info.This(), engine_->FIELD.data(),            \
                                   engine_->FIELD.size(), TYPE);                       \
        if (view == nullptr) {                                                         \
            Napi::Error::New(env, "could not create " #FIELD " view")                   \
                .ThrowAsJavaScriptException();                                         \
            return env.Undefined();                                                    \
        }                                                                              \
        return Napi::Value(env, view);                                                 \
    }

NEUROPILE_VIEW_GETTER(GetPotential, potential, napi_float32_array, float)
NEUROPILE_VIEW_GETTER(GetThreshold, threshold, napi_float32_array, float)
NEUROPILE_VIEW_GETTER(GetDecayRate, decayRate, napi_float32_array, float)
NEUROPILE_VIEW_GETTER(GetFiredAt, firedAt, napi_float64_array, double)
NEUROPILE_VIEW_GETTER(GetInhibitory, inhibitory, napi_uint8_array, uint8_t)
NEUROPILE_VIEW_GETTER(GetSynapseTargets, synapseTargets, napi_uint32_array, uint32_t)
NEUROPILE_VIEW_GETTER(GetSynapseWeights, synapseWeights, napi_float32_array, float)
NEUROPILE_VIEW_GETTER(GetSynapseCounts, synapseCounts, napi_uint32_array, uint32_t)

#undef NEUROPILE_VIEW_GETTER

Napi::Value EngineWrap::Now(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), NeuralEngine::nowMs());
}

// ── BrainCore wrapper ────────────────────────────────────────────────────────

class BrainWrap : public Napi::ObjectWrap<BrainWrap> {
public:
    static Napi::FunctionReference constructor;

    static Napi::Object Init(Napi::Env env, Napi::Object exports);

    explicit BrainWrap(const Napi::CallbackInfo& info);
    ~BrainWrap() override;

private:
    BrainCore* core_ = nullptr;

    Napi::Value Tick(const Napi::CallbackInfo& info);
    Napi::Value Reward(const Napi::CallbackInfo& info);
    Napi::Value Punish(const Napi::CallbackInfo& info);
    Napi::Value SetNeeds(const Napi::CallbackInfo& info);
    Napi::Value GetNeeds(const Napi::CallbackInfo& info);
    Napi::Value GetBody(const Napi::CallbackInfo& info);
    Napi::Value GetMotorState(const Napi::CallbackInfo& info);
    Napi::Value SetBody(const Napi::CallbackInfo& info);
    Napi::Value SetMotorState(const Napi::CallbackInfo& info);
    Napi::Value SetAffect(const Napi::CallbackInfo& info);
    Napi::Value SetLastFood(const Napi::CallbackInfo& info);
    Napi::Value SetMotorHint(const Napi::CallbackInfo& info);
    Napi::Value SetTickCount(const Napi::CallbackInfo& info);
    Napi::Value Move(const Napi::CallbackInfo& info);
    Napi::Value IntegrateWorldState(const Napi::CallbackInfo& info);
    Napi::Value HandleInteraction(const Napi::CallbackInfo& info);
    Napi::Value AmygdalaActivate(const Napi::CallbackInfo& info);
    Napi::Value Startle(const Napi::CallbackInfo& info);
    Napi::Value EmotionalState(const Napi::CallbackInfo& info);
    Napi::Value BehaviorState(const Napi::CallbackInfo& info);
    Napi::Value DecideBehavior(const Napi::CallbackInfo& info);
    Napi::Value ActionSelection(const Napi::CallbackInfo& info);
    Napi::Value Novelty(const Napi::CallbackInfo& info);
    Napi::Value Reafference(const Napi::CallbackInfo& info);
    Napi::Value SelfAwareness(const Napi::CallbackInfo& info);
    Napi::Value GetMotorIntent(const Napi::CallbackInfo& info);
    Napi::Value ReadInternalState(const Napi::CallbackInfo& info);
    Napi::Value NeuronMap(const Napi::CallbackInfo& info);
    Napi::Value Thought(const Napi::CallbackInfo& info);
    Napi::Value Perceive(const Napi::CallbackInfo& info);
    Napi::Value PerceiveDense(const Napi::CallbackInfo& info);
    Napi::Value PerceiveVisual(const Napi::CallbackInfo& info);
    Napi::Value Hear(const Napi::CallbackInfo& info);
    Napi::Value HearDense(const Napi::CallbackInfo& info);
    Napi::Value Encode(const Napi::CallbackInfo& info);
    Napi::Value EncodeDense(const Napi::CallbackInfo& info);
    Napi::Value Consolidate(const Napi::CallbackInfo& info);
    Napi::Value ConsolidateDense(const Napi::CallbackInfo& info);
    Napi::Value MotorQuadrantSize(const Napi::CallbackInfo& info);
    Napi::Value GetRegion(const Napi::CallbackInfo& info);
    Napi::Value Snapshot(const Napi::CallbackInfo& info);
    Napi::Value Restore(const Napi::CallbackInfo& info);

    Napi::Value Grow(const Napi::CallbackInfo& info);
    Napi::Value GrowTo(const Napi::CallbackInfo& info);
    Napi::Value MaybeGrow(const Napi::CallbackInfo& info);

    Napi::Value GetEngine(const Napi::CallbackInfo& info);
    Napi::Value GetRegions(const Napi::CallbackInfo& info);
    Napi::Value GetOptions(const Napi::CallbackInfo& info);
    Napi::Value GetTickCount(const Napi::CallbackInfo& info);
    Napi::Value GetValence(const Napi::CallbackInfo& info);
    Napi::Value GetArousal(const Napi::CallbackInfo& info);
    Napi::Value GetDrive(const Napi::CallbackInfo& info);
    Napi::Value GetNeedsProperty(const Napi::CallbackInfo& info);
    Napi::Value GetBodyProperty(const Napi::CallbackInfo& info);
    Napi::Value GetMotorStateProperty(const Napi::CallbackInfo& info);
    Napi::Value GetNeuronCount(const Napi::CallbackInfo& info);
    Napi::Value GetMaxNeurons(const Napi::CallbackInfo& info);
    Napi::Value GetCanGrow(const Napi::CallbackInfo& info);
    Napi::Value GetGrowthProgress(const Napi::CallbackInfo& info);
    Napi::Value GetGrowthEvents(const Napi::CallbackInfo& info);

    bool ReadInput(const Napi::CallbackInfo& info, size_t index,
                   std::vector<uint32_t>& indices, std::vector<float>& dense, bool& isDense);
    bool ReadStrength(const Napi::CallbackInfo& info, size_t index, float& strength);
};

Napi::FunctionReference BrainWrap::constructor;

Napi::Object BrainWrap::Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func = DefineClass(env, "BrainCore", {
        InstanceMethod("tick", &BrainWrap::Tick),
        InstanceMethod("reward", &BrainWrap::Reward),
        InstanceMethod("punish", &BrainWrap::Punish),
        InstanceMethod("setNeeds", &BrainWrap::SetNeeds),
        InstanceMethod("getNeeds", &BrainWrap::GetNeeds),
        InstanceMethod("getBody", &BrainWrap::GetBody),
        InstanceMethod("getMotorState", &BrainWrap::GetMotorState),
        InstanceMethod("setBody", &BrainWrap::SetBody),
        InstanceMethod("setMotorState", &BrainWrap::SetMotorState),
        InstanceMethod("setAffect", &BrainWrap::SetAffect),
        InstanceMethod("setLastFood", &BrainWrap::SetLastFood),
        InstanceMethod("setMotorHint", &BrainWrap::SetMotorHint),
        InstanceMethod("setTickCount", &BrainWrap::SetTickCount),
        InstanceMethod("move", &BrainWrap::Move),
        InstanceMethod("integrateWorldState", &BrainWrap::IntegrateWorldState),
        InstanceMethod("handleInteraction", &BrainWrap::HandleInteraction),
        InstanceMethod("amygdalaActivate", &BrainWrap::AmygdalaActivate),
        InstanceMethod("startle", &BrainWrap::Startle),
        InstanceMethod("emotionalState", &BrainWrap::EmotionalState),
        InstanceMethod("behaviorState", &BrainWrap::BehaviorState),
        InstanceMethod("decideBehavior", &BrainWrap::DecideBehavior),
        InstanceMethod("actionSelection", &BrainWrap::ActionSelection),
        InstanceMethod("novelty", &BrainWrap::Novelty),
        InstanceMethod("reafference", &BrainWrap::Reafference),
        InstanceMethod("selfAwareness", &BrainWrap::SelfAwareness),
        InstanceMethod("getMotorIntent", &BrainWrap::GetMotorIntent),
        InstanceMethod("readInternalState", &BrainWrap::ReadInternalState),
        InstanceMethod("neuronMap", &BrainWrap::NeuronMap),
        InstanceMethod("thought", &BrainWrap::Thought),
        InstanceMethod("perceive", &BrainWrap::Perceive),
        InstanceMethod("perceiveDense", &BrainWrap::PerceiveDense),
        InstanceMethod("perceiveVisual", &BrainWrap::PerceiveVisual),
        InstanceMethod("hear", &BrainWrap::Hear),
        InstanceMethod("hearDense", &BrainWrap::HearDense),
        InstanceMethod("encode", &BrainWrap::Encode),
        InstanceMethod("encodeDense", &BrainWrap::EncodeDense),
        InstanceMethod("consolidate", &BrainWrap::Consolidate),
        InstanceMethod("consolidateDense", &BrainWrap::ConsolidateDense),
        InstanceMethod("motorQuadrantSize", &BrainWrap::MotorQuadrantSize),
        InstanceMethod("region", &BrainWrap::GetRegion),
        InstanceMethod("snapshot", &BrainWrap::Snapshot),
        InstanceMethod("restore", &BrainWrap::Restore),
        InstanceMethod("grow", &BrainWrap::Grow),
        InstanceMethod("growTo", &BrainWrap::GrowTo),
        InstanceMethod("maybeGrow", &BrainWrap::MaybeGrow),

        InstanceAccessor("engine", &BrainWrap::GetEngine, nullptr),
        InstanceAccessor("regions", &BrainWrap::GetRegions, nullptr),
        InstanceAccessor("options", &BrainWrap::GetOptions, nullptr),
        InstanceAccessor("tickCount", &BrainWrap::GetTickCount, nullptr),
        InstanceAccessor("valence", &BrainWrap::GetValence, nullptr),
        InstanceAccessor("arousal", &BrainWrap::GetArousal, nullptr),
        InstanceAccessor("drive", &BrainWrap::GetDrive, nullptr),
        InstanceAccessor("needs", &BrainWrap::GetNeedsProperty, nullptr),
        InstanceAccessor("body", &BrainWrap::GetBodyProperty, nullptr),
        InstanceAccessor("motorState", &BrainWrap::GetMotorStateProperty, nullptr),
        InstanceAccessor("neuronCount", &BrainWrap::GetNeuronCount, nullptr),
        InstanceAccessor("maxNeurons", &BrainWrap::GetMaxNeurons, nullptr),
        InstanceAccessor("canGrow", &BrainWrap::GetCanGrow, nullptr),
        InstanceAccessor("growthProgress", &BrainWrap::GetGrowthProgress, nullptr),
        InstanceAccessor("growthEvents", &BrainWrap::GetGrowthEvents, nullptr),
    });

    constructor = Napi::Persistent(func);
    constructor.SuppressDestruct();
    exports.Set("BrainCore", func);
    return exports;
}

BrainWrap::BrainWrap(const Napi::CallbackInfo& info)
    : Napi::ObjectWrap<BrainWrap>(info) {
    Napi::Env env = info.Env();
    BrainOptions options;

    if (info.Length() >= 1 && info[0].IsObject()) {
        Napi::Object input = info[0].As<Napi::Object>();
        Napi::Value value;

        if (GetObjectProperty(input, "sizeGB", value)) {
            if (!ReadNumber(value, options.sizeGB, options.sizeGB)) {
                ThrowType(env, "sizeGB must be a number");
                return;
            }
        }
        if (GetObjectProperty(input, "neurons", value)) {
            uint32_t neurons = 0;
            if (!ReadUint32(value, 0, neurons)) {
                ThrowType(env, "neurons must be a number");
                return;
            }
            if (neurons > 0) {
                options.useExplicitNeurons = true;
                options.neurons = neurons;
            }
        }
        if (GetObjectProperty(input, "startNeurons", value)) {
            uint32_t startNeurons = 0;
            if (!ReadUint32(value, 0, startNeurons)) {
                ThrowType(env, "startNeurons must be a number");
                return;
            }
            if (startNeurons > 0) {
                options.useStartNeurons = true;
                options.startNeurons = startNeurons;
            }
        }
        if (GetObjectProperty(input, "maxNeurons", value)) {
            uint32_t maxNeurons = 0;
            if (!ReadUint32(value, 0, maxNeurons)) {
                ThrowType(env, "maxNeurons must be a number");
                return;
            }
            options.hasMaxNeurons = true;
            options.maxNeurons = maxNeurons;
        }
        if (GetObjectProperty(input, "autoGrow", value)) {
            bool autoGrow = false;
            if (!ReadBool(value, autoGrow, autoGrow)) {
                ThrowType(env, "autoGrow must be a boolean");
                return;
            }
            options.hasAutoGrow = true;
            options.autoGrow = autoGrow;
        }
        if (GetObjectProperty(input, "growthBatch", value)) {
            if (!ReadUint32(value, 0, options.growthBatch)) {
                ThrowType(env, "growthBatch must be a number");
                return;
            }
        }
        if (GetObjectProperty(input, "growthInterval", value)) {
            if (!ReadUint32(value, 0, options.growthInterval)) {
                ThrowType(env, "growthInterval must be a number");
                return;
            }
            options.hasGrowthInterval = true;
        }
        if (GetObjectProperty(input, "growthFanout", value)) {
            if (!ReadUint32(value, 0, options.growthFanout)) {
                ThrowType(env, "growthFanout must be a number");
                return;
            }
        }
        if (GetObjectProperty(input, "growthProfile", value)) {
            std::vector<float> profile;
            if (!ReadFloatArray(env, value, profile)) {
                ThrowType(env, "growthProfile must be an array of numbers");
                return;
            }
            options.growthProfile = std::move(profile);
        }
        if (GetObjectProperty(input, "synapsesPerNeuron", value)) {
            if (!ReadUint32(value, options.synapsesPerNeuron, options.synapsesPerNeuron)) {
                ThrowType(env, "synapsesPerNeuron must be a number");
                return;
            }
        }
        if (GetObjectProperty(input, "maxConnections", value)) {
            if (!ReadUint32(value, options.maxConnections, options.maxConnections)) {
                ThrowType(env, "maxConnections must be a number");
                return;
            }
        }
        if (GetObjectProperty(input, "wire", value)) {
            if (!ReadBool(value, options.wire, options.wire)) {
                ThrowType(env, "wire must be a boolean");
                return;
            }
        }
        if (GetObjectProperty(input, "seed", value)) {
            uint32_t seed = 0;
            if (!ReadUint32(value, 0, seed)) {
                ThrowType(env, "seed must be a number");
                return;
            }
            options.hasSeed = true;
            options.seed = seed;
        }
    }

    core_ = new BrainCore(options);
}

BrainWrap::~BrainWrap() {
    delete core_;
    core_ = nullptr;
}

bool BrainWrap::ReadInput(const Napi::CallbackInfo& info, size_t index,
                          std::vector<uint32_t>& indices,
                          std::vector<float>& dense,
                          bool& isDense) {
    if (info.Length() <= index) {
        ThrowType(info.Env(), "missing input array");
        return false;
    }
    return ReadIndicesOrDense(info.Env(), info[index], indices, dense, isDense);
}

bool BrainWrap::ReadStrength(const Napi::CallbackInfo& info, size_t index, float& strength) {
    strength = 1.0f;
    if (info.Length() <= index) return true;
    return ReadFloat(info[index], 1.0f, strength);
}

Napi::Value BrainWrap::Tick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    uint32_t count = 1;
    if (info.Length() >= 1 && !ReadUint32(info[0], 1, count)) {
        return TypeFailure(env, "tick(count) expects a number");
    }
    core_->tick(count);
    return Napi::Number::New(env, static_cast<double>(core_->tickCount()));
}

Napi::Value BrainWrap::Reward(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float strength = 1.0f;
    if (info.Length() >= 1 && !ReadFloat(info[0], 1.0f, strength)) {
        return TypeFailure(env, "reward(strength) expects a number");
    }
    core_->reward(strength);
    return Napi::Number::New(env, core_->engine().dopamine);
}

Napi::Value BrainWrap::Punish(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float strength = 1.0f;
    if (info.Length() >= 1 && !ReadFloat(info[0], 1.0f, strength)) {
        return TypeFailure(env, "punish(strength) expects a number");
    }
    core_->punish(strength);
    return Napi::Number::New(env, core_->engine().dopamine);
}

Napi::Value BrainWrap::SetNeeds(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    Needs needs = core_->getNeeds();
    if (info.Length() >= 1 && info[0].IsObject()) {
        Napi::Object input = info[0].As<Napi::Object>();
        ReadFloat(input.Get("hunger"), needs.hunger, needs.hunger);
        ReadFloat(input.Get("energy"), needs.energy, needs.energy);
        ReadFloat(input.Get("joy"), needs.joy, needs.joy);
    }
    return NeedsObject(env, core_->setNeeds(needs));
}

Napi::Value BrainWrap::GetNeeds(const Napi::CallbackInfo& info) {
    return NeedsObject(info.Env(), core_->getNeeds());
}

Napi::Value BrainWrap::GetBody(const Napi::CallbackInfo& info) {
    return BodyObject(info.Env(), core_->getBody());
}

Napi::Value BrainWrap::GetMotorState(const Napi::CallbackInfo& info) {
    return MotorStateObject(info.Env(), core_->getMotorState());
}

Napi::Value BrainWrap::SetBody(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    Body body = core_->getBody();
    if (info.Length() >= 1 && info[0].IsObject()) {
        Napi::Object input = info[0].As<Napi::Object>();
        ReadFloat(input.Get("x"), body.x, body.x);
        ReadFloat(input.Get("y"), body.y, body.y);
        ReadFloat(input.Get("heading"), body.heading, body.heading);
        ReadFloat(input.Get("speed"), body.speed, body.speed);
        ReadFloat(input.Get("energy"), body.energy, body.energy);
    }
    core_->setBody(body);
    return env.Undefined();
}

Napi::Value BrainWrap::SetMotorState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    MotorState state = core_->getMotorState();
    if (info.Length() >= 1 && info[0].IsObject()) {
        Napi::Object input = info[0].As<Napi::Object>();
        ReadFloat(input.Get("moveX"), state.moveX, state.moveX);
        ReadFloat(input.Get("moveY"), state.moveY, state.moveY);
        Napi::Value action = input.Get("lastAction");
        if (action.IsString()) state.lastAction = action.As<Napi::String>().Utf8Value();
        else if (action.IsNull()) state.lastAction.clear();
    }
    core_->setMotorState(state);
    return env.Undefined();
}

Napi::Value BrainWrap::SetAffect(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float valence = core_->valence();
    float arousal = core_->arousal();
    float drive = core_->drive();
    if (!ReadFloat(info[0], valence, valence) ||
        !ReadFloat(info[1], arousal, arousal) ||
        !ReadFloat(info[2], drive, drive)) {
        return TypeFailure(env, "setAffect(valence, arousal, drive) expects numbers");
    }
    core_->setAffect(valence, arousal, drive);
    return env.Undefined();
}

Napi::Value BrainWrap::SetLastFood(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    bool has = core_->hasLastFood();
    float x = core_->lastFoodX();
    float y = core_->lastFoodY();
    ReadBool(info[0], has, has);
    ReadFloat(info[1], x, x);
    ReadFloat(info[2], y, y);
    core_->setLastFood(has, x, y);
    return env.Undefined();
}

Napi::Value BrainWrap::SetMotorHint(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    bool active = core_->motorHintActive();
    float x = core_->motorHintX();
    float y = core_->motorHintY();
    float intensity = core_->motorHintIntensity();
    std::string mode = core_->motorHintMode();
    ReadBool(info[0], active, active);
    ReadFloat(info[1], x, x);
    ReadFloat(info[2], y, y);
    ReadFloat(info[3], intensity, intensity);
    if (info.Length() >= 5 && info[4].IsString()) mode = info[4].As<Napi::String>().Utf8Value();
    core_->setMotorHint(active, x, y, intensity, mode);
    return env.Undefined();
}

Napi::Value BrainWrap::SetTickCount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    double value = static_cast<double>(core_->tickCount());
    if (!ReadNumber(info[0], value, value)) {
        return TypeFailure(env, "setTickCount(value) expects a number");
    }
    core_->setTickCount(value <= 0.0 ? 0 : static_cast<uint64_t>(value));
    return env.Undefined();
}

Napi::Value BrainWrap::Move(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float dx = 0.0f;
    float dy = 0.0f;
    float intensity = 1.0f;
    if (!ReadFloat(info[0], 0.0f, dx) || !ReadFloat(info[1], 0.0f, dy) ||
        !ReadFloat(info[2], 1.0f, intensity)) {
        return TypeFailure(env, "move(dx, dy, intensity) expects numbers");
    }
    return BodyObject(env, core_->move(dx, dy, intensity));
}

Napi::Value BrainWrap::IntegrateWorldState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    WorldState state = ParseWorldState(env, info.Length() >= 1 ? info[0] : env.Undefined());
    return EmotionalObject(env, core_->integrateWorldState(state));
}

Napi::Value BrainWrap::HandleInteraction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    if (info.Length() < 1 || !info[0].IsString()) {
        return TypeFailure(env, "handleInteraction(kind, intensity) expects a string kind");
    }
    float intensity = 1.0f;
    ReadFloat(info[1], 1.0f, intensity);
    return NeedsObject(env, core_->handleInteraction(info[0].As<Napi::String>().Utf8Value(), intensity));
}

Napi::Value BrainWrap::AmygdalaActivate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float threat = 0.5f;
    ReadFloat(info[0], 0.5f, threat);
    return Napi::Number::New(env, core_->amygdalaActivate(threat));
}

Napi::Value BrainWrap::Startle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    float strength = 1.0f;
    ReadFloat(info[0], 1.0f, strength);
    core_->startle(strength);
    return env.Undefined();
}

Napi::Value BrainWrap::EmotionalState(const Napi::CallbackInfo& info) {
    return EmotionalObject(info.Env(), core_->emotionalState());
}

Napi::Value BrainWrap::BehaviorState(const Napi::CallbackInfo& info) {
    return BehaviorObject(info.Env(), core_->behaviorState());
}

Napi::Value BrainWrap::DecideBehavior(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();

    bool hasActiveGoal = false;
    float urgency = 0.0f;
    bool humanPresent = false;
    uint64_t tickCount = 0;
    uint64_t lastSpokeTick = 0;
    bool pendingSelfSpeech = false;

    if (info.Length() >= 1 && info[0].IsObject()) {
        Napi::Object options = info[0].As<Napi::Object>();
        Napi::Value value;
        if (GetObjectProperty(options, "activeGoal", value) && value.IsObject()) {
            hasActiveGoal = true;
            ReadFloat(value.As<Napi::Object>().Get("urgency"), 0.0f, urgency);
        }
        if (GetObjectProperty(options, "humanPresent", value)) ReadBool(value, false, humanPresent);
        if (GetObjectProperty(options, "pendingSelfSpeech", value)) ReadBool(value, false, pendingSelfSpeech);
        if (GetObjectProperty(options, "tickCount", value)) {
            double d = 0.0;
            if (ReadNumber(value, 0.0, d)) tickCount = static_cast<uint64_t>(d < 0 ? 0 : d);
        }
        if (GetObjectProperty(options, "lastSpokeTick", value)) {
            double d = 0.0;
            if (ReadNumber(value, 0.0, d)) lastSpokeTick = static_cast<uint64_t>(d < 0 ? 0 : d);
        }
    }

    Decision decision = core_->decideBehavior(hasActiveGoal, urgency, humanPresent,
                                              tickCount, lastSpokeTick, pendingSelfSpeech);
    Napi::Object out = BehaviorObject(env, decision.state);
    out.Set("canSpeak", Napi::Boolean::New(env, decision.canSpeak));
    out.Set("shouldResearch", Napi::Boolean::New(env, decision.shouldResearch));
    out.Set("shouldAct", Napi::Boolean::New(env, decision.shouldAct));
    out.Set("responseMode", Napi::String::New(env, decision.responseMode));
    return out;
}

Napi::Value BrainWrap::ActionSelection(const Napi::CallbackInfo& info) {
    if (core_ != nullptr) core_->actionSelection();
    return info.Env().Undefined();
}

Napi::Value BrainWrap::Novelty(const Napi::CallbackInfo& info) {
    if (core_ == nullptr) return Napi::Number::New(info.Env(), 0.0);
    return Napi::Number::New(info.Env(), core_->novelty());
}

Napi::Value BrainWrap::Reafference(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    uint32_t topN = 20;
    if (info.Length() >= 1) ReadUint32(info[0], 20, topN);

    neuropile::Reafference result = core_->reafference(topN);
    Napi::Array indices = Napi::Array::New(env, result.indices.size());
    for (size_t i = 0; i < result.indices.size(); ++i) {
        indices.Set(static_cast<uint32_t>(i), Napi::Number::New(env, result.indices[i]));
    }
    Napi::Object out = Napi::Object::New(env);
    out.Set("indices", indices);
    out.Set("strength", Napi::Number::New(env, result.strength));
    return out;
}

Napi::Value BrainWrap::SelfAwareness(const Napi::CallbackInfo& info) {
    if (core_ == nullptr) return Napi::Number::New(info.Env(), 0.0);
    return Napi::Number::New(info.Env(), core_->selfAwareness());
}

Napi::Value BrainWrap::GetMotorIntent(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    MotorIntent intent = core_->getMotorIntent();
    Napi::Object out = Napi::Object::New(env);
    out.Set("dx", Napi::Number::New(env, intent.dx));
    out.Set("dy", Napi::Number::New(env, intent.dy));
    out.Set("strength", Napi::Number::New(env, intent.strength));
    return out;
}

Napi::Value BrainWrap::ReadInternalState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    Napi::Object out = Napi::Object::New(env);
    for (const auto& entry : core_->readInternalState()) {
        out.Set(entry.first, Napi::Number::New(env, entry.second));
    }
    return out;
}

Napi::Value BrainWrap::NeuronMap(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::unordered_map<std::string, RegionStat> stats = core_->neuronMap();
    Napi::Object out = Napi::Object::New(env);
    for (const Region& region : core_->regions()) {
        const auto it = stats.find(region.name);
        RegionStat stat;
        if (it != stats.end()) stat = it->second;
        Napi::Object value = Napi::Object::New(env);
        value.Set("mean", Napi::Number::New(env, stat.mean));
        value.Set("peak", Napi::Number::New(env, stat.peak));
        value.Set("firing", Napi::Number::New(env, stat.firing));
        out.Set(region.name, value);
    }
    return out;
}

Napi::Value BrainWrap::Thought(const Napi::CallbackInfo& info) {
    if (core_ == nullptr) return info.Env().Undefined();
    return CopyFloat32(info.Env(), core_->thought());
}

Napi::Value BrainWrap::Perceive(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<uint32_t> indices;
    std::vector<float> dense;
    bool isDense = true;
    if (!ReadInput(info, 0, indices, dense, isDense)) return env.Undefined();
    if (isDense) core_->perceiveDense(dense);
    else core_->perceive(indices);
    return env.Undefined();
}

Napi::Value BrainWrap::PerceiveDense(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<float> dense;
    if (!ReadFloatArray(env, info.Length() >= 1 ? info[0] : env.Undefined(), dense)) {
        return env.Undefined();
    }
    core_->perceiveDense(dense);
    return env.Undefined();
}

Napi::Value BrainWrap::PerceiveVisual(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<uint32_t> indices;
    if (!ReadUint32Array(env, info.Length() >= 1 ? info[0] : env.Undefined(), indices)) {
        return env.Undefined();
    }
    core_->perceiveVisual(indices);
    return env.Undefined();
}

Napi::Value BrainWrap::Hear(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<uint32_t> indices;
    std::vector<float> dense;
    bool isDense = true;
    if (!ReadInput(info, 0, indices, dense, isDense)) return env.Undefined();
    if (isDense) core_->hearDense(dense);
    else core_->hear(indices);
    return env.Undefined();
}

Napi::Value BrainWrap::HearDense(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<float> dense;
    if (!ReadFloatArray(env, info.Length() >= 1 ? info[0] : env.Undefined(), dense)) {
        return env.Undefined();
    }
    core_->hearDense(dense);
    return env.Undefined();
}

Napi::Value BrainWrap::Encode(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<uint32_t> indices;
    std::vector<float> dense;
    bool isDense = true;
    if (!ReadInput(info, 0, indices, dense, isDense)) return env.Undefined();
    float strength = 1.0f;
    if (!ReadStrength(info, 1, strength)) return env.Undefined();
    if (isDense) core_->encodeDense(dense, strength);
    else core_->encode(indices, strength);
    return env.Undefined();
}

Napi::Value BrainWrap::EncodeDense(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<float> dense;
    if (!ReadFloatArray(env, info.Length() >= 1 ? info[0] : env.Undefined(), dense)) {
        return env.Undefined();
    }
    float strength = 1.0f;
    if (!ReadStrength(info, 1, strength)) return env.Undefined();
    core_->encodeDense(dense, strength);
    return env.Undefined();
}

Napi::Value BrainWrap::Consolidate(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<uint32_t> indices;
    std::vector<float> dense;
    bool isDense = true;
    if (!ReadInput(info, 0, indices, dense, isDense)) return env.Undefined();
    float strength = 1.0f;
    if (!ReadStrength(info, 1, strength)) return env.Undefined();
    if (isDense) core_->consolidateDense(dense, strength);
    else core_->consolidate(indices, strength);
    return env.Undefined();
}

Napi::Value BrainWrap::ConsolidateDense(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    std::vector<float> dense;
    if (!ReadFloatArray(env, info.Length() >= 1 ? info[0] : env.Undefined(), dense)) {
        return env.Undefined();
    }
    float strength = 1.0f;
    if (!ReadStrength(info, 1, strength)) return env.Undefined();
    core_->consolidateDense(dense, strength);
    return env.Undefined();
}

Napi::Value BrainWrap::MotorQuadrantSize(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), core_ ? core_->motorQuadrantSize() : 0);
}

Napi::Value BrainWrap::GetRegion(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Null();
    if (info.Length() < 1 || !info[0].IsString()) return env.Null();
    const Region* region = core_->region(info[0].As<Napi::String>().Utf8Value());
    if (region == nullptr) return env.Null();
    return RegionObject(env, *region);
}

Napi::Value BrainWrap::Snapshot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    const NeuralEngine& engine = core_->engine();

    Napi::Object engineSnapshot = Napi::Object::New(env);
    engineSnapshot.Set("n", Napi::Number::New(env, engine.n));
    engineSnapshot.Set("synapseCapacity", Napi::Number::New(env, engine.synapseCapacity));
    engineSnapshot.Set("dopamine", Napi::Number::New(env, engine.dopamine));
    engineSnapshot.Set("norepinephrine", Napi::Number::New(env, engine.norepinephrine));
    engineSnapshot.Set("potential", CopyFloat32(env, engine.potential));
    engineSnapshot.Set("threshold", CopyFloat32(env, engine.threshold));
    engineSnapshot.Set("decayRate", CopyFloat32(env, engine.decayRate));
    engineSnapshot.Set("firedAt", CopyFloat64(env, engine.firedAt));
    engineSnapshot.Set("inhibitory", CopyUint8(env, engine.inhibitory));
    engineSnapshot.Set("synapseTargets", CopyUint32(env, engine.synapseTargets));
    engineSnapshot.Set("synapseWeights", CopyFloat32(env, engine.synapseWeights));
    engineSnapshot.Set("synapseCounts", CopyUint32(env, engine.synapseCounts));

    Napi::Array regions = Napi::Array::New(env, core_->regions().size());
    for (size_t i = 0; i < core_->regions().size(); ++i) {
        regions.Set(static_cast<uint32_t>(i), RegionObject(env, core_->regions()[i]));
    }

    Napi::Object state = Napi::Object::New(env);
    state.Set("tickCount", Napi::Number::New(env, static_cast<double>(core_->tickCount())));
    state.Set("valence", Napi::Number::New(env, core_->valence()));
    state.Set("arousal", Napi::Number::New(env, core_->arousal()));
    state.Set("drive", Napi::Number::New(env, core_->drive()));
    state.Set("needs", NeedsObject(env, core_->getNeeds()));
    state.Set("body", BodyObject(env, core_->getBody()));
    state.Set("motorState", MotorStateObject(env, core_->getMotorState()));
    state.Set("lastFood", env.Null());
    if (core_->hasLastFood()) {
        Napi::Array food = Napi::Array::New(env, 2);
        food.Set(static_cast<uint32_t>(0), Napi::Number::New(env, core_->lastFoodX()));
        food.Set(static_cast<uint32_t>(1), Napi::Number::New(env, core_->lastFoodY()));
        state.Set("lastFood", food);
    }
    state.Set("motorHint", env.Null());
    if (core_->motorHintActive()) {
        Napi::Object hint = Napi::Object::New(env);
        hint.Set("x", Napi::Number::New(env, core_->motorHintX()));
        hint.Set("y", Napi::Number::New(env, core_->motorHintY()));
        hint.Set("intensity", Napi::Number::New(env, core_->motorHintIntensity()));
        hint.Set("hintMode", Napi::String::New(env, core_->motorHintMode()));
        state.Set("motorHint", hint);
    }
    state.Set("baseline", CopyFloat32(env, core_->baseline()));
    state.Set("reafBaseline", CopyFloat32(env, core_->reafBaseline()));
    state.Set("growthEvents", Napi::Number::New(env, core_->growthEvents()));
    state.Set("lastGrowthTick", Napi::Number::New(env, static_cast<double>(core_->lastGrowthTick())));

    Napi::Object options = Napi::Object::New(env);
    options.Set("sizeGB", Napi::Number::New(env, core_->options().sizeGB));
    options.Set("useExplicitNeurons", Napi::Boolean::New(env, core_->options().useExplicitNeurons));
    options.Set("neurons", Napi::Number::New(env, core_->options().neurons));
    options.Set("useStartNeurons", Napi::Boolean::New(env, core_->options().useStartNeurons));
    options.Set("startNeurons", Napi::Number::New(env, core_->options().startNeurons));
    options.Set("maxNeurons", Napi::Number::New(env, core_->options().maxNeurons));
    options.Set("autoGrow", Napi::Boolean::New(env, core_->options().autoGrow));
    options.Set("growthBatch", Napi::Number::New(env, core_->options().growthBatch));
    options.Set("growthInterval", Napi::Number::New(env, core_->options().growthInterval));
    options.Set("growthFanout", Napi::Number::New(env, core_->options().growthFanout));
    if (!core_->options().growthProfile.empty()) {
        options.Set("growthProfile", CopyFloat32(env, core_->options().growthProfile));
    }
    options.Set("synapsesPerNeuron", Napi::Number::New(env, core_->options().synapsesPerNeuron));
    options.Set("maxConnections", Napi::Number::New(env, core_->options().maxConnections));
    options.Set("wire", Napi::Boolean::New(env, core_->options().wire));
    options.Set("seed", Napi::Number::New(env, core_->options().seed));

    Napi::Object out = Napi::Object::New(env);
    out.Set("version", Napi::Number::New(env, 1));
    out.Set("options", options);
    out.Set("regions", regions);
    out.Set("engine", engineSnapshot);
    out.Set("state", state);
    return out;
}

Napi::Value BrainWrap::Restore(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    if (info.Length() < 1 || !info[0].IsObject()) {
        return TypeFailure(env, "restore(snapshot) expects an object");
    }

    Napi::Object snapshot = info[0].As<Napi::Object>();
    Napi::Value engineValue = snapshot.Get("engine");
    if (!engineValue.IsObject()) {
        return TypeFailure(env, "snapshot.engine is missing");
    }

    Napi::Object engineSnapshot = engineValue.As<Napi::Object>();

    // Restore growth settings first so a grown brain keeps its cap and cadence.
    Napi::Value optionsValue = snapshot.Get("options");
    if (optionsValue.IsObject()) {
        BrainOptions opts = core_->options();
        Napi::Object in = optionsValue.As<Napi::Object>();
        Napi::Value v;
        if (GetObjectProperty(in, "startNeurons", v)) {
            uint32_t start = 0;
            ReadUint32(v, 0, start);
            opts.startNeurons = start;
            opts.useStartNeurons = start > 0;
        }
        if (GetObjectProperty(in, "maxNeurons", v)) {
            uint32_t maxNeurons = 0;
            ReadUint32(v, 0, maxNeurons);
            opts.maxNeurons = maxNeurons;
            opts.hasMaxNeurons = true;
        }
        if (GetObjectProperty(in, "autoGrow", v)) {
            bool autoGrow = false;
            ReadBool(v, false, autoGrow);
            opts.autoGrow = autoGrow;
            opts.hasAutoGrow = true;
        }
        if (GetObjectProperty(in, "growthBatch", v)) {
            ReadUint32(v, opts.growthBatch, opts.growthBatch);
        }
        if (GetObjectProperty(in, "growthInterval", v)) {
            ReadUint32(v, opts.growthInterval, opts.growthInterval);
            opts.hasGrowthInterval = true;
        }
        if (GetObjectProperty(in, "growthFanout", v)) {
            ReadUint32(v, opts.growthFanout, opts.growthFanout);
        }
        if (GetObjectProperty(in, "growthProfile", v)) {
            std::vector<float> profile;
            if (ReadFloatArray(env, v, profile)) opts.growthProfile = std::move(profile);
        }
        core_->restoreOptions(opts);
    }

    // Rebuild the region layout from the snapshot. A grown snapshot may have
    // more neurons than the freshly constructed core, so resize the engine
    // before applying the arrays.
    Napi::Value regionsValue = snapshot.Get("regions");
    if (regionsValue.IsArray()) {
        Napi::Array regionsArray = regionsValue.As<Napi::Array>();
        std::vector<Region> regions;
        regions.reserve(regionsArray.Length());
        for (uint32_t i = 0; i < regionsArray.Length(); ++i) {
            Napi::Value item = regionsArray.Get(i);
            if (!item.IsObject()) continue;
            Napi::Object regionObject = item.As<Napi::Object>();
            Region region;
            Napi::Value name = regionObject.Get("name");
            if (name.IsString()) region.name = name.As<Napi::String>().Utf8Value();
            ReadUint32(regionObject.Get("start"), region.start, region.start);
            ReadUint32(regionObject.Get("end"), region.end, region.end);
            ReadUint32(regionObject.Get("size"), region.size, region.size);
            ReadFloat(regionObject.Get("threshold"), region.threshold, region.threshold);
            ReadFloat(regionObject.Get("inhibRatio"), region.inhibRatio, region.inhibRatio);
            ReadUint32(regionObject.Get("baseSize"), region.baseSize, region.baseSize);
            regions.push_back(std::move(region));
        }
        if (!regions.empty()) core_->setRegions(regions);
    }

    uint32_t targetN = 0;
    ReadUint32(engineSnapshot.Get("n"), 0, targetN);
    uint32_t targetCapacity = core_->options().synapsesPerNeuron;
    ReadUint32(engineSnapshot.Get("synapseCapacity"), targetCapacity, targetCapacity);
    if (targetN != 0 &&
        (targetN != core_->engine().n || targetCapacity != core_->engine().synapseCapacity)) {
        core_->resizeEngine(targetN, targetCapacity);
    }

    NeuralEngine& engine = core_->engine();

    if (!RestoreFloat32(env, engineSnapshot.Get("potential"), engine.potential, "potential") ||
        !RestoreFloat32(env, engineSnapshot.Get("threshold"), engine.threshold, "threshold") ||
        !RestoreFloat32(env, engineSnapshot.Get("decayRate"), engine.decayRate, "decayRate") ||
        !RestoreFloat64(env, engineSnapshot.Get("firedAt"), engine.firedAt, "firedAt") ||
        !RestoreUint8(env, engineSnapshot.Get("inhibitory"), engine.inhibitory, "inhibitory") ||
        !RestoreUint32(env, engineSnapshot.Get("synapseTargets"), engine.synapseTargets, "synapseTargets") ||
        !RestoreFloat32(env, engineSnapshot.Get("synapseWeights"), engine.synapseWeights, "synapseWeights") ||
        !RestoreUint32(env, engineSnapshot.Get("synapseCounts"), engine.synapseCounts, "synapseCounts")) {
        return env.Undefined();
    }

    double dopamine = 0.0;
    double norepinephrine = 0.0;
    ReadNumber(engineSnapshot.Get("dopamine"), 0.0, dopamine);
    ReadNumber(engineSnapshot.Get("norepinephrine"), 0.0, norepinephrine);
    engine.dopamine = dopamine;
    engine.norepinephrine = norepinephrine;
    engine.rebuildActiveSet();

    Napi::Value stateValue = snapshot.Get("state");
    if (stateValue.IsObject()) {
        Napi::Object state = stateValue.As<Napi::Object>();

        double tickCount = 0.0;
        ReadNumber(state.Get("tickCount"), 0.0, tickCount);
        core_->setTickCount(static_cast<uint64_t>(tickCount < 0 ? 0 : tickCount));

        double valence = 0.0;
        double arousal = 0.0;
        double drive = 0.0;
        ReadNumber(state.Get("valence"), 0.0, valence);
        ReadNumber(state.Get("arousal"), 0.0, arousal);
        ReadNumber(state.Get("drive"), 0.0, drive);
        core_->setAffect(static_cast<float>(valence), static_cast<float>(arousal), static_cast<float>(drive));

        Napi::Value needsValue = state.Get("needs");
        if (needsValue.IsObject()) {
            Needs needs = core_->getNeeds();
            Napi::Object needsObject = needsValue.As<Napi::Object>();
            ReadFloat(needsObject.Get("hunger"), needs.hunger, needs.hunger);
            ReadFloat(needsObject.Get("energy"), needs.energy, needs.energy);
            ReadFloat(needsObject.Get("joy"), needs.joy, needs.joy);
            core_->setNeeds(needs);
        }

        Napi::Value bodyValue = state.Get("body");
        if (bodyValue.IsObject()) {
            Body body = core_->getBody();
            Napi::Object bodyObject = bodyValue.As<Napi::Object>();
            ReadFloat(bodyObject.Get("x"), body.x, body.x);
            ReadFloat(bodyObject.Get("y"), body.y, body.y);
            ReadFloat(bodyObject.Get("heading"), body.heading, body.heading);
            ReadFloat(bodyObject.Get("speed"), body.speed, body.speed);
            ReadFloat(bodyObject.Get("energy"), body.energy, body.energy);
            core_->setBody(body);
        }

        Napi::Value motorValue = state.Get("motorState");
        if (motorValue.IsObject()) {
            MotorState motor = core_->getMotorState();
            Napi::Object motorObject = motorValue.As<Napi::Object>();
            ReadFloat(motorObject.Get("moveX"), motor.moveX, motor.moveX);
            ReadFloat(motorObject.Get("moveY"), motor.moveY, motor.moveY);
            Napi::Value action = motorObject.Get("lastAction");
            if (action.IsString()) motor.lastAction = action.As<Napi::String>().Utf8Value();
            core_->setMotorState(motor);
        }

        Napi::Value lastFood = state.Get("lastFood");
        if (lastFood.IsArray()) {
            Napi::Array food = lastFood.As<Napi::Array>();
            float x = 0.0f;
            float y = 0.0f;
            ReadFloat(food.Get(static_cast<uint32_t>(0)), 0.0f, x);
            ReadFloat(food.Get(static_cast<uint32_t>(1)), 0.0f, y);
            core_->setLastFood(true, x, y);
        } else {
            core_->setLastFood(false, 0.0f, 0.0f);
        }

        Napi::Value motorHint = state.Get("motorHint");
        if (motorHint.IsObject()) {
            Napi::Object hint = motorHint.As<Napi::Object>();
            float x = 0.0f;
            float y = 0.0f;
            float intensity = 1.0f;
            ReadFloat(hint.Get("x"), 0.0f, x);
            ReadFloat(hint.Get("y"), 0.0f, y);
            ReadFloat(hint.Get("intensity"), 1.0f, intensity);
            Napi::Value mode = hint.Get("hintMode");
            std::string hintMode = mode.IsString() ? mode.As<Napi::String>().Utf8Value() : std::string();
            core_->setMotorHint(true, x, y, intensity, hintMode);
        } else {
            core_->setMotorHint(false, 0.0f, 0.0f, 1.0f, std::string());
        }

        Napi::Value baseline = state.Get("baseline");
        if (!IsMissing(baseline)) {
            std::vector<float> values;
            if (!ReadFloatArray(env, baseline, values)) return env.Undefined();
            core_->setBaseline(values);
        }
        Napi::Value reafBaseline = state.Get("reafBaseline");
        if (!IsMissing(reafBaseline)) {
            std::vector<float> values;
            if (!ReadFloatArray(env, reafBaseline, values)) return env.Undefined();
            core_->setReafBaseline(values);
        }

        double growthEvents = 0.0;
        ReadNumber(state.Get("growthEvents"), 0.0, growthEvents);
        core_->setGrowthEvents(static_cast<uint32_t>(growthEvents < 0 ? 0 : growthEvents));

        double lastGrowthTick = 0.0;
        ReadNumber(state.Get("lastGrowthTick"), 0.0, lastGrowthTick);
        core_->setLastGrowthTick(static_cast<uint64_t>(lastGrowthTick < 0 ? 0 : lastGrowthTick));
    }

    return env.Undefined();
}

Napi::Value BrainWrap::Grow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    uint32_t count = core_->options().growthBatch;
    if (info.Length() >= 1 && !ReadUint32(info[0], count, count)) {
        return TypeFailure(env, "grow(count) expects a number");
    }
    return Napi::Number::New(env, core_->grow(count));
}

Napi::Value BrainWrap::GrowTo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    uint32_t target = 0;
    if (!ReadUint32(info[0], 0, target)) {
        return TypeFailure(env, "growTo(target) expects a number");
    }
    return Napi::Number::New(env, core_->growTo(target));
}

Napi::Value BrainWrap::MaybeGrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Number::New(env, core_->maybeGrow());
}

Napi::Value BrainWrap::GetNeuronCount(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Number::New(env, core_->neuronCount());
}

Napi::Value BrainWrap::GetMaxNeurons(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Number::New(env, core_->maxNeurons());
}

Napi::Value BrainWrap::GetCanGrow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Boolean::New(env, core_->canGrow());
}

Napi::Value BrainWrap::GetGrowthProgress(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Number::New(env, core_->growthProgress());
}

Napi::Value BrainWrap::GetGrowthEvents(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return Napi::Number::New(env, core_->growthEvents());
}

Napi::Value BrainWrap::GetEngine(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    return EngineWrap::CreateExternal(env, &core_->engine(), false, info.This());
}

Napi::Value BrainWrap::GetRegions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    const std::vector<Region>& regions = core_->regions();
    Napi::Array out = Napi::Array::New(env, regions.size());
    for (size_t i = 0; i < regions.size(); ++i) {
        out.Set(static_cast<uint32_t>(i), RegionObject(env, regions[i]));
    }
    return out;
}

Napi::Value BrainWrap::GetOptions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (core_ == nullptr) return env.Undefined();
    const BrainOptions& options = core_->options();
    Napi::Object out = Napi::Object::New(env);
    out.Set("sizeGB", Napi::Number::New(env, options.sizeGB));
    out.Set("useExplicitNeurons", Napi::Boolean::New(env, options.useExplicitNeurons));
    out.Set("neurons", Napi::Number::New(env, options.neurons));
    out.Set("synapsesPerNeuron", Napi::Number::New(env, options.synapsesPerNeuron));
    out.Set("maxConnections", Napi::Number::New(env, options.maxConnections));
    out.Set("wire", Napi::Boolean::New(env, options.wire));
    out.Set("seed", Napi::Number::New(env, options.seed));
    return out;
}

Napi::Value BrainWrap::GetTickCount(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), core_ ? static_cast<double>(core_->tickCount()) : 0.0);
}

Napi::Value BrainWrap::GetValence(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), core_ ? core_->valence() : 0.0f);
}

Napi::Value BrainWrap::GetArousal(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), core_ ? core_->arousal() : 0.0f);
}

Napi::Value BrainWrap::GetDrive(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), core_ ? core_->drive() : 0.0f);
}

Napi::Value BrainWrap::GetNeedsProperty(const Napi::CallbackInfo& info) {
    return NeedsObject(info.Env(), core_ ? core_->getNeeds() : Needs{});
}

Napi::Value BrainWrap::GetBodyProperty(const Napi::CallbackInfo& info) {
    return BodyObject(info.Env(), core_ ? core_->getBody() : Body{});
}

Napi::Value BrainWrap::GetMotorStateProperty(const Napi::CallbackInfo& info) {
    return MotorStateObject(info.Env(), core_ ? core_->getMotorState() : MotorState{});
}

// ── Module-level helpers ─────────────────────────────────────────────────────

Napi::Value SoundPattern(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        return TypeFailure(env, "soundPattern(text, size, length) expects a string and a number");
    }
    const std::string text = info[0].As<Napi::String>().Utf8Value();
    uint32_t size = 0;
    uint32_t length = 200;
    ReadUint32(info[1], 0, size);
    if (info.Length() >= 3) ReadUint32(info[2], 200, length);

    std::vector<uint32_t> pattern = neuropile::soundPattern(text, size, length);
    Napi::Uint32Array out = Napi::Uint32Array::New(env, pattern.size());
    if (!pattern.empty()) std::memcpy(out.Data(), pattern.data(), pattern.size() * sizeof(uint32_t));
    return out;
}

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
    EngineWrap::Init(env, exports);
    BrainWrap::Init(env, exports);
    exports.Set("soundPattern", Napi::Function::New(env, SoundPattern));
    exports.Set("native", Napi::Boolean::New(env, true));
    exports.Set("version", Napi::String::New(env, "0.1.0"));
    return exports;
}

}  // namespace

NODE_API_MODULE(neuropile_core, InitAll)
