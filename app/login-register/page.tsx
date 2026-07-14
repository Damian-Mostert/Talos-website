'use client';

import { useState, useEffect, useRef } from "react";

const STYLES = `
  #stage * { box-sizing: border-box; }
  #stage {
    --bg:        #181224;
    --surface:   #130d1e;
    --surface-2: #1b1329;
    --border:    #29203a;
    --text:      #ddd4ea;
    --dim:       #6d6182;
    --accent:    #8fb8e0;
    --ink:       #0c0714;
    --dot:       #2a1f3d;
    --face-grad-1: #201830;
    --face-grad-2: #0c0714;
    --face-stroke: #2c2244;
    --eye-white:   #160f22;
    --mouth-hole:  #0b0710;
    --rainbow: linear-gradient(120deg, #ff6b6b, #ffd166, #6ee7b7, #7ee8c1, #8fb8e0, #c9a6ff, #ff6b6b);
    --pulse: 0;
    width: 100%;
    min-height: 100vh;
    display: grid;
    grid-template-columns: 1.05fr 1fr;
    font-family: 'Inter', sans-serif;
    background: var(--bg);
    color: var(--text);
    transition: background .4s ease;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  @keyframes fadeUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
  @keyframes wiggle { 0%, 100% { rotate: -1.6deg; } 50% { rotate: 1.6deg; } }
  @keyframes rainbow-shift { 0% { background-position: 0% 50%; } 50% { background-position: 100% 50%; } 100% { background-position: 0% 50%; } }
  @keyframes sparkle-out { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--dx), var(--dy)) scale(0); opacity: 0; } }

  #presence {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 28px;
    background:
      radial-gradient(circle at 1px 1px, var(--dot) 1px, transparent 0) 0 0/24px 24px,
      var(--surface);
    border-right: 1px solid var(--border);
    padding: 40px;
    overflow: hidden;
  }
  #presence::before {
    content: '';
    position: absolute;
    inset: 0;
    background: radial-gradient(ellipse 60% 50% at 50% 38%, color-mix(in srgb, var(--accent) 14%, transparent), transparent 70%);
    transition: background 1.2s ease;
    pointer-events: none;
  }
  #brand-mark {
    position: absolute; top: 36px; left: 40px;
    font-family: 'Fraunces', serif; font-style: italic; font-weight: 500; font-size: 15px;
    letter-spacing: .02em; color: var(--dim);
    display: flex; align-items: center; gap: 8px;
  }
  #brand-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); transition: background .8s ease; }

  #avatar-wrap { position: relative; width: 220px; height: 220px; animation: wiggle 7s ease-in-out infinite; }
  @media (prefers-reduced-motion: reduce) { #avatar-wrap { animation: none; } }

  #rainbow-ring {
    position: absolute; inset: -18px; border-radius: 50%;
    background: var(--rainbow); background-size: 300% 300%;
    -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
    mask: radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 3px));
    animation: spin 8s linear infinite;
    opacity: .32;
    transition: opacity .5s ease, filter .3s ease;
  }

  #glow {
    position: absolute; inset: -30px; border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--accent) 30%, transparent) 0%, transparent 70%);
    transition: background 1.2s ease;
    pointer-events: none;
  }

  #avatar { width: 220px; height: 220px; position: relative; }
  .pupil { transition: transform .16s ease; }
  .eye { transition: ry .35s ease; fill: var(--eye-white); }
  .brow { transition: d .4s ease, opacity .4s ease; }
  .mouth { transition: d .4s ease, stroke .5s ease; }
  .head { stroke: var(--face-stroke); transition: stroke .35s ease; }
  .face-stop-1 { stop-color: var(--face-grad-1); transition: stop-color .35s ease; }
  .face-stop-2 { stop-color: var(--face-grad-2); transition: stop-color .35s ease; }

  #mood-col { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  #mood-label { font-family: 'Fraunces', serif; font-style: italic; font-weight: 500; font-size: 21px; color: var(--accent); transition: color .8s ease; }
  #mood-sub { font-family: 'IBM Plex Mono', monospace; font-size: 10.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }

  #signal { width: 240px; display: flex; flex-direction: column; gap: 9px; }
  .sig-row { display: flex; align-items: center; gap: 10px; }
  .sig-label { font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); width: 64px; flex-shrink: 0; }
  .sig-track { flex: 1; height: 3px; background: var(--border); border-radius: 2px; overflow: hidden; }
  .sig-fill { height: 100%; border-radius: 2px; background: var(--accent); transition: width .9s cubic-bezier(.4,0,.2,1), background .8s ease; }

  #presence-caption { max-width: 300px; text-align: center; font-size: 13px; line-height: 1.6; color: var(--dim); transition: color .5s ease; }

  #form-col { display: flex; flex-direction: column; justify-content: center; padding: 56px 64px; position: relative; }
  #form-wrap { width: 100%; max-width: 360px; margin: 0 auto; }
  .view-enter { animation: fadeUp .5s cubic-bezier(.2,.8,.3,1.1); }

  .eyebrow {
    font-family: 'IBM Plex Mono', monospace; font-size: 9.5px; font-weight: 500; letter-spacing: .18em;
    text-transform: uppercase; color: var(--dim);
    display: flex; align-items: center; gap: 8px; margin-bottom: 22px;
  }
  .eyebrow::after { content: ''; flex: 1; height: 1px; background: var(--border); }

  .h1 { font-family: 'Fraunces', serif; font-style: italic; font-weight: 500; font-size: 30px; line-height: 1.2; margin-bottom: 8px; }
  .tagline { font-size: 13.5px; color: var(--dim); margin-bottom: 30px; line-height: 1.5; }

  .fields { display: flex; flex-direction: column; gap: 16px; }
  .field { display: flex; flex-direction: column; gap: 7px; }
  .field label { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--dim); }

  .input-wrap { border-radius: 12px; padding: 1.5px; background: var(--border); transition: background .25s ease; position: relative; }
  .input-wrap.focused { background: var(--rainbow); background-size: 300% 300%; animation: rainbow-shift 4s ease infinite; }
  .input-wrap input {
    width: 100%; background: var(--surface-2); border: none; border-radius: 10.5px;
    padding: 12px 14px; color: var(--text); font-family: 'Inter', sans-serif; font-size: 14px; outline: none;
  }
  .input-wrap input::placeholder { color: var(--dim); }

  .pw-row { display: flex; align-items: center; background: var(--surface-2); border-radius: 10.5px; }
  .pw-row input { flex: 1; background: transparent; }
  .pw-toggle {
    background: none; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center;
    width: 40px; height: 40px; color: var(--dim); flex-shrink: 0; margin-right: 4px;
  }
  .pw-toggle svg { width: 17px; height: 17px; stroke: currentColor; fill: none; stroke-width: 1.7; }

  .row-between { display: flex; justify-content: flex-end; margin-top: -6px; }
  .row-between a, .back-link { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: var(--dim); text-decoration: none; cursor: pointer; background: none; border: none; }
  .row-between a:hover, .back-link:hover { color: var(--accent); }

  .submit-btn {
    position: relative; margin-top: 6px; border: none; border-radius: 12px; padding: 13px;
    font-family: 'Inter', sans-serif; font-weight: 600; font-size: 14px; color: var(--ink);
    background: var(--accent); cursor: pointer; width: 100%;
    display: flex; align-items: center; justify-content: center; gap: 9px;
    transition: background .5s ease, transform .1s ease; overflow: hidden;
  }
  .submit-btn:active { transform: scale(.98); }
  .submit-btn .ring {
    width: 14px; height: 14px; border-radius: 50%;
    border: 2px solid rgba(255,255,255,.4); border-top-color: #fff;
    animation: spin .7s linear infinite; display: none;
  }
  .submit-btn.loading .ring { display: block; }
  .submit-btn.loading .label { opacity: .75; }

  .divider { display: flex; align-items: center; gap: 12px; margin: 22px 0 18px; }
  .divider::before, .divider::after { content: ''; flex: 1; height: 1px; background: var(--border); }
  .divider span { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: .1em; text-transform: uppercase; color: var(--dim); }

  .google-btn {
    border: 1px solid var(--border); border-radius: 12px; background: var(--surface-2);
    padding: 12px; width: 100%; display: flex; align-items: center; justify-content: center; gap: 10px;
    font-family: 'Inter', sans-serif; font-weight: 500; font-size: 14px; color: var(--text);
    cursor: pointer; transition: border-color .2s ease, transform .1s ease, background .2s ease;
  }
  .google-btn:hover { border-color: color-mix(in srgb, var(--accent) 45%, var(--border)); background: color-mix(in srgb, var(--accent) 6%, var(--surface-2)); }
  .google-btn:active { transform: scale(.98); }
  .google-btn svg { width: 18px; height: 18px; flex-shrink: 0; }

  .footer-line { margin-top: 26px; text-align: center; font-size: 12.5px; color: var(--dim); }
  .footer-line a { color: var(--accent); text-decoration: none; font-weight: 500; cursor: pointer; }
  .footer-line a:hover { text-decoration: underline; }

  #toast {
    position: fixed; bottom: 28px; left: 50%; transform: translate(-50%, 20px);
    background: var(--surface-2); border: 1px solid var(--border); border-left: 2px solid var(--accent);
    border-radius: 12px; padding: 11px 20px; font-family: 'IBM Plex Mono', monospace; font-size: 12px;
    color: var(--text); opacity: 0; pointer-events: none; transition: opacity .3s ease, transform .3s ease; z-index: 20;
  }
  #toast.show { opacity: 1; transform: translate(-50%, 0); }

  .sparkle {
    position: fixed; width: 5px; height: 5px; border-radius: 50%; pointer-events: none; z-index: 30;
    box-shadow: 0 0 6px currentColor; animation: sparkle-out .6s ease-out forwards;
  }

  .sent-box {
    display: flex; flex-direction: column; align-items: flex-start; gap: 14px;
    background: var(--surface-2); border: 1px solid var(--border); border-left: 2px solid var(--accent);
    border-radius: 12px; padding: 18px; font-size: 13.5px; line-height: 1.6; color: var(--dim);
  }
  .sent-box strong { color: var(--text); }

  .plan-grid { display: flex; flex-direction: column; gap: 12px; margin-bottom: 20px; }
  .plan-card {
    position: relative; border-radius: 14px; padding: 1.5px; background: var(--border);
    transition: background .25s ease; cursor: pointer;
  }
  .plan-card.selected { background: var(--rainbow); background-size: 300% 300%; animation: rainbow-shift 4s ease infinite; }
  .plan-card-inner {
    background: var(--surface-2); border-radius: 12.5px; padding: 16px 18px;
    display: flex; align-items: center; justify-content: space-between; gap: 10px;
  }
  .plan-name { font-family: 'Fraunces', serif; font-style: italic; font-weight: 500; font-size: 16px; color: var(--text); }
  .plan-desc { font-size: 11.5px; color: var(--dim); margin-top: 3px; }
  .plan-price { font-family: 'IBM Plex Mono', monospace; font-size: 13px; color: var(--accent); text-align: right; white-space: nowrap; }
  .plan-price span { display: block; font-size: 9px; color: var(--dim); letter-spacing: .06em; text-transform: uppercase; margin-top: 2px; }
  .plan-radio {
    width: 16px; height: 16px; border-radius: 50%; border: 1.5px solid var(--border); flex-shrink: 0;
    display: flex; align-items: center; justify-content: center; transition: border-color .2s ease; position: relative;
  }
  .plan-card.selected .plan-radio { border-color: var(--accent); }
  .plan-radio::after {
    content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--accent);
    transform: scale(0); transition: transform .2s ease; position: absolute;
  }
  .plan-card.selected .plan-radio::after { transform: scale(1); }

  @media (max-width: 860px) {
    #stage { grid-template-columns: 1fr; }
    #presence { display: none; }
    #form-col { padding: 40px 28px; }
  }
`;

const MOODS = {
  login:    { label: "Welcome back",     sub: "Session · Awaiting sign in", accent: "#8fb8e0", caption: "One account, everywhere you work. It's waiting right where you left it.", eyeRy: 12, browOpacity: 1,   mouth: "M84 142 Q110 156 136 142", signal: [70, 55, 40] },
  register: { label: "Nice to meet you", sub: "Session · Creating account",  accent: "#c9a6ff", caption: "A few details and you're in. We keep it short on purpose.",                eyeRy: 13, browOpacity: 1,   mouth: "M84 140 Q110 158 136 140", signal: [55, 60, 75] },
  forgot:   { label: "No worries",       sub: "Session · Resetting access", accent: "#ffd166", caption: "It happens to everyone. We'll get you a new link in a moment.",            eyeRy: 10, browOpacity: .6,  mouth: "M88 144 Q110 150 132 144", signal: [80, 35, 30] },
  sent:     { label: "On its way",       sub: "Session · Link sent",        accent: "#7ee8c1", caption: "Check your inbox — the link should land any second now.",                 eyeRy: 12, browOpacity: 1,   mouth: "M84 140 Q110 158 136 140", signal: [90, 50, 65] },
  plan:     { label: "Pick your fit",    sub: "Session · Almost there",     accent: "#f2a6c9", caption: "You're in. Just pick a plan and you're off.",                              eyeRy: 13, browOpacity: 1,   mouth: "M82 138 Q110 162 138 138", signal: [65, 70, 95] },
};

const PLANS = [
  { id: "free", name: "Starter", desc: "For trying things out", price: "$0", period: "/month" },
  { id: "pro",  name: "Pro",     desc: "For everyday work",      price: "$12", period: "/month" },
  { id: "team", name: "Team",    desc: "For working together",  price: "$9", period: "/seat" },
];

function EyeIcon() {
  return (
    <svg viewBox="0 0 24 24"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
  );
}
function EyeOffIcon() {
  return (
    <svg viewBox="0 0 24 24">
      <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.4 10.4 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24" stroke="currentColor" fill="none" strokeWidth="1.7"/>
      <path d="M1 1l22 22" stroke="currentColor" strokeWidth="1.7"/>
    </svg>
  );
}
function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24"><path fill="#EA4335" d="M12 10.2v3.9h5.5c-.24 1.28-1.7 3.75-5.5 3.75-3.31 0-6.02-2.74-6.02-6.12S8.69 5.6 12 5.6c1.89 0 3.16.8 3.88 1.49l2.65-2.55C16.9 2.9 14.65 2 12 2 6.9 2 2.77 6.13 2.77 11.23S6.9 20.45 12 20.45c6.93 0 9.4-4.87 9.4-7.4 0-.5-.05-.87-.12-1.25H12z"/></svg>
  );
}

function TextField({ label, type = "text", placeholder, value, onChange, onFocus, onBlur, focused, showToggle, revealed, onToggleReveal }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className={`input-wrap${focused ? " focused" : ""}`}>
        {showToggle ? (
          <div className="pw-row">
            <input
              type={revealed ? "text" : "password"}
              placeholder={placeholder}
              value={value}
              onChange={onChange}
              onFocus={onFocus}
              onBlur={onBlur}
            />
            <button type="button" className="pw-toggle" aria-label="Show password" onClick={onToggleReveal}>
              {revealed ? <EyeOffIcon /> : <EyeIcon />}
            </button>
          </div>
        ) : (
          <input
            type={type}
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            onFocus={onFocus}
            onBlur={onBlur}
          />
        )}
      </div>
    </div>
  );
}

export default function AuthFlow() {
  const [view, setView] = useState("login");
  const [focusedField, setFocusedField] = useState(null);
  const [revealed, setRevealed] = useState({ login: false, register: false });
  const [loadingBtn, setLoadingBtn] = useState(null);
  const [toast, setToast] = useState({ show: false, msg: "" });
  const [sparkles, setSparkles] = useState([]);
  const [pupilOffset, setPupilOffset] = useState({ x: 0, y: 0 });
  const [selectedPlan, setSelectedPlan] = useState("pro");

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [registerForm, setRegisterForm] = useState({ name: "", email: "", password: "" });
  const [forgotEmail, setForgotEmail] = useState("");
  const [sentTo, setSentTo] = useState("");

  const stageRef = useRef(null);
  const toastTimer = useRef(null);

  useEffect(() => {
    function handleMove(e) {
      const rect = stageRef.current ? stageRef.current.getBoundingClientRect() : { width: window.innerWidth, height: window.innerHeight, left: 0, top: 0 };
      const dx = ((e.clientX - rect.left) / rect.width - 0.5) * 6;
      const dy = ((e.clientY - rect.top) / rect.height - 0.5) * 4;
      setPupilOffset({ x: dx, y: dy });
    }
    window.addEventListener("mousemove", handleMove);
    return () => window.removeEventListener("mousemove", handleMove);
  }, []);

  const mood = MOODS[view];

  function showToast(msg) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ show: true, msg });
    toastTimer.current = setTimeout(() => setToast({ show: false, msg: "" }), 2600);
  }

  function burstSparkles(x, y, color) {
    const colors = ["#ff6b6b", "#ffd166", "#6ee7b7", "#8fb8e0", "#c9a6ff"];
    const items = Array.from({ length: 10 }).map((_, i) => {
      const angle = Math.random() * Math.PI * 2;
      const dist = 30 + Math.random() * 40;
      return {
        id: `${Date.now()}-${i}`,
        x, y,
        dx: Math.cos(angle) * dist,
        dy: Math.sin(angle) * dist,
        color: color || colors[i % colors.length],
      };
    });
    setSparkles((prev) => [...prev, ...items]);
    setTimeout(() => {
      setSparkles((prev) => prev.filter((s) => !items.some((it) => it.id === s.id)));
    }, 650);
  }

  function runSubmit(key, rect, after) {
    burstSparkles(rect.left + rect.width / 2, rect.top, mood.accent);
    setLoadingBtn(key);
    setTimeout(() => {
      setLoadingBtn(null);
      after();
    }, 900);
  }

  function handleLoginSubmit(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    runSubmit("login", rect, () => setView("plan"));
  }
  function handleRegisterSubmit(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    runSubmit("register", rect, () => setView("plan"));
  }
  function handleForgotSubmit(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    runSubmit("forgot", rect, () => {
      setSentTo(forgotEmail || "your inbox");
      setView("sent");
    });
  }
  function handleGoogle(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    burstSparkles(rect.left + rect.width / 2, rect.top, "#8fb8e0");
    showToast("Continuing with Google…");
    setTimeout(() => setView("plan"), 700);
  }
  function handlePlanContinue(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    runSubmit("plan", rect, () => {
      const plan = PLANS.find((p) => p.id === selectedPlan);
      showToast(`Welcome to Nimbus — ${plan.name} plan activated.`);
    });
  }

  return (
    <>
      <style>{STYLES}</style>
      <div id="stage" ref={stageRef}>
        <div id="presence">
          <div id="brand-mark"><span id="brand-dot"></span>Nimbus</div>

          <div id="avatar-wrap">
            <div id="rainbow-ring"></div>
            <div id="glow"></div>
            <svg id="avatar" viewBox="0 0 220 220" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <radialGradient id="faceGrad" cx="50%" cy="38%" r="72%">
                  <stop className="face-stop-1" offset="0%" />
                  <stop className="face-stop-2" offset="100%" />
                </radialGradient>
              </defs>
              <circle className="head" cx="110" cy="110" r="88" fill="url(#faceGrad)" strokeWidth="1.5" />
              <path className="brow" d="M68 80 Q80 71 94 78" stroke="var(--dim)" strokeWidth="3" fill="none" strokeLinecap="round" style={{ opacity: mood.browOpacity }} />
              <path className="brow" d="M126 78 Q140 71 152 80" stroke="var(--dim)" strokeWidth="3" fill="none" strokeLinecap="round" style={{ opacity: mood.browOpacity }} />
              <ellipse className="eye" cx="82" cy="106" rx="9" ry={mood.eyeRy} />
              <ellipse className="eye" cx="138" cy="106" rx="9" ry={mood.eyeRy} />
              <circle className="pupil" cx="82" cy="109" r="4" fill="var(--accent)" style={{ transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)` }} />
              <circle className="pupil" cx="138" cy="109" r="4" fill="var(--accent)" style={{ transform: `translate(${pupilOffset.x}px, ${pupilOffset.y}px)` }} />
              <path className="mouth" d={mood.mouth} stroke="var(--mouth-hole)" strokeWidth="6" fill="none" strokeLinecap="round" />
            </svg>
          </div>

          <div id="mood-col">
            <div id="mood-label" style={{ color: mood.accent }}>{mood.label}</div>
            <div id="mood-sub">{mood.sub}</div>
          </div>

          <div id="signal">
            <div className="sig-row"><span className="sig-label">Trust</span><div className="sig-track"><div className="sig-fill" style={{ width: mood.signal[0] + "%", background: mood.accent }}></div></div></div>
            <div className="sig-row"><span className="sig-label">Speed</span><div className="sig-track"><div className="sig-fill" style={{ width: mood.signal[1] + "%", background: mood.accent }}></div></div></div>
            <div className="sig-row"><span className="sig-label">Delight</span><div className="sig-track"><div className="sig-fill" style={{ width: mood.signal[2] + "%", background: mood.accent }}></div></div></div>
          </div>

          <p id="presence-caption">{mood.caption}</p>
        </div>

        <div id="form-col">
          <div id="form-wrap">

            {view === "login" && (
              <div className="view-enter" key="login">
                <div className="eyebrow">Access</div>
                <div className="h1">Good to see you.</div>
                <p className="tagline">Log in to pick up right where you left off.</p>
                <div className="fields">
                  <TextField
                    label="Email" type="email" placeholder="you@domain.com"
                    value={loginForm.email}
                    onChange={(e) => setLoginForm({ ...loginForm, email: e.target.value })}
                    onFocus={() => setFocusedField("login-email")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "login-email"}
                  />
                  <TextField
                    label="Password" placeholder="••••••••" showToggle
                    value={loginForm.password}
                    onChange={(e) => setLoginForm({ ...loginForm, password: e.target.value })}
                    onFocus={() => setFocusedField("login-password")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "login-password"}
                    revealed={revealed.login}
                    onToggleReveal={() => setRevealed({ ...revealed, login: !revealed.login })}
                  />
                  <div className="row-between"><a onClick={() => setView("forgot")}>Forgot password?</a></div>
                  <button className={`submit-btn${loadingBtn === "login" ? " loading" : ""}`} onClick={handleLoginSubmit}>
                    <span className="ring"></span><span className="label">Log in</span>
                  </button>
                </div>
                <div className="divider"><span>or</span></div>
                <button className="google-btn" onClick={handleGoogle}><GoogleIcon /> Continue with Google</button>
                <p className="footer-line">New here? <a onClick={() => setView("register")}>Create an account</a></p>
              </div>
            )}

            {view === "register" && (
              <div className="view-enter" key="register">
                <div className="eyebrow">New account</div>
                <div className="h1">Let's set you up.</div>
                <p className="tagline">Takes about thirty seconds, no credit card yet.</p>
                <div className="fields">
                  <TextField
                    label="Name" placeholder="Your name"
                    value={registerForm.name}
                    onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                    onFocus={() => setFocusedField("reg-name")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "reg-name"}
                  />
                  <TextField
                    label="Email" type="email" placeholder="you@domain.com"
                    value={registerForm.email}
                    onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                    onFocus={() => setFocusedField("reg-email")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "reg-email"}
                  />
                  <TextField
                    label="Password" placeholder="Create a password" showToggle
                    value={registerForm.password}
                    onChange={(e) => setRegisterForm({ ...registerForm, password: e.target.value })}
                    onFocus={() => setFocusedField("reg-password")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "reg-password"}
                    revealed={revealed.register}
                    onToggleReveal={() => setRevealed({ ...revealed, register: !revealed.register })}
                  />
                  <button className={`submit-btn${loadingBtn === "register" ? " loading" : ""}`} onClick={handleRegisterSubmit}>
                    <span className="ring"></span><span className="label">Create account</span>
                  </button>
                </div>
                <div className="divider"><span>or</span></div>
                <button className="google-btn" onClick={handleGoogle}><GoogleIcon /> Continue with Google</button>
                <p className="footer-line">Already have an account? <a onClick={() => setView("login")}>Log in</a></p>
              </div>
            )}

            {view === "forgot" && (
              <div className="view-enter" key="forgot">
                <div className="eyebrow">Reset</div>
                <div className="h1">It happens.</div>
                <p className="tagline">Enter your email and we'll send a reset link.</p>
                <div className="fields">
                  <TextField
                    label="Email" type="email" placeholder="you@domain.com"
                    value={forgotEmail}
                    onChange={(e) => setForgotEmail(e.target.value)}
                    onFocus={() => setFocusedField("forgot-email")} onBlur={() => setFocusedField(null)}
                    focused={focusedField === "forgot-email"}
                  />
                  <button className={`submit-btn${loadingBtn === "forgot" ? " loading" : ""}`} onClick={handleForgotSubmit}>
                    <span className="ring"></span><span className="label">Send reset link</span>
                  </button>
                </div>
                <p className="footer-line"><a className="back-link" onClick={() => setView("login")}>Back to log in</a></p>
              </div>
            )}

            {view === "sent" && (
              <div className="view-enter" key="sent">
                <div className="eyebrow">Reset</div>
                <div className="h1">Check your inbox.</div>
                <div className="sent-box">
                  <div>We've sent a reset link to <strong>{sentTo}</strong>. It'll expire in an hour, so use it soon.</div>
                  <div>Didn't get it? Check spam, or <a className="back-link" style={{ color: "var(--accent)" }} onClick={() => setView("forgot")}>try another address</a>.</div>
                </div>
                <p className="footer-line"><a className="back-link" onClick={() => setView("login")}>Back to log in</a></p>
              </div>
            )}

            {view === "plan" && (
              <div className="view-enter" key="plan">
                <div className="eyebrow">Last step</div>
                <div className="h1">Pick your fit.</div>
                <p className="tagline">Start anywhere — you can change this later.</p>
                <div className="plan-grid">
                  {PLANS.map((p) => (
                    <div key={p.id} className={`plan-card${selectedPlan === p.id ? " selected" : ""}`} onClick={() => setSelectedPlan(p.id)}>
                      <div className="plan-card-inner">
                        <div>
                          <div className="plan-name">{p.name}</div>
                          <div className="plan-desc">{p.desc}</div>
                        </div>
                        <div className="plan-radio"></div>
                        <div className="plan-price">{p.price}<span>{p.period}</span></div>
                      </div>
                    </div>
                  ))}
                </div>
                <button className={`submit-btn${loadingBtn === "plan" ? " loading" : ""}`} onClick={handlePlanContinue}>
                  <span className="ring"></span><span className="label">Continue</span>
                </button>
              </div>
            )}

          </div>
        </div>
      </div>

      {sparkles.map((s) => (
        <div key={s.id} className="sparkle" style={{ left: s.x, top: s.y, color: s.color, "--dx": s.dx + "px", "--dy": s.dy + "px" }} />
      ))}

      <div id="toast" className={toast.show ? "show" : ""}>{toast.msg}</div>
    </>
  );
}