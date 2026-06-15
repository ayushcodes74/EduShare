

(function (global) {
    "use strict";

    // ─────────────────────────────────────────────────────────────────────────
    // 0.  CONFIGURATION
    // ─────────────────────────────────────────────────────────────────────────
    const CFG = {
        // Groq endpoint — proxied through your existing Vercel function
        groqEndpoint: "/api/generate-ai",

        // How long we wait for Groq before giving up (ms)
        groqTimeoutMs: 8000,

        // Minimum confidence (0–1) from Web Speech API before showing the
        // "Did you mean?" suggestion instead of applying filters directly
        minConfidence: 0.55,

        // Debounce before triggering search after filters are filled (ms)
        searchDebounceMs: 300,

        // Supported locales tried in order (en-IN covers Hindi + Hinglish)
        speechLocales: ["en-IN", "hi-IN", "en-US"],
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 1.  CSS INJECTION  (scoped to .vs-* namespace to avoid collisions)
    // ─────────────────────────────────────────────────────────────────────────
    const VoiceSearchUI = {
        inject() {
            if (document.getElementById("vs-styles")) return;
            const s = document.createElement("style");
            s.id = "vs-styles";
            s.textContent = `
/* ── MIC BUTTON ── */
#vs-mic-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 9px 18px;
    border-radius: 14px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.02em;
    color: #fff;
    background: linear-gradient(135deg, #7c3aed, #a21caf);
    box-shadow: 0 4px 20px rgba(124, 58, 237, 0.35);
    transition: transform 0.15s, box-shadow 0.15s, background 0.2s;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
    white-space: nowrap;
    overflow: hidden;
}
#vs-mic-btn:hover  { transform: translateY(-1px); box-shadow: 0 6px 24px rgba(124,58,237,.45); }
#vs-mic-btn:active { transform: translateY(0);    box-shadow: 0 2px 10px rgba(124,58,237,.3); }
#vs-mic-btn.vs-listening {
    background: linear-gradient(135deg, #dc2626, #be185d);
    box-shadow: 0 4px 24px rgba(220, 38, 38, 0.45);
    animation: vs-pulse-btn 1.4s ease-in-out infinite;
}
#vs-mic-btn.vs-processing {
    background: linear-gradient(135deg, #4338ca, #6d28d9);
    pointer-events: none;
    opacity: 0.85;
}
#vs-mic-btn.vs-disabled {
    background: linear-gradient(135deg, #374151, #4b5563);
    cursor: not-allowed;
    box-shadow: none;
}

/* Mic icon SVG inside button */
#vs-mic-btn svg { flex-shrink: 0; transition: transform 0.15s; }
#vs-mic-btn.vs-listening svg { animation: vs-shake 0.5s ease-in-out infinite alternate; }

/* ── RIPPLE RINGS (listening state) ── */
#vs-mic-btn .vs-ring {
    position: absolute;
    inset: 0;
    border-radius: 14px;
    border: 2px solid rgba(220, 38, 38, 0.6);
    animation: vs-ring-expand 1.4s ease-out infinite;
    pointer-events: none;
}
#vs-mic-btn .vs-ring:nth-child(2) { animation-delay: 0.4s; }
#vs-mic-btn .vs-ring:nth-child(3) { animation-delay: 0.8s; }

/* ── MODAL OVERLAY ── */
#vs-modal {
    display: none;
    position: fixed;
    inset: 0;
    z-index: 9000;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(6px);
    align-items: flex-end;
    justify-content: center;
    padding: 0 0 24px;
}
#vs-modal.vs-open {
    display: flex;
    animation: vs-fade-in 0.18s ease;
}
@media (min-width: 640px) {
    #vs-modal { align-items: center; padding: 0; }
}

/* ── MODAL CARD ── */
#vs-card {
    width: min(540px, 96vw);
    border-radius: 24px;
    border: 1px solid rgba(168,85,247,0.3);
    background: rgba(11,9,31,0.97);
    backdrop-filter: blur(20px);
    box-shadow: 0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(124,58,237,0.15);
    overflow: hidden;
    animation: vs-slide-up 0.22s cubic-bezier(0.16,1,0.3,1);
}
@media (min-width: 640px) {
    #vs-card { animation: vs-pop-in 0.22s cubic-bezier(0.16,1,0.3,1); }
}

/* ── CARD HEADER ── */
#vs-card-header {
    padding: 18px 20px 14px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid rgba(168,85,247,0.12);
}
.vs-header-left { display: flex; align-items: center; gap: 10px; }
.vs-header-icon {
    width: 36px; height: 36px;
    border-radius: 10px;
    background: linear-gradient(135deg, #7c3aed, #a21caf);
    display: flex; align-items: center; justify-content: center;
    font-size: 18px;
    box-shadow: 0 0 12px rgba(124,58,237,0.4);
}
.vs-header-title  { font-size: 15px; font-weight: 800; color: #fff; }
.vs-header-sub    { font-size: 11px; color: #a78bfa; margin-top: 1px; }
#vs-close-btn {
    background: rgba(255,255,255,0.06);
    border: none;
    color: #c084fc;
    width: 32px; height: 32px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 18px;
    line-height: 1;
    transition: background 0.15s, color 0.15s;
    display: flex; align-items: center; justify-content: center;
}
#vs-close-btn:hover { background: rgba(255,255,255,0.1); color: #f472b6; }

/* ── WAVEFORM VISUALIZER ── */
#vs-visualizer {
    padding: 28px 20px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
}
.vs-wave {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 56px;
}
.vs-wave-bar {
    width: 5px;
    border-radius: 3px;
    background: linear-gradient(180deg, #a855f7, #ec4899);
    height: 8px;
    transition: height 0.1s ease;
}
/* Idle state — flat bars */
.vs-wave.vs-idle   .vs-wave-bar { height: 6px; opacity: 0.35; }
/* Listening — animated bars */
.vs-wave.vs-active .vs-wave-bar { animation: vs-bar-dance 0.9s ease-in-out infinite alternate; }
.vs-wave.vs-active .vs-wave-bar:nth-child(1)  { animation-delay: 0.00s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(2)  { animation-delay: 0.07s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(3)  { animation-delay: 0.14s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(4)  { animation-delay: 0.21s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(5)  { animation-delay: 0.28s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(6)  { animation-delay: 0.35s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(7)  { animation-delay: 0.28s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(8)  { animation-delay: 0.21s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(9)  { animation-delay: 0.14s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(10) { animation-delay: 0.07s; }
.vs-wave.vs-active .vs-wave-bar:nth-child(11) { animation-delay: 0.00s; }
/* Processing — spinner replaces wave */
.vs-wave.vs-processing .vs-wave-bar { display: none; }

.vs-status-text {
    font-size: 14px;
    font-weight: 600;
    color: #c4b5fd;
    text-align: center;
    min-height: 20px;
    transition: color 0.2s;
}
.vs-status-text.vs-error { color: #f87171; }
.vs-status-text.vs-success { color: #34d399; }

/* ── TRANSCRIPT BOX ── */
#vs-transcript-wrap {
    margin: 0 20px;
    min-height: 52px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(168,85,247,0.18);
    border-radius: 12px;
    padding: 12px 14px;
    font-size: 14px;
    color: #e2e8f0;
    font-style: italic;
    line-height: 1.5;
    word-break: break-word;
    transition: border-color 0.2s;
}
#vs-transcript-wrap.vs-has-text { border-color: rgba(168,85,247,0.35); font-style: normal; }
#vs-transcript-placeholder { color: #475569; font-style: italic; }

/* ── PARSED FILTERS DISPLAY ── */
#vs-parsed-wrap {
    margin: 14px 20px 0;
    display: none;
    flex-wrap: wrap;
    gap: 6px;
    animation: vs-fade-in 0.2s ease;
}
#vs-parsed-wrap.vs-visible { display: flex; }
.vs-tag {
    font-size: 11px;
    font-weight: 700;
    padding: 4px 10px;
    border-radius: 999px;
    border: 1px solid rgba(168,85,247,0.35);
    background: rgba(124,58,237,0.15);
    color: #c4b5fd;
    letter-spacing: 0.02em;
}
.vs-tag.vs-tag-key { color: #94a3b8; font-weight: 500; }

/* ── SUGGESTIONS ── */
#vs-suggestions {
    margin: 14px 20px 0;
    display: none;
}
#vs-suggestions.vs-visible { display: block; }
.vs-suggestions-label {
    font-size: 10px;
    font-weight: 700;
    color: #64748b;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 8px;
}
.vs-suggestion-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.vs-chip {
    font-size: 12px;
    padding: 6px 12px;
    border-radius: 10px;
    border: 1px solid rgba(168,85,247,0.25);
    background: rgba(124,58,237,0.08);
    color: #a78bfa;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    white-space: nowrap;
}
.vs-chip:hover {
    background: rgba(124,58,237,0.22);
    border-color: rgba(168,85,247,0.5);
    color: #e9d5ff;
}

/* ── ACTION BUTTONS ── */
#vs-actions {
    padding: 16px 20px 20px;
    display: flex;
    gap: 10px;
    margin-top: 6px;
}
.vs-btn {
    flex: 1;
    padding: 11px;
    border-radius: 12px;
    border: none;
    cursor: pointer;
    font-size: 13px;
    font-weight: 700;
    transition: transform 0.1s, opacity 0.15s;
}
.vs-btn:active { transform: scale(0.97); }
.vs-btn-primary {
    background: linear-gradient(135deg, #7c3aed, #a21caf);
    color: #fff;
    box-shadow: 0 4px 16px rgba(124,58,237,0.3);
}
.vs-btn-primary:hover { opacity: 0.88; }
.vs-btn-secondary {
    background: rgba(255,255,255,0.06);
    color: #c4b5fd;
    border: 1px solid rgba(168,85,247,0.2);
}
.vs-btn-secondary:hover { background: rgba(255,255,255,0.1); }
.vs-btn:disabled { opacity: 0.4; pointer-events: none; }

/* ── SPINNER (processing state in visualizer area) ── */
.vs-spinner {
    display: none;
    width: 40px; height: 40px;
    border: 3px solid rgba(168,85,247,0.2);
    border-top-color: #a855f7;
    border-radius: 50%;
    animation: vs-spin 0.7s linear infinite;
}
.vs-wave.vs-processing + .vs-spinner,
.vs-processing-spinner { display: block; }

/* ── ERROR BANNER ── */
#vs-error-banner {
    display: none;
    margin: 0 20px 14px;
    padding: 10px 14px;
    border-radius: 10px;
    background: rgba(239,68,68,0.12);
    border: 1px solid rgba(239,68,68,0.3);
    color: #fca5a5;
    font-size: 12px;
    line-height: 1.5;
    animation: vs-fade-in 0.2s ease;
}
#vs-error-banner.vs-visible { display: block; }

/* ── PERMISSION GUIDE ── */
#vs-permission-guide {
    display: none;
    margin: 0 20px 14px;
    padding: 14px;
    border-radius: 12px;
    background: rgba(251,191,36,0.08);
    border: 1px solid rgba(251,191,36,0.25);
}
#vs-permission-guide.vs-visible { display: block; }
.vs-perm-title { font-size: 13px; font-weight: 700; color: #fbbf24; margin-bottom: 6px; }
.vs-perm-steps { font-size: 12px; color: #fde68a; line-height: 1.7; }
.vs-perm-steps li { margin-left: 14px; list-style: disc; }

/* ── KEYFRAMES ── */
@keyframes vs-pulse-btn  { 0%,100% { box-shadow: 0 4px 24px rgba(220,38,38,.45); } 50% { box-shadow: 0 4px 40px rgba(220,38,38,.7); } }
@keyframes vs-ring-expand { 0% { transform: scale(1);   opacity: 0.8; } 100% { transform: scale(1.6); opacity: 0; } }
@keyframes vs-bar-dance   { 0% { height: 8px;  opacity: 0.6; } 100% { height: 46px; opacity: 1; } }
@keyframes vs-shake       { 0% { transform: rotate(-8deg); } 100% { transform: rotate(8deg); } }
@keyframes vs-fade-in     { from { opacity: 0; } to { opacity: 1; } }
@keyframes vs-slide-up    { from { transform: translateY(40px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
@keyframes vs-pop-in      { from { transform: scale(0.94); opacity: 0; } to { transform: scale(1); opacity: 1; } }
@keyframes vs-spin        { to { transform: rotate(360deg); } }
`;
            document.head.appendChild(s);
        },

        buildModal() {
            if (document.getElementById("vs-modal")) return;

            const modal = document.createElement("div");
            modal.id = "vs-modal";
            modal.setAttribute("role", "dialog");
            modal.setAttribute("aria-modal", "true");
            modal.setAttribute("aria-label", "Voice Search");
            modal.innerHTML = `
<div id="vs-card" role="document">

  <!-- HEADER -->
  <div id="vs-card-header">
    <div class="vs-header-left">
      <div class="vs-header-icon" aria-hidden="true">🎤</div>
      <div>
        <div class="vs-header-title">Voice Search</div>
        <div class="vs-header-sub">Speak in English, Hindi, or Hinglish</div>
      </div>
    </div>
    <button id="vs-close-btn" aria-label="Close voice search">✕</button>
  </div>

  <!-- WAVEFORM + STATUS -->
  <div id="vs-visualizer">
    <div class="vs-wave vs-idle" id="vs-wave" aria-hidden="true">
      ${Array.from({length: 11}, () => `<div class="vs-wave-bar"></div>`).join("")}
    </div>
    <div class="vs-spinner" id="vs-spinner" aria-hidden="true"></div>
    <div class="vs-status-text" id="vs-status">Tap the mic to start</div>
  </div>

  <!-- TRANSCRIPT -->
  <div id="vs-transcript-wrap" aria-live="polite" aria-atomic="true">
    <span id="vs-transcript-placeholder">Your speech will appear here…</span>
    <span id="vs-transcript-text" style="display:none;"></span>
  </div>

  <!-- PARSED FILTERS -->
  <div id="vs-parsed-wrap" aria-live="polite"></div>

  <!-- ERROR BANNER -->
  <div id="vs-error-banner" role="alert" aria-live="assertive"></div>

  <!-- PERMISSION GUIDE -->
  <div id="vs-permission-guide">
    <div class="vs-perm-title">⚠️ Microphone Access Needed</div>
    <ul class="vs-perm-steps">
      <li><b>Chrome / Edge:</b> Click the 🔒 lock icon → Site settings → Microphone → Allow</li>
      <li><b>Firefox:</b> Click the microphone icon in the address bar → Allow</li>
      <li><b>Safari:</b> Safari menu → Settings for This Website → Microphone → Allow</li>
      <li><b>Mobile:</b> Check device Settings → Browser → Microphone permissions</li>
    </ul>
  </div>

  <!-- QUICK SUGGESTIONS -->
  <div id="vs-suggestions">
    <div class="vs-suggestions-label">Try saying…</div>
    <div class="vs-suggestion-chips" id="vs-chips"></div>
  </div>

  <!-- ACTIONS -->
  <div id="vs-actions">
    <button class="vs-btn vs-btn-secondary" id="vs-retry-btn">🔄 Try Again</button>
    <button class="vs-btn vs-btn-primary"   id="vs-search-btn" disabled>🔍 Search</button>
  </div>

</div>`;
            document.body.appendChild(modal);
        },

        replaceLegacyButton() {
            // Find the old voice-search-btn and replace it in-place with our new button
            const old = document.getElementById("voice-search-btn");
            if (!old) return;

            const btn = document.createElement("button");
            btn.id = "vs-mic-btn";
            btn.setAttribute("aria-label", "Start voice search");
            btn.setAttribute("type", "button");
            btn.innerHTML = `
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <rect x="9" y="2" width="6" height="11" rx="3"/>
    <path d="M5 10a7 7 0 0 0 14 0"/>
    <line x1="12" y1="19" x2="12" y2="23"/>
    <line x1="8"  y1="23" x2="16" y2="23"/>
  </svg>
  <span id="vs-btn-label">Voice Search</span>`;

            old.replaceWith(btn);

            // Also hide the old voice-status span and ai-output if they exist,
            // since we now handle this inside the modal
            const oldStatus = document.getElementById("voice-status");
            const oldOutput = document.getElementById("ai-output");
            if (oldStatus) oldStatus.style.display = "none";
            if (oldOutput) oldOutput.style.display = "none";
        },

        // DOM helpers
        el(id) { return document.getElementById(id); },

        setStatus(text, cls = "") {
            const s = this.el("vs-status");
            if (!s) return;
            s.textContent = text;
            s.className = "vs-status-text" + (cls ? ` ${cls}` : "");
        },

        setWaveState(state) {
            // state: "idle" | "active" | "processing"
            const wave    = this.el("vs-wave");
            const spinner = this.el("vs-spinner");
            if (!wave) return;
            wave.className = `vs-wave vs-${state}`;
            if (spinner) spinner.style.display = state === "processing" ? "block" : "none";
        },

        setTranscript(text) {
            const wrap   = this.el("vs-transcript-wrap");
            const ph     = this.el("vs-transcript-placeholder");
            const tx     = this.el("vs-transcript-text");
            if (!wrap || !ph || !tx) return;
            if (text) {
                ph.style.display  = "none";
                tx.style.display  = "inline";
                tx.textContent    = `"${text}"`;
                wrap.classList.add("vs-has-text");
            } else {
                ph.style.display  = "inline";
                tx.style.display  = "none";
                wrap.classList.remove("vs-has-text");
            }
        },

        showParsed(filters) {
            const wrap = this.el("vs-parsed-wrap");
            if (!wrap) return;
            const entries = Object.entries(filters).filter(([, v]) => v && v !== "");
            if (entries.length === 0) {
                wrap.classList.remove("vs-visible");
                wrap.innerHTML = "";
                return;
            }
            wrap.innerHTML = entries.map(([k, v]) =>
                `<span class="vs-tag vs-tag-key">${LABEL[k] || k}:</span><span class="vs-tag">${v}</span>`
            ).join("");
            wrap.classList.add("vs-visible");
        },

        showError(msg) {
            const b = this.el("vs-error-banner");
            if (!b) return;
            b.textContent = msg;
            b.classList.add("vs-visible");
        },

        hideError() {
            const b = this.el("vs-error-banner");
            if (b) b.classList.remove("vs-visible");
        },

        showPermissionGuide() {
            const g = this.el("vs-permission-guide");
            if (g) g.classList.add("vs-visible");
        },

        hidePermissionGuide() {
            const g = this.el("vs-permission-guide");
            if (g) g.classList.remove("vs-visible");
        },

        showSuggestions(chips) {
            const wrap = this.el("vs-suggestions");
            const container = this.el("vs-chips");
            if (!wrap || !container) return;
            container.innerHTML = chips.map(c =>
                `<button class="vs-chip" type="button" data-query="${c}">${c}</button>`
            ).join("");
            wrap.classList.add("vs-visible");
        },

        hideSuggestions() {
            const wrap = this.el("vs-suggestions");
            if (wrap) wrap.classList.remove("vs-visible");
        },

        setMicBtnState(state) {
            const btn   = this.el("vs-mic-btn");
            const label = this.el("vs-btn-label");
            if (!btn) return;
            btn.className = "";
            btn.id = "vs-mic-btn";
            switch (state) {
                case "idle":
                    label && (label.textContent = "Voice Search");
                    break;
                case "listening":
                    btn.classList.add("vs-listening");
                    // Add ripple rings
                    if (!btn.querySelector(".vs-ring")) {
                        btn.insertAdjacentHTML("afterbegin",
                            `<span class="vs-ring"></span>
                             <span class="vs-ring"></span>
                             <span class="vs-ring"></span>`
                        );
                    }
                    label && (label.textContent = "Listening…");
                    break;
                case "processing":
                    btn.classList.add("vs-processing");
                    label && (label.textContent = "Processing…");
                    // Remove ripple rings
                    btn.querySelectorAll(".vs-ring").forEach(r => r.remove());
                    break;
                case "disabled":
                    btn.classList.add("vs-disabled");
                    label && (label.textContent = "Not Supported");
                    btn.querySelectorAll(".vs-ring").forEach(r => r.remove());
                    break;
            }
        },

        enableSearchBtn(on) {
            const b = this.el("vs-search-btn");
            if (b) b.disabled = !on;
        },

        openModal() {
            const m = this.el("vs-modal");
            if (m) {
                m.classList.add("vs-open");
                // Focus trap
                setTimeout(() => this.el("vs-close-btn")?.focus(), 50);
            }
        },

        closeModal() {
            const m = this.el("vs-modal");
            if (m) m.classList.remove("vs-open");
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 2.  SPEECH ENGINE
    // ─────────────────────────────────────────────────────────────────────────
    const SpeechEngine = {
        recognition: null,
        isListening: false,
        aborted: false,

        isSupported() {
            return !!(
                global.SpeechRecognition ||
                global.webkitSpeechRecognition ||
                global.mozSpeechRecognition ||
                global.msSpeechRecognition
            );
        },

        create() {
            const SR = (
                global.SpeechRecognition ||
                global.webkitSpeechRecognition ||
                global.mozSpeechRecognition ||
                global.msSpeechRecognition
            );
            const r = new SR();
            r.lang = CFG.speechLocales[0]; // en-IN covers English + Hindi + Hinglish
            r.interimResults = true;        // Show live transcript as user speaks
            r.maxAlternatives = 3;          // Let us pick best alternative
            r.continuous = false;           // Stop after first utterance (cleaner UX)
            return r;
        },

        start(onInterim, onFinal, onError) {
            if (this.isListening) this.stop();
            this.aborted = false;

            try {
                this.recognition = this.create();
            } catch (e) {
                onError({ type: "create_failed", message: e.message });
                return;
            }

            const r = this.recognition;

            r.onstart = () => { this.isListening = true; };

            r.onresult = (ev) => {
                let interim = "", final = "";
                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                    if (ev.results[i].isFinal) {
                        // Pick best alternative with highest confidence
                        let best = ev.results[i][0];
                        for (let j = 1; j < ev.results[i].length; j++) {
                            if (ev.results[i][j].confidence > best.confidence) {
                                best = ev.results[i][j];
                            }
                        }
                        final += best.transcript;
                    } else {
                        interim += ev.results[i][0].transcript;
                    }
                }
                if (interim) onInterim(interim);
                if (final)   onFinal(final, ev.results[0]?.[0]?.confidence ?? 1);
            };

            r.onerror = (ev) => {
                this.isListening = false;
                if (!this.aborted) onError(ev);
            };

            r.onend = () => { this.isListening = false; };

            try {
                r.start();
            } catch (e) {
                this.isListening = false;
                onError({ type: "start_failed", message: e.message });
            }
        },

        stop() {
            if (this.recognition) {
                this.aborted = true;
                try { this.recognition.abort(); } catch (_) {}
                this.recognition = null;
                this.isListening = false;
            }
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 3.  NLP PARSER  (local, zero-latency)
    // ─────────────────────────────────────────────────────────────────────────

    // Subject aliases (handles Hinglish abbreviations, common misspellings)
    const SUBJECT_MAP = [
        { match: /\b(dbms|database|database management|database management system|डेटाबेस)\b/i, value: "DBMS" },
        { match: /\b(os|operating system|ऑपरेटिंग सिस्टम)\b/i, value: "OS" },
        { match: /\b(cn|computer networks?|कंप्यूटर नेटवर्क)\b/i, value: "CN" },
        { match: /\b(dsa|data structures?( and algorithms?)?|डेटा स्ट्रक्चर)\b/i, value: "DSA" },
        { match: /\b(java|java programming|जावा)\b/i, value: "Java" },
        { match: /\b(oops?|object.?oriented( programming)?)\b/i, value: "OOPS" },
        { match: /\b(python|पाइथन)\b/i, value: "Python" },
        { match: /\b(c\+\+|cpp|c plus plus)\b/i, value: "C++" },
        { match: /\b(web dev(elopment)?|html|css|react|angular|vue)\b/i, value: "Web Dev" },
        { match: /\b(maths?|mathematics|engineering maths?|em|गणित)\b/i, value: "Maths" },
        { match: /\b(physics|फिजिक्स)\b/i, value: "Physics" },
        { match: /\b(chemistry|केमिस्ट्री)\b/i, value: "Chemistry" },
        { match: /\b(ai|artificial intelligence|आर्टिफिशियल इंटेलिजेंस)\b/i, value: "AI" },
        { match: /\b(ml|machine learning|मशीन लर्निंग)\b/i, value: "ML" },
        { match: /\b(se|software engineering|software engg)\b/i, value: "SE" },
        { match: /\b(cd|compiler design)\b/i, value: "CD" },
        { match: /\b(coa|computer org|computer organization)\b/i, value: "COA" },
        { match: /\b(flat|formal languages?|automata)\b/i, value: "FLAT" },
        { match: /\b(eg|engineering graphics?)\b/i, value: "EG" },
        { match: /\b(toc|theory of computation)\b/i, value: "TOC" },
    ];

    const BRANCH_MAP = [
        { match: /\b(cse|computer science|cs)\b/i, value: "CSE" },
        { match: /\b(it|information technology)\b/i, value: "IT" },
        { match: /\b(ece|electronics|electronics and communication)\b/i, value: "ECE" },
        { match: /\b(mech(anical)?|me)\b/i, value: "ME" },
        { match: /\b(civil|ce)\b/i, value: "Civil" },
        { match: /\b(eee|electrical|electrical and electronics)\b/i, value: "EEE" },
        { match: /\b(aids|ai and data science)\b/i, value: "AI&DS" },
    ];

    // Ordinal + cardinal semester patterns (English + Hindi + Hinglish)
    const SEM_PATTERNS = [
        { match: /\b(sem(ester)?\.?\s*|सेमेस्टर\s*)([1-8]|one|two|three|four|five|six|seven|eight)\b/i,
          group: 3 },
        { match: /\b([1-8])(st|nd|rd|th)?\s+sem(ester)?\b/i, group: 1 },
        { match: /\bsem(ester)?\s*([1-8])\b/i, group: 2 },
    ];

    const SEM_WORDS = { one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8 };

    const TYPE_MAP = [
        { match: /\b(pyq|pyqs|previous year|past paper|old paper|पिछले साल|old question)\b/i, value: "pyqs" },
        { match: /\b(notes?|नोट्स|handwritten|typed notes)\b/i, value: "notes" },
    ];

    const SORT_MAP = [
        { match: /\b(most downloaded|top downloaded|most popular|popular|trending)\b/i, value: "downloads" },
        { match: /\b(latest|newest|recent|new)\b/i, value: "latest" },
        { match: /\b(top rated|best|highest rated)\b/i, value: "rating" },
    ];

    // Known college name fragments (add more as needed)
    const COLLEGE_HINTS = [
        "lnct", "rgpv", "manit", "iet", "niit", "vit", "srm", "bits", "nit",
        "iit", "iise", "jecrc", "pcst", "oist", "sati", "rkdf"
    ];

    const LABEL = {
        subject: "Subject",
        branch: "Branch",
        semester: "Semester",
        college: "College",
        type: "Type",
        sort: "Sort",
    };

    const NLPParser = {
        parse(text) {
            const t   = text.toLowerCase();
            const out = {};

            // ── Subject
            for (const s of SUBJECT_MAP) {
                if (s.match.test(t)) { out.subject = s.value; break; }
            }

            // ── Branch
            for (const b of BRANCH_MAP) {
                if (b.match.test(t)) { out.branch = b.value; break; }
            }

            // ── Semester
            for (const sp of SEM_PATTERNS) {
                const m = t.match(sp.match);
                if (m) {
                    const raw = m[sp.group];
                    const num = SEM_WORDS[raw?.toLowerCase()] || parseInt(raw, 10);
                    if (num >= 1 && num <= 8) { out.semester = String(num); break; }
                }
            }

            // ── Type
            for (const tp of TYPE_MAP) {
                if (tp.match.test(t)) { out.type = tp.value; break; }
            }

            // ── Sort intent
            for (const so of SORT_MAP) {
                if (so.match.test(t)) { out.sort = so.value; break; }
            }

            // ── College (substring scan)
            for (const hint of COLLEGE_HINTS) {
                if (t.includes(hint)) {
                    // Extract the actual word from the original text preserving case
                    const rx = new RegExp(`\\b\\S*${hint}\\S*\\b`, "i");
                    const cm = text.match(rx);
                    if (cm) { out.college = cm[0].toUpperCase(); break; }
                }
            }

            return out;
        },

        isEmpty(filters) {
            return Object.keys(filters).every(k => !filters[k]);
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 4.  GROQ PARSER  (AI fallback)
    // ─────────────────────────────────────────────────────────────────────────
    const GroqParser = {
        async parse(transcript) {
            const prompt = `You are an academic search assistant for EduShare, an Indian college resource platform.

Parse the following voice query into structured search filters.
The query may be in English, Hindi, or Hinglish (mix of Hindi and English).

Voice query: "${transcript}"

Return ONLY valid JSON with this exact structure (no extra text, no markdown, no code fences):
{
  "subject": "subject name or empty string",
  "branch": "branch code like CSE, IT, ECE, ME or empty string",
  "semester": "number 1-8 or empty string",
  "college": "college name or empty string",
  "type": "notes or pyqs or empty string",
  "sort": "downloads or latest or rating or empty string",
  "confidence": 0.0 to 1.0 confidence score
}

Rules:
- subject: expand abbreviations (DBMS, OS, CN, DSA, Java, OOPS, Python, etc.)
- branch: use standard codes only (CSE, IT, ECE, ME, Civil, EEE, AI&DS)
- semester: extract any number 1-8 mentioned as "semester", "sem", "सेमेस्टर"
- type: "pyqs" for previous year papers, "notes" for study notes
- sort: "downloads" if user says "most downloaded/popular", "latest" if they say "new/recent"
- college: extract proper noun college names (LNCT, RGPV, MANIT, etc.)
- If a field is not mentioned, use empty string ""
- confidence: how sure are you that you understood the query correctly (0-1)`;

            try {
                const controller = new AbortController();
                const timeout    = setTimeout(() => controller.abort(), CFG.groqTimeoutMs);

                const res = await fetch(CFG.groqEndpoint, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ prompt }),
                    signal: controller.signal,
                });
                clearTimeout(timeout);

                if (!res.ok) throw new Error(`API ${res.status}`);
                const data = await res.json();
                if (!data.success) throw new Error(data.error || "API error");

                // Strip any accidental markdown fences
                const raw = data.text
                    .replace(/^```json\s*/i, "")
                    .replace(/^```\s*/i, "")
                    .replace(/\s*```$/i, "")
                    .trim();

                const parsed = JSON.parse(raw);
                // Remove confidence from the filter object before returning
                const { confidence, ...filters } = parsed;
                return { filters, confidence: confidence ?? 0.9 };
            } catch (e) {
                console.warn("[VoiceSearch] Groq parse failed:", e.message);
                return null; // Caller falls back to NLP results
            }
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 5.  FILTER APPLIER
    // ─────────────────────────────────────────────────────────────────────────
    const FilterApplier = {
        apply(filters) {
            // Subject
            const subjectEl = document.getElementById("subject");
            if (subjectEl && filters.subject) {
                subjectEl.value = filters.subject;
                subjectEl.dispatchEvent(new Event("input", { bubbles: true }));
            }

            // Branch
            const branchEl = document.getElementById("branch");
            if (branchEl && filters.branch) {
                branchEl.value = filters.branch;
                branchEl.dispatchEvent(new Event("input", { bubbles: true }));
            }

            // Semester
            const semEl = document.getElementById("semester");
            if (semEl && filters.semester) {
                semEl.value = filters.semester;
                semEl.dispatchEvent(new Event("change", { bubbles: true }));
            }

            // College
            const collegeEl = document.getElementById("college");
            if (collegeEl && filters.college) {
                collegeEl.value = filters.college;
                collegeEl.dispatchEvent(new Event("input", { bubbles: true }));
            }

            // Type (resource-type)
            const typeEl = document.getElementById("resource-type");
            if (typeEl && filters.type) {
                typeEl.value = filters.type;
                typeEl.dispatchEvent(new Event("change", { bubbles: true }));
            }

            // Sort — only if the page exposes a sort element
            const sortEl = document.getElementById("sort") || document.getElementById("sort-by");
            if (sortEl && filters.sort) {
                sortEl.value = filters.sort;
                sortEl.dispatchEvent(new Event("change", { bubbles: true }));
            }
        },

        triggerSearch() {
            // Try the function exposed by the main page first
            if (typeof global.fetchResources === "function") {
                global.fetchResources();
                return;
            }
            // Fallback: dispatch a custom event the page can listen to
            document.dispatchEvent(new CustomEvent("vs:search"));
        },
    };

    // ─────────────────────────────────────────────────────────────────────────
    // 6.  ORCHESTRATOR
    // ─────────────────────────────────────────────────────────────────────────
    const SUGGESTIONS = [
        "Show me DBMS notes",
        "OS PYQs semester 5",
        "Java notes CSE sem 4",
        "CN notes from LNCT",
        "Most downloaded DSA notes",
        "Python notes semester 3",
    ];

    let _state = {
        transcript: "",
        filters: {},
        phase: "idle", // idle | listening | processing | done | error
    };

    function _setPhase(p) {
        _state.phase = p;

        switch (p) {
            case "idle":
                VoiceSearchUI.setWaveState("idle");
                VoiceSearchUI.setStatus("Tap the mic to start");
                VoiceSearchUI.setMicBtnState("idle");
                VoiceSearchUI.enableSearchBtn(false);
                VoiceSearchUI.showSuggestions(SUGGESTIONS);
                break;

            case "listening":
                VoiceSearchUI.setWaveState("active");
                VoiceSearchUI.setStatus("🎤 Listening… speak now");
                VoiceSearchUI.setMicBtnState("listening");
                VoiceSearchUI.enableSearchBtn(false);
                VoiceSearchUI.hideError();
                VoiceSearchUI.hidePermissionGuide();
                VoiceSearchUI.hideSuggestions();
                break;

            case "processing":
                VoiceSearchUI.setWaveState("processing");
                VoiceSearchUI.setStatus("✨ Understanding your query…");
                VoiceSearchUI.setMicBtnState("processing");
                VoiceSearchUI.enableSearchBtn(false);
                break;

            case "done":
                VoiceSearchUI.setWaveState("idle");
                VoiceSearchUI.setStatus("✅ Filters applied!", "vs-success");
                VoiceSearchUI.setMicBtnState("idle");
                VoiceSearchUI.enableSearchBtn(true);
                break;

            case "error":
                VoiceSearchUI.setWaveState("idle");
                VoiceSearchUI.setMicBtnState("idle");
                VoiceSearchUI.enableSearchBtn(false);
                break;
        }
    }

    async function _handleFinalTranscript(transcript, confidence) {
        _state.transcript = transcript;
        VoiceSearchUI.setTranscript(transcript);
        _setPhase("processing");

        // 1. Fast local NLP parse
        let filters = NLPParser.parse(transcript);

        // 2. If local parse found nothing (or only 1 weak signal), try Groq
        const localSignals = Object.values(filters).filter(v => v).length;

        if (localSignals === 0) {
            const groqResult = await GroqParser.parse(transcript);
            if (groqResult && !NLPParser.isEmpty(groqResult.filters)) {
                filters = groqResult.filters;
            }
        }

        _state.filters = filters;
        VoiceSearchUI.showParsed(filters);

        if (NLPParser.isEmpty(filters)) {
            _setPhase("error");
            VoiceSearchUI.setStatus("Couldn't parse your query", "vs-error");
            VoiceSearchUI.showError(
                "We couldn't detect a subject, semester, or branch in your query. " +
                "Try saying something like \"Show me DBMS notes CSE semester 5\"."
            );
            VoiceSearchUI.showSuggestions(SUGGESTIONS);
            return;
        }

        _setPhase("done");

        // Auto-apply after short delay so user can see what was parsed
        setTimeout(() => {
            FilterApplier.apply(_state.filters);
            setTimeout(() => {
                FilterApplier.triggerSearch();
                VoiceSearchUI.closeModal();
                _setPhase("idle");
            }, CFG.searchDebounceMs);
        }, 700);
    }

    function _startListening() {
        if (!SpeechEngine.isSupported()) {
            _setPhase("error");
            VoiceSearchUI.setStatus("Browser not supported", "vs-error");
            VoiceSearchUI.showError(
                "Your browser doesn't support the Web Speech API. " +
                "Please use Chrome, Edge, or Safari on desktop/Android."
            );
            return;
        }

        _setPhase("listening");
        VoiceSearchUI.setTranscript("");
        VoiceSearchUI.showParsed({});
        VoiceSearchUI.hideError();

        SpeechEngine.start(
            // onInterim — show live transcript
            (interim) => {
                VoiceSearchUI.setTranscript(interim + "…");
            },
            // onFinal
            (final, confidence) => {
                _handleFinalTranscript(final, confidence);
            },
            // onError
            (err) => {
                _setPhase("error");
                if (err.error === "not-allowed" || err.type === "not-allowed") {
                    VoiceSearchUI.setStatus("Microphone permission denied", "vs-error");
                    VoiceSearchUI.showError(
                        "Microphone access was denied. Please allow microphone access and try again."
                    );
                    VoiceSearchUI.showPermissionGuide();
                } else if (err.error === "no-speech" || err.type === "no-speech") {
                    VoiceSearchUI.setStatus("No speech detected", "vs-error");
                    VoiceSearchUI.showError(
                        "No speech was detected. Please try again and speak clearly."
                    );
                    VoiceSearchUI.showSuggestions(SUGGESTIONS);
                } else if (err.error === "network" || err.type === "network") {
                    VoiceSearchUI.setStatus("Network error", "vs-error");
                    VoiceSearchUI.showError(
                        "Speech recognition requires an internet connection. Please check your network."
                    );
                } else if (err.error === "aborted") {
                    // User closed modal or pressed retry — silent
                    _setPhase("idle");
                } else {
                    VoiceSearchUI.setStatus("Something went wrong", "vs-error");
                    VoiceSearchUI.showError(
                        `Speech error: ${err.error || err.message || "unknown"}. Please try again.`
                    );
                    VoiceSearchUI.showSuggestions(SUGGESTIONS);
                }
            }
        );
    }

    function _bindEvents() {
        // Open modal from mic button (replaces old voice-search-btn)
        document.addEventListener("click", (e) => {
            const btn = e.target.closest("#vs-mic-btn");
            if (btn) {
                VoiceSearch.open();
            }
        });

        // Close modal
        document.addEventListener("click", (e) => {
            if (e.target.id === "vs-close-btn" || e.target.closest("#vs-close-btn")) {
                SpeechEngine.stop();
                VoiceSearch.close();
            }
            // Click backdrop to close
            if (e.target.id === "vs-modal") {
                SpeechEngine.stop();
                VoiceSearch.close();
            }
        });

        // Retry button
        document.addEventListener("click", (e) => {
            if (e.target.id === "vs-retry-btn" || e.target.closest("#vs-retry-btn")) {
                VoiceSearchUI.hideError();
                VoiceSearchUI.hidePermissionGuide();
                VoiceSearchUI.setTranscript("");
                VoiceSearchUI.showParsed({});
                _startListening();
            }
        });

        // Manual search button (if user wants to review before searching)
        document.addEventListener("click", (e) => {
            if (e.target.id === "vs-search-btn" || e.target.closest("#vs-search-btn")) {
                FilterApplier.apply(_state.filters);
                FilterApplier.triggerSearch();
                VoiceSearch.close();
                _setPhase("idle");
            }
        });

        // Suggestion chips
        document.addEventListener("click", (e) => {
            const chip = e.target.closest(".vs-chip");
            if (chip) {
                const query = chip.dataset.query;
                if (query) {
                    VoiceSearchUI.setTranscript(query);
                    _handleFinalTranscript(query, 1.0);
                }
            }
        });

        // Keyboard: Escape closes modal
        document.addEventListener("keydown", (e) => {
            if (e.key === "Escape" && _state.phase !== "idle") {
                SpeechEngine.stop();
                VoiceSearch.close();
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 7.  PUBLIC API
    // ─────────────────────────────────────────────────────────────────────────
    const VoiceSearch = {
        init() {
            // Inject CSS
            VoiceSearchUI.inject();

            // Wait for DOM ready
            const run = () => {
                VoiceSearchUI.buildModal();
                VoiceSearchUI.replaceLegacyButton();
                _bindEvents();

                // If speech not supported, disable button
                if (!SpeechEngine.isSupported()) {
                    VoiceSearchUI.setMicBtnState("disabled");
                    const btn = document.getElementById("vs-mic-btn");
                    if (btn) {
                        btn.setAttribute("title", "Web Speech API is not supported in this browser");
                        btn.setAttribute("aria-disabled", "true");
                    }
                }

                // Show suggestions immediately in modal
                VoiceSearchUI.showSuggestions(SUGGESTIONS);

                console.log("[VoiceSearch] Initialized ✓");
            };

            if (document.readyState === "loading") {
                document.addEventListener("DOMContentLoaded", run);
            } else {
                run();
            }
        },

        open() {
            VoiceSearchUI.openModal();
            // Reset state
            _setPhase("idle");
            VoiceSearchUI.setTranscript("");
            VoiceSearchUI.showParsed({});
            VoiceSearchUI.hideError();
            VoiceSearchUI.hidePermissionGuide();
            VoiceSearchUI.showSuggestions(SUGGESTIONS);
            // Auto-start listening
            setTimeout(_startListening, 250);
        },

        close() {
            VoiceSearchUI.closeModal();
            SpeechEngine.stop();
            _setPhase("idle");
        },

        // Programmatically process a text query (useful for testing / chips)
        parseText(text) {
            return NLPParser.parse(text);
        },
    };

    // Expose globally
    global.VoiceSearch = VoiceSearch;

})(window);