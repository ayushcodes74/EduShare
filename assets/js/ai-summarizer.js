/**
 * EduShare AI Study Assistant & Notes Summarizer
 * Handles PDF text extraction, Groq API calls, Supabase caching,
 * and renders a beautiful slide-over control panel with interactive tabs.
 *
 * ═══════════════════════════════════════════════════════════════════
 * BUGS FIXED IN THIS REVISION
 * ═══════════════════════════════════════════════════════════════════
 *
 * BUG 1 — "Server returned empty response" (PRIMARY ISSUE)
 *   Root cause: When OCR was added, `runOCR()` was called but its return value
 *   was only assigned if extractedText was < 200 chars. If OCR itself returned
 *   "" (because Tesseract wasn't loaded yet, or the page canvas was blank),
 *   aiState.extractedText was still "" and the AI call proceeded with an
 *   effectively empty prompt. Groq's llama-3.1-8b responds to an empty/trivial
 *   prompt with an extremely short reply that sometimes causes Vercel to flush
 *   a near-empty body — triggering the frontend's empty-response guard.
 *   FIX: added an explicit post-OCR length check with a clear user-facing
 *   error before ever calling the backend.
 *
 * BUG 2 — OCR race condition / Tesseract not loaded
 *   The old ocr-engine.js assumed `Tesseract` was already on `window`. If the
 *   OCR script hadn't finished loading when `runOCR()` was called (e.g. on a
 *   slow connection), it threw synchronously, the catch in handleTabClick
 *   swallowed it, and extractedText remained "".
 *   FIX: ensureLibrariesLoaded() now also awaits the OCR engine script, and
 *   the new ocr-engine.js self-loads Tesseract with an explicit await guard.
 *
 * BUG 3 — Missing return / undefined extractedText after OCR path
 *   The OCR block updated aiState.extractedText but the Supabase `.update()`
 *   calls were `await`-ed without try/catch. A Supabase permission error on
 *   the `extraction_method` column (column may not exist) threw an uncaught
 *   rejection that aborted the function before the AI call, leaving the tab
 *   in skeleton state forever.
 *   FIX: Supabase update calls are now wrapped in try/catch and failures are
 *   only logged — they must not prevent the AI generation from proceeding.
 *
 * BUG 4 — generateWithGroq sends the FULL extractedText without size check
 *   OCR on a 10-page scanned document can produce 30 000+ characters.
 *   Sent as-is, this blows past Groq's context window and the model either
 *   truncates silently or returns a JSON fragment — which fails JSON.parse
 *   and surfaces as "AI returned invalid JSON".
 *   FIX: client-side truncation to 8 000 chars (safe margin for
 *   llama-3.1-8b-instant's 8 192 token limit). Server also truncates as a
 *   belt-and-suspenders measure (see generate-ai.js).
 *
 * BUG 5 — JSON.parse(responseText) called on the raw fetch body
 *   If the Vercel function returns a non-200 status with an HTML error page
 *   (e.g. a cold-start 502), JSON.parse throws and the error message is the
 *   confusing "Unexpected token '<'" rather than something actionable.
 *   FIX: parse errors are caught and re-thrown with context.
 *
 * BUG 6 — generateWithGemini name still referenced in skeleton messages
 *   The project migrated from Gemini to Groq but a few UI strings still said
 *   "Gemini AI". Corrected to "Groq AI".
 * ═══════════════════════════════════════════════════════════════════
 */

// ── Configuration ────────────────────────────────────────────────────────────
const AI_CONFIG = {
    supabaseUrl: "https://acdjioftdlsugfycsbvj.supabase.co",
    supabaseKey: "sb_publishable_DtfvA3EJm991gqezfeYNng_jlSS0I9h"
};

// ── Global state ─────────────────────────────────────────────────────────────
let aiState = {
    resourceId: null,
    pdfUrl: null,
    subject: "Notes",
    college: "",
    branch: "",
    semester: "",
    extractedText: "",
    extractionMethod: null, // "pdfjs" | "ocr"
    metadataLoaded: false,
    resourceData: null,
    supabaseClient: null,
    currentQuizQuestion: 0,
    quizScore: 0,
    selectedAnswers: [],
    flashcardDeck: [],
    currentFlashcard: 0,
    quizQuestions: []
};

// ── Safe text limit sent to Groq (client side) ───────────────────────────────
// llama-3.1-8b-instant has an 8 192 token context. 1 token ≈ 4 chars.
// We reserve ~1 000 tokens for the prompt template and response.
const CLIENT_MAX_TEXT_CHARS = 8_000;

// ── Minimum text length to consider extraction successful ─────────────────────
const MIN_PDFJS_CHARS = 200; // below this → assume scanned PDF, try OCR
const MIN_FINAL_CHARS = 50;  // below this → give up and show error

// ─────────────────────────────────────────────────────────────────────────────
// CSS Injection
// ─────────────────────────────────────────────────────────────────────────────
function injectAIStyles() {
    if (document.getElementById("ai-styles")) return;

    const style = document.createElement("style");
    style.id = "ai-styles";
    style.innerHTML = `
        /* ── SIDEBAR PANEL ── */
        #ai-sidebar {
            position: fixed;
            top: 0;
            right: -460px;
            width: 450px;
            height: 100vh;
            background: rgba(11, 9, 31, 0.95);
            backdrop-filter: blur(16px);
            border-left: 1px solid rgba(168, 85, 247, 0.25);
            box-shadow: -10px 0 40px rgba(0, 0, 0, 0.6);
            z-index: 1000;
            transition: right 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            display: flex;
            flex-direction: column;
            color: #f3e8ff;
            font-family: 'Inter', system-ui, -apple-system, sans-serif;
        }
        #ai-sidebar.active { right: 0; }
        @media (max-width: 640px) {
            #ai-sidebar { width: 100%; right: -100%; }
        }

        /* ── HEADER ── */
        .ai-sidebar-header {
            padding: 20px 24px;
            border-bottom: 1px solid rgba(168, 85, 247, 0.15);
            display: flex;
            align-items: center;
            justify-content: space-between;
            background: rgba(20, 16, 48, 0.3);
        }
        .ai-sidebar-logo { display: flex; align-items: center; gap: 12px; }
        .ai-sidebar-logo-icon {
            font-size: 24px;
            padding: 8px;
            background: linear-gradient(135deg, #a855f7, #ec4899);
            border-radius: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 15px rgba(168, 85, 247, 0.4);
        }
        .ai-sidebar-title { font-size: 16px; font-weight: 800; color: #ffffff; margin: 0; }
        .ai-sidebar-subtitle { font-size: 11px; color: #d8b4fe; margin: 2px 0 0 0; }
        .ai-sidebar-close-btn {
            background: transparent;
            border: none;
            color: #c084fc;
            font-size: 28px;
            cursor: pointer;
            transition: color 0.2s;
            line-height: 1;
        }
        .ai-sidebar-close-btn:hover { color: #f472b6; }

        /* ── TABS ── */
        .ai-sidebar-tabs {
            display: flex;
            overflow-x: auto;
            border-bottom: 1px solid rgba(168, 85, 247, 0.15);
            background: rgba(13, 10, 35, 0.5);
            scrollbar-width: none;
        }
        .ai-sidebar-tabs::-webkit-scrollbar { display: none; }
        .ai-tab-btn {
            padding: 14px 18px;
            background: transparent;
            border: none;
            color: #a78bfa;
            font-size: 12px;
            font-weight: 700;
            cursor: pointer;
            white-space: nowrap;
            transition: all 0.25s ease;
            border-bottom: 2px solid transparent;
        }
        .ai-tab-btn:hover { color: #ddd6fe; background: rgba(168, 85, 247, 0.05); }
        .ai-tab-btn.active {
            color: #ffffff;
            border-bottom: 2px solid #ec4899;
            background: rgba(168, 85, 247, 0.1);
        }

        /* ── CONTENT AREA ── */
        .ai-sidebar-content { flex: 1; overflow-y: auto; padding: 24px; }
        .ai-tab-content { display: none; animation: fadeIn 0.3s ease-out; }
        .ai-tab-content.active { display: block; }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* ── CARDS ── */
        .ai-card {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(168, 85, 247, 0.15);
            border-radius: 18px;
            padding: 18px;
            margin-bottom: 18px;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .ai-card:hover {
            border-color: rgba(236, 72, 153, 0.35);
            box-shadow: 0 8px 20px rgba(168, 85, 247, 0.08);
        }
        .ai-card-title {
            font-size: 14px;
            font-weight: 800;
            color: #f472b6;
            margin-bottom: 10px;
            display: flex;
            align-items: center;
            gap: 8px;
            text-transform: uppercase;
            letter-spacing: 0.05em;
        }
        .ai-card-body { font-size: 13.5px; line-height: 1.6; color: #e2e8f0; }
        .ai-card-body ul { list-style: none; padding: 0; margin: 0; }
        .ai-card-body li { position: relative; padding-left: 20px; margin-bottom: 8px; }
        .ai-card-body li::before { content: "✦"; position: absolute; left: 0; color: #a855f7; font-weight: bold; }

        /* ── LOADING SKELETON ── */
        .ai-loading-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 60px 20px;
            text-align: center;
        }
        .ai-spinner {
            width: 48px;
            height: 48px;
            border: 4px solid rgba(168, 85, 247, 0.2);
            border-top: 4px solid #ec4899;
            border-radius: 50%;
            animation: spin 0.8s cubic-bezier(0.5, 0, 0.5, 1) infinite;
            margin-bottom: 20px;
        }
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
        .ai-loading-title { font-size: 16px; font-weight: 700; color: #ffffff; margin-bottom: 8px; }
        .ai-loading-sub { font-size: 12px; color: #a78bfa; max-width: 250px; }

        /* ── ERROR STATE ── */
        .ai-error-card {
            border-color: rgba(239, 68, 68, 0.3);
            background: rgba(239, 68, 68, 0.05);
            text-align: center;
            padding: 24px;
        }
        .ai-error-icon { font-size: 32px; margin-bottom: 12px; }
        .ai-error-msg { color: #fca5a5; font-size: 13.5px; line-height: 1.5; margin-bottom: 16px; }
        .ai-retry-btn {
            background: linear-gradient(135deg, #7c3aed, #ec4899);
            color: #ffffff;
            border: none;
            padding: 10px 20px;
            border-radius: 12px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            transition: opacity 0.2s;
        }
        .ai-retry-btn:hover { opacity: 0.9; }

        /* ── QUIZ ── */
        .quiz-question { font-size: 15px; font-weight: 700; color: #ffffff; margin-bottom: 14px; }
        .quiz-options { display: flex; flex-direction: column; gap: 10px; }
        .quiz-option {
            background: rgba(255, 255, 255, 0.03);
            border: 1px solid rgba(168, 85, 247, 0.2);
            padding: 12px 16px;
            border-radius: 12px;
            font-size: 13px;
            text-align: left;
            cursor: pointer;
            transition: all 0.2s;
            color: #e2e8f0;
        }
        .quiz-option:hover { border-color: #a855f7; background: rgba(168, 85, 247, 0.08); }
        .quiz-option.correct { background: rgba(34, 197, 94, 0.15) !important; border-color: #22c55e !important; color: #4ade80 !important; }
        .quiz-option.incorrect { background: rgba(239, 68, 68, 0.15) !important; border-color: #ef4444 !important; color: #f87171 !important; }
        .quiz-explanation {
            margin-top: 14px;
            padding: 12px;
            background: rgba(168, 85, 247, 0.08);
            border-left: 3px solid #a855f7;
            border-radius: 4px 12px 12px 4px;
            font-size: 12px;
            line-height: 1.5;
            color: #ddd6fe;
        }
        .quiz-score-card { text-align: center; padding: 30px 20px; }
        .quiz-score-num {
            font-size: 48px;
            font-weight: 900;
            color: #ec4899;
            margin-bottom: 10px;
            text-shadow: 0 0 15px rgba(236, 72, 153, 0.4);
        }

        /* ── FLASHCARDS ── */
        .flashcard-container {
            perspective: 1000px;
            width: 100%;
            height: 200px;
            margin-bottom: 24px;
            cursor: pointer;
        }
        .flashcard-inner {
            position: relative;
            width: 100%;
            height: 100%;
            text-align: center;
            transition: transform 0.6s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            transform-style: preserve-3d;
        }
        .flashcard-container.flipped .flashcard-inner { transform: rotateY(180deg); }
        .flashcard-front, .flashcard-back {
            position: absolute;
            width: 100%;
            height: 100%;
            backface-visibility: hidden;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 24px;
            border-radius: 20px;
            box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        }
        .flashcard-front {
            background: linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(13, 11, 20, 0.9));
            border: 2px solid rgba(168, 85, 247, 0.3);
            color: #ffffff;
        }
        .flashcard-back {
            background: linear-gradient(135deg, rgba(236, 72, 153, 0.15), rgba(13, 11, 20, 0.95));
            border: 2px solid rgba(236, 72, 153, 0.3);
            color: #f3e8ff;
            transform: rotateY(180deg);
        }
        .flashcard-nav { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
        .flashcard-btn {
            background: rgba(168, 85, 247, 0.15);
            border: 1px solid rgba(168, 85, 247, 0.3);
            color: #ffffff;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s;
        }
        .flashcard-btn:hover { background: rgba(168, 85, 247, 0.3); }
        .flashcard-indicator { font-size: 13px; color: #a78bfa; font-weight: bold; }

        /* ── FOOTER ── */
        .ai-sidebar-footer {
            padding: 12px 24px;
            border-top: 1px solid rgba(168, 85, 247, 0.15);
            background: rgba(13, 10, 35, 0.7);
            text-align: center;
            font-size: 11px;
            color: #c084fc;
        }

        /* ── API KEY MODAL ── */
        .ai-modal-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(4px);
            z-index: 2000;
            display: none;
            align-items: center;
            justify-content: center;
        }
        .ai-modal-backdrop.active { display: flex; }
        .ai-modal {
            background: rgba(15, 12, 40, 0.98);
            border: 1px solid rgba(168, 85, 247, 0.3);
            border-radius: 20px;
            padding: 32px;
            width: 90%;
            max-width: 400px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.8);
        }
        .ai-modal-title { font-size: 18px; font-weight: 800; color: #ffffff; margin-bottom: 12px; }
        .ai-modal-desc { font-size: 12px; color: #a78bfa; line-height: 1.5; margin-bottom: 20px; }
        .ai-modal-input {
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(168, 85, 247, 0.3);
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 13px;
            color: #ffffff;
            margin-bottom: 20px;
            box-sizing: border-box;
        }
        .ai-modal-input:focus { outline: none; border-color: #ec4899; box-shadow: 0 0 10px rgba(236, 72, 153, 0.2); }
        .ai-modal-btns { display: flex; justify-content: flex-end; gap: 12px; }
        .ai-modal-cancel {
            background: transparent;
            border: 1px solid rgba(168, 85, 247, 0.2);
            color: #a78bfa;
            padding: 10px 20px;
            border-radius: 12px;
            font-size: 12.5px;
            font-weight: 700;
            cursor: pointer;
        }
        .ai-modal-save {
            background: linear-gradient(135deg, #7c3aed, #ec4899);
            border: none;
            color: #ffffff;
            padding: 10px 24px;
            border-radius: 12px;
            font-size: 12.5px;
            font-weight: 700;
            cursor: pointer;
        }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// DOM Injection
// ─────────────────────────────────────────────────────────────────────────────
function injectDOM() {
    if (document.getElementById("ai-sidebar")) return;

    const sidebar = document.createElement("div");
    sidebar.id = "ai-sidebar";
    sidebar.innerHTML = `
        <div class="ai-sidebar-header">
            <div class="ai-sidebar-logo">
                <span class="ai-sidebar-logo-icon">🤖</span>
                <div>
                    <h3 class="ai-sidebar-title">EduShare AI Assistant</h3>
                    <p class="ai-sidebar-subtitle">Smart Academic Ecosystem</p>
                </div>
            </div>
            <button id="ai-sidebar-close" class="ai-sidebar-close-btn">&times;</button>
        </div>
        <div class="ai-sidebar-tabs">
            <button class="ai-tab-btn active" data-tab="summary">🤖 Summary</button>
            <button class="ai-tab-btn" data-tab="quiz">🧠 MCQ Quiz</button>
            <button class="ai-tab-btn" data-tab="topics">📌 Topics</button>
            <button class="ai-tab-btn" data-tab="predictions">🎯 Predictions</button>
            <button class="ai-tab-btn" data-tab="flashcards">🗂 Flashcards</button>
            <button class="ai-tab-btn" data-tab="revision">⚡ 5-Min Revision</button>
        </div>
        <div class="ai-sidebar-content">
            <div class="ai-tab-content active" id="tab-summary"></div>
            <div class="ai-tab-content" id="tab-quiz"></div>
            <div class="ai-tab-content" id="tab-topics"></div>
            <div class="ai-tab-content" id="tab-predictions"></div>
            <div class="ai-tab-content" id="tab-flashcards"></div>
            <div class="ai-tab-content" id="tab-revision"></div>
        </div>
        <div class="ai-sidebar-footer">🤖 Powered by EduShare AI · Groq llama-3.1-8b</div>
    `;
    document.body.appendChild(sidebar);

    const backdrop = document.createElement("div");
    backdrop.id = "ai-modal-backdrop";
    backdrop.className = "ai-modal-backdrop";
    backdrop.innerHTML = `
        <div class="ai-modal">
            <h3 class="ai-modal-title">⚙️ AI Settings</h3>
            <p class="ai-modal-desc">EduShare AI uses Groq's llama-3.1-8b-instant model via the backend. No client-side key is required.</p>
            <div class="ai-modal-btns">
                <button id="ai-modal-cancel" class="ai-modal-cancel">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(backdrop);

    document.getElementById("ai-sidebar-close").addEventListener("click", closeSidebar);
    document.getElementById("ai-modal-cancel").addEventListener("click", closeKeyModal);

    document.querySelectorAll(".ai-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            const tabId = btn.getAttribute("data-tab");
            document.getElementById(`tab-${tabId}`).classList.add("active");
            handleTabClick(tabId);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Library Loading
// ─────────────────────────────────────────────────────────────────────────────
function loadScript(url) {
    return new Promise((resolve, reject) => {
        // Don't double-load
        if (document.querySelector(`script[src="${url}"]`)) { resolve(); return; }
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = () => reject(new Error(`Failed to load script: ${url}`));
        document.head.appendChild(script);
    });
}

async function ensureLibrariesLoaded() {
    // 1. Supabase
    if (typeof supabase === "undefined") {
        await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }
    if (!aiState.supabaseClient) {
        aiState.supabaseClient = window.supabaseClient ||
            supabase.createClient(AI_CONFIG.supabaseUrl, AI_CONFIG.supabaseKey);
    }

    // 2. PDF.js
    if (typeof pdfjsLib === "undefined") {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
        pdfjsLib.GlobalWorkerOptions.workerSrc =
            "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
    }

    // 3. OCR engine — load the script so window.runOCR is available.
    //    The new ocr-engine.js self-loads Tesseract, so we only need the module itself.
    //    Adjust the path to wherever ocr-engine.js lives in your project.
    if (typeof window.runOCR !== "function") {
        await loadScript("/js/ocr-engine.js");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Sidebar helpers
// ─────────────────────────────────────────────────────────────────────────────
function openSidebar() {
    injectDOM();
    document.getElementById("ai-sidebar").classList.add("active");
}

function closeSidebar() {
    const sidebar = document.getElementById("ai-sidebar");
    if (sidebar) sidebar.classList.remove("active");
}

function openKeyModal() {
    document.getElementById("ai-modal-backdrop").classList.add("active");
}

function closeKeyModal() {
    document.getElementById("ai-modal-backdrop").classList.remove("active");
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────────────
async function initializeAISummarizer(resource, initialTab = "summary") {
    injectAIStyles();
    openSidebar();

    const validTabs = ["summary", "quiz", "topics", "predictions", "flashcards", "revision"];
    const activeTab = validTabs.includes(initialTab) ? initialTab : "summary";

    aiState.resourceId   = resource.id;
    aiState.pdfUrl       = resource.pdf_url;
    aiState.subject      = resource.subject || "Notes";
    aiState.college      = resource.college || "";
    aiState.branch       = resource.branch || "";
    aiState.semester     = resource.semester || "";

    // Reset per-resource state
    aiState.extractedText    = "";
    aiState.extractionMethod = null;
    aiState.metadataLoaded   = false;
    aiState.resourceData     = null;

    document.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));
    document.querySelector(`.ai-tab-btn[data-tab="${activeTab}"]`)?.classList.add("active");
    document.getElementById(`tab-${activeTab}`)?.classList.add("active");

    await handleTabClick(activeTab);
}

// ─────────────────────────────────────────────────────────────────────────────
// Database helpers
// ─────────────────────────────────────────────────────────────────────────────
async function loadResourceFromDb() {
    if (aiState.metadataLoaded) return;

    await ensureLibrariesLoaded();

    // 1. Try by id
    if (aiState.resourceId) {
        const { data, error } = await aiState.supabaseClient
            .from("resources").select("*").eq("id", aiState.resourceId).single();
        if (!error && data) {
            aiState.resourceData = data;
            aiState.metadataLoaded = true;
            return;
        }
    }

    // 2. Try by pdf_url
    if (aiState.pdfUrl) {
        const { data, error } = await aiState.supabaseClient
            .from("resources").select("*").eq("pdf_url", aiState.pdfUrl);
        if (!error && data?.length > 0) {
            aiState.resourceData  = data[0];
            aiState.resourceId    = data[0].id;
            aiState.metadataLoaded = true;
            return;
        }
    }

    // 3. Dynamic insert for static preview pages not yet in DB
    //    FIX: this previously inserted with status: "approved", which meant ANY
    //    call to initAISummarizer() with a pdf_url not yet in the DB silently
    //    published a brand-new public resource with zero admin review. Default
    //    to "pending" so it follows the same moderation path as every other
    //    upload. If you have a specific trusted call site that genuinely needs
    //    instant publish, pass that override explicitly at the call site rather
    //    than relying on this shared fallback.
    if (aiState.pdfUrl) {
        const { data, error } = await aiState.supabaseClient
            .from("resources")
            .insert([{
                title: aiState.subject + " NOTES",
                type: "notes",
                subject: aiState.subject,
                college: aiState.college || "N/A",
                branch: aiState.branch || "N/A",
                semester: aiState.semester || "1",
                description: "Static preview notes registered dynamically by AI Assistant.",
                pdf_url: aiState.pdfUrl,
                status: "pending",
                downloads: 0
            }])
            .select().single();

        if (!error && data) {
            aiState.resourceData  = data;
            aiState.resourceId    = data.id;
            aiState.metadataLoaded = true;
        } else {
            console.error("[ai-summarizer] Dynamic resource insertion failed:", error);
        }
    }
}

// Persist extracted text to Supabase (non-blocking — failures must NOT abort AI generation)
async function saveExtractedText(method) {
    if (!aiState.resourceId || !aiState.extractedText) return;
    try {
        await aiState.supabaseClient
            .from("resources")
            .update({
                extracted_text: aiState.extractedText,
                extraction_method: method,
                extracted_at: new Date().toISOString()
            })
            .eq("id", aiState.resourceId);
    } catch (err) {
        console.warn("[ai-summarizer] Non-fatal: could not save extracted text to Supabase:", err.message);
    }
}

async function saveCachedData(column, data) {
    if (!aiState.resourceId) return;
    try {
        await aiState.supabaseClient
            .from("resources")
            .update({ [column]: JSON.stringify(data) })
            .eq("id", aiState.resourceId);
    } catch (err) {
        console.warn(`[ai-summarizer] Non-fatal: could not cache ${column}:`, err.message);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF Text Extraction
// ─────────────────────────────────────────────────────────────────────────────
async function extractPdfText() {
    await ensureLibrariesLoaded();

    if (!aiState.pdfUrl) throw new Error("PDF URL is missing. Cannot extract text.");

    let pdf;
    try {
        pdf = await pdfjsLib.getDocument({ url: aiState.pdfUrl, cMapPacked: true }).promise;
    } catch (e) {
        throw new Error(
            "Failed to open the PDF. Check that CORS is enabled on your Supabase storage bucket " +
            "and the URL is publicly accessible. (" + e.message + ")"
        );
    }

    let fullText = "";
    const maxPages = Math.min(pdf.numPages, 15);

    for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        fullText += content.items.map(item => item.str).join(" ") + "\n";
    }

    aiState.extractedText = fullText.trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main tab handler
// ─────────────────────────────────────────────────────────────────────────────
async function handleTabClick(tabId) {
    const tabContainer = document.getElementById(`tab-${tabId}`);
    if (!tabContainer) return;

    tabContainer.innerHTML = renderSkeleton();

    try {
        await loadResourceFromDb();

        // ── Cache check ───────────────────────────────────────────────────────
        const dbColumnMap = {
            summary:     "summary",
            quiz:        "quiz",
            topics:      "important_topics",
            predictions: "predicted_questions",
            flashcards:  "flashcards",
            revision:    "five_min_revision"
        };

        const cacheCol = dbColumnMap[tabId];

        if (aiState.resourceData?.[cacheCol]) {
            try {
                renderTabContent(tabId, JSON.parse(aiState.resourceData[cacheCol]));
                return;
            } catch {
                console.warn("[ai-summarizer] Cached data was invalid JSON, regenerating.");
            }
        }

        // ── Text extraction (only if not already done for this session) ───────
        if (!aiState.extractedText) {

            // Step 1: Try PDF.js (typed PDFs)
            tabContainer.innerHTML = renderSkeleton(
                "Reading PDF...",
                "Extracting text with PDF.js"
            );
            await extractPdfText();

            if (aiState.extractedText.length >= MIN_PDFJS_CHARS) {
                // Good typed PDF
                aiState.extractionMethod = "pdfjs";
                await saveExtractedText("pdfjs"); // non-blocking, won't throw

            } else {
                // Step 2: Scanned PDF — fall back to OCR
                console.log("[ai-summarizer] Typed extraction yielded < " + MIN_PDFJS_CHARS + " chars. Trying OCR fallback.");
                tabContainer.innerHTML = renderSkeleton(
                    "Scanned PDF detected...",
                    "Running OCR — this may take 20–40 seconds"
                );

                if (typeof window.runOCR !== "function") {
                    throw new Error(
                        "OCR engine (ocr-engine.js) is not loaded. " +
                        "Ensure <script src=\"/js/ocr-engine.js\"></script> is on the page, " +
                        "or check that ensureLibrariesLoaded() successfully fetched it."
                    );
                }

                // FIX: capture the return value and assign it
                const ocrText = await window.runOCR(aiState.pdfUrl);
                aiState.extractedText    = ocrText || "";
                aiState.extractionMethod = "ocr";

                await saveExtractedText("ocr"); // non-blocking
            }
        }

        // ── Final text guard ──────────────────────────────────────────────────
        // This runs whether we used pdfjs or ocr.
        if (!aiState.extractedText || aiState.extractedText.length < MIN_FINAL_CHARS) {
            throw new Error(
                "Could not extract readable text from this PDF. " +
                "If it is a scanned document, ensure Tesseract.js is available. " +
                "If typed, verify the file isn't password-protected or corrupted."
            );
        }

        // ── AI generation ─────────────────────────────────────────────────────
        tabContainer.innerHTML = renderSkeleton(
            `Generating ${tabId}...`,
            "Analysing note text with Groq AI"
        );

        const generatedData = await generateWithGroq(tabId);

        // Cache in Supabase
        await saveCachedData(cacheCol, generatedData);
        if (aiState.resourceData) {
            aiState.resourceData[cacheCol] = JSON.stringify(generatedData);
        }

        renderTabContent(tabId, generatedData);

    } catch (e) {
        console.error("[ai-summarizer] Tab error:", e);
        tabContainer.innerHTML = renderErrorCard(
            "AI Generation Failed",
            e.message || "An unexpected error occurred. Please try again."
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Groq API call (via backend)
// ─────────────────────────────────────────────────────────────────────────────
async function generateWithGroq(tabId) {

    const prompts = {
        summary: `Generate a JSON object with these exact keys:
{
  "summary": "A 3-5 sentence summary of the notes.",
  "key_concepts": ["concept1", "concept2"],
  "important_definitions": [{"concept": "...", "definition": "..."}],
  "exam_revision_points": ["point1", "point2"]
}`,

        quiz: `Generate a JSON object with this exact structure:
{
  "questions": [
    {
      "question": "...",
      "options": ["A. ...", "B. ...", "C. ...", "D. ..."],
      "answer_index": 0,
      "explanation": "..."
    }
  ]
}
Generate at least 5 questions based on the notes.`,

        topics: `Generate a JSON object:
{
  "topics": [
    {
      "topic": "Topic name",
      "importance": "High",
      "description": "Why this topic matters for exams."
    }
  ]
}
importance must be one of: High, Medium, Low.`,

        predictions: `Generate a JSON object:
{
  "predictions": [
    {
      "question": "Predicted exam question",
      "type": "Long",
      "likelihood": "Highly Likely",
      "hint": "Key points to cover in the answer."
    }
  ]
}
likelihood must be one of: Highly Likely, Likely, Possible.`,

        flashcards: `Generate a JSON object:
{
  "flashcards": [
    {
      "question": "Front of card",
      "answer": "Back of card"
    }
  ]
}
Generate at least 8 flashcards.`,

        revision: `Generate a JSON object:
{
  "quick_summary": "A single concise paragraph covering the most important points.",
  "cheat_sheet_items": ["Bullet point 1", "Bullet point 2"],
  "mnemonics_or_shortcuts": ["Mnemonic or memory trick 1"]
}`
    };

    // Client-side truncation: keep the prompt within a safe token budget
    const textChunk = aiState.extractedText.slice(0, CLIENT_MAX_TEXT_CHARS);

    const fullPrompt = `${prompts[tabId]}

---
STUDENT NOTES (extracted from PDF):

${textChunk}

---
Return ONLY valid JSON matching the structure above. Do not include any explanation, markdown, or code fences.`;

    // ── Fetch /api/generate-ai ────────────────────────────────────────────────
    let response;
    try {
        response = await fetch("/api/generate-ai", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prompt: fullPrompt })
        });
    } catch (networkErr) {
        throw new Error("Network error: could not reach the AI backend. Check your internet connection.");
    }

    // ── Read response body ────────────────────────────────────────────────────
    let responseText;
    try {
        responseText = await response.text();
    } catch (readErr) {
        throw new Error("Failed to read the server response. Please try again.");
    }

    // ── Guard: empty body ─────────────────────────────────────────────────────
    if (!responseText || responseText.trim() === "") {
        throw new Error(
            `Server returned an empty response (HTTP ${response.status}). ` +
            "This usually means a Vercel cold-start timeout or a crash before the handler returned. " +
            "Check your Vercel function logs."
        );
    }

    // ── Parse outer JSON wrapper ──────────────────────────────────────────────
    let result;
    try {
        result = JSON.parse(responseText);
    } catch {
        // The body was something non-JSON (e.g. an HTML 502 page from Vercel)
        console.error("[ai-summarizer] Raw server body:", responseText.slice(0, 500));
        throw new Error(
            `Server returned an invalid response (HTTP ${response.status}). ` +
            "Check Vercel logs for crash details."
        );
    }

    if (!result.success) {
        throw new Error(result.error || "AI generation failed on the server.");
    }

    // ── Parse the AI-generated JSON inside result.text ────────────────────────
    try {
        // Strip any residual markdown fences the model may have added
        const cleanText = result.text
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        return JSON.parse(cleanText);

    } catch {
        console.error("[ai-summarizer] AI text that failed to parse:", result.text);
        throw new Error(
            "The AI returned a response that could not be parsed as JSON. " +
            "This can happen with very short or ambiguous PDFs. Please try again."
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering helpers
// ─────────────────────────────────────────────────────────────────────────────
function renderSkeleton(title = "Processing...", subtitle = "Please wait a moment") {
    return `
        <div class="ai-loading-container">
            <div class="ai-spinner"></div>
            <div class="ai-loading-title">${title}</div>
            <div class="ai-loading-sub">${subtitle}</div>
        </div>`;
}

function renderErrorCard(title, message) {
    return `
        <div class="ai-card ai-error-card">
            <div class="ai-error-icon">⚠️</div>
            <div class="ai-loading-title" style="color: #fca5a5;">${title}</div>
            <p class="ai-error-msg">${message}</p>
            <button onclick="handleTabClick(document.querySelector('.ai-tab-btn.active')?.getAttribute('data-tab') || 'summary')" class="ai-retry-btn">
                🔄 Retry
            </button>
        </div>`;
}

function renderTabContent(tabId, data) {
    const container = document.getElementById(`tab-${tabId}`);
    if (!container) return;
    container.innerHTML = "";

    if (tabId === "summary") {
        container.innerHTML = `
            <div class="ai-card">
                <div class="ai-card-title">📌 Short Summary</div>
                <div class="ai-card-body">${data.summary ?? "N/A"}</div>
            </div>
            <div class="ai-card">
                <div class="ai-card-title">📚 Key Concepts</div>
                <div class="ai-card-body"><ul>${(data.key_concepts ?? []).map(i => `<li>${i}</li>`).join("")}</ul></div>
            </div>
            <div class="ai-card">
                <div class="ai-card-title">📝 Important Definitions</div>
                <div class="ai-card-body"><ul>${(data.important_definitions ?? []).map(i => `<li><b>${i.concept}:</b> ${i.definition}</li>`).join("")}</ul></div>
            </div>
            <div class="ai-card">
                <div class="ai-card-title">🎯 Exam Revision Points</div>
                <div class="ai-card-body"><ul>${(data.exam_revision_points ?? []).map(i => `<li>${i}</li>`).join("")}</ul></div>
            </div>`;

    } else if (tabId === "quiz") {
        aiState.quizQuestions       = data.questions ?? [];
        aiState.currentQuizQuestion = 0;
        aiState.quizScore           = 0;
        aiState.selectedAnswers     = new Array(aiState.quizQuestions.length).fill(null);
        renderQuizQuestion();

    } else if (tabId === "topics") {
        container.innerHTML = (data.topics ?? []).map(t => {
            const c = t.importance === "High" ? "#ef4444" : t.importance === "Medium" ? "#f59e0b" : "#10b981";
            const bg = t.importance === "High" ? "rgba(239,68,68,.15)" : t.importance === "Medium" ? "rgba(245,158,11,.15)" : "rgba(16,185,129,.15)";
            return `<div class="ai-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-weight:700;color:#fff;">${t.topic}</span>
                    <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;color:${c};background:${bg};border:1px solid ${c}30;">${t.importance.toUpperCase()}</span>
                </div>
                <div style="font-size:13px;color:#cbd5e1;">${t.description}</div>
            </div>`;
        }).join("");

    } else if (tabId === "predictions") {
        container.innerHTML = (data.predictions ?? []).map(p => {
            const c = p.likelihood === "Highly Likely" ? "#ec4899" : p.likelihood === "Likely" ? "#a855f7" : "#3b82f6";
            const bg = p.likelihood === "Highly Likely" ? "rgba(236,72,153,.15)" : p.likelihood === "Likely" ? "rgba(168,85,247,.15)" : "rgba(59,130,246,.15)";
            return `<div class="ai-card">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;">
                    <span style="font-size:10px;font-weight:800;color:#cbd5e1;background:rgba(255,255,255,.08);padding:3px 8px;border-radius:4px;">${p.type}</span>
                    <span style="font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;color:${c};background:${bg};border:1px solid ${c}30;">🔥 ${p.likelihood.toUpperCase()}</span>
                </div>
                <div style="font-weight:700;color:#fff;font-size:14px;margin-bottom:10px;">${p.question}</div>
                <div style="font-size:12px;color:#94a3b8;background:rgba(0,0,0,.2);padding:10px;border-radius:8px;">💡 <b>Hint:</b> ${p.hint}</div>
            </div>`;
        }).join("");

    } else if (tabId === "flashcards") {
        aiState.flashcardDeck    = data.flashcards ?? [];
        aiState.currentFlashcard = 0;
        renderFlashcard();

    } else if (tabId === "revision") {
        container.innerHTML = `
            <div class="ai-card">
                <div class="ai-card-title">⚡ 5-Minute Summary</div>
                <div class="ai-card-body" style="font-style:italic;">"${data.quick_summary ?? ""}"</div>
            </div>
            <div class="ai-card">
                <div class="ai-card-title">📝 Cheat-Sheet Notes</div>
                <div class="ai-card-body"><ul>${(data.cheat_sheet_items ?? []).map(i => `<li>${i}</li>`).join("")}</ul></div>
            </div>
            <div class="ai-card">
                <div class="ai-card-title">💡 Mnemonics / Shortcuts</div>
                <div class="ai-card-body"><ul>${(data.mnemonics_or_shortcuts ?? []).map(i => `<li>${i}</li>`).join("")}</ul></div>
            </div>`;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Quiz
// ─────────────────────────────────────────────────────────────────────────────
function renderQuizQuestion() {
    const container = document.getElementById("tab-quiz");
    const questions  = aiState.quizQuestions;
    const qIndex     = aiState.currentQuizQuestion;

    if (qIndex >= questions.length) {
        const percent = Math.round((aiState.quizScore / questions.length) * 100);
        container.innerHTML = `
            <div class="ai-card quiz-score-card">
                <div class="quiz-score-num">${aiState.quizScore} / ${questions.length}</div>
                <div style="font-weight:700;font-size:18px;color:#fff;margin-bottom:8px;">Quiz Completed!</div>
                <p style="color:#94a3b8;font-size:13px;margin-bottom:20px;">You scored ${percent}%.</p>
                <button onclick="restartQuiz()" class="ai-retry-btn">📝 Try Again</button>
            </div>`;
        return;
    }

    const q          = questions[qIndex];
    const prevAnswer = aiState.selectedAnswers[qIndex];

    container.innerHTML = `
        <div class="ai-card">
            <div style="display:flex;justify-content:space-between;font-size:11px;color:#64748b;margin-bottom:16px;">
                <span>PRACTICE QUIZ</span>
                <span>Q ${qIndex + 1} OF ${questions.length}</span>
            </div>
            <div class="quiz-question">${q.question}</div>
            <div class="quiz-options">
                ${q.options.map((opt, i) => {
                    let cls = "quiz-option";
                    if (prevAnswer !== null) {
                        if (i === q.answer_index) cls += " correct";
                        else if (prevAnswer === i) cls += " incorrect";
                    }
                    return `<button onclick="submitQuizAnswer(${i})" class="${cls}" ${prevAnswer !== null ? "disabled" : ""}>${opt}</button>`;
                }).join("")}
            </div>
            ${prevAnswer !== null ? `
                <div class="quiz-explanation"><b>Explanation:</b><br>${q.explanation}</div>
                <button onclick="nextQuizQuestion()" class="ai-retry-btn" style="width:100%;margin-top:16px;">
                    ${qIndex + 1 === questions.length ? "Finish Quiz 🏁" : "Next Question ➔"}
                </button>` : ""}
        </div>`;
}

window.submitQuizAnswer = function(optIndex) {
    const q = aiState.quizQuestions[aiState.currentQuizQuestion];
    aiState.selectedAnswers[aiState.currentQuizQuestion] = optIndex;
    if (optIndex === q.answer_index) aiState.quizScore++;
    renderQuizQuestion();
};

window.nextQuizQuestion = function() {
    aiState.currentQuizQuestion++;
    renderQuizQuestion();
};

window.restartQuiz = function() {
    aiState.currentQuizQuestion = 0;
    aiState.quizScore           = 0;
    aiState.selectedAnswers     = new Array(aiState.quizQuestions.length).fill(null);
    renderQuizQuestion();
};

// ─────────────────────────────────────────────────────────────────────────────
// Flashcards
// ─────────────────────────────────────────────────────────────────────────────
function renderFlashcard() {
    const container = document.getElementById("tab-flashcards");
    const deck   = aiState.flashcardDeck;
    const fIndex = aiState.currentFlashcard;

    if (!deck || deck.length === 0) {
        container.innerHTML = `<div style="text-align:center;padding:40px;color:#64748b;">No flashcards generated.</div>`;
        return;
    }

    const card = deck[fIndex];
    container.innerHTML = `
        <div class="flashcard-container" onclick="this.classList.toggle('flipped')">
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div>
                        <span style="font-size:10px;color:#c084fc;font-weight:700;letter-spacing:.1em;display:block;margin-bottom:16px;">QUESTION</span>
                        <div style="font-size:16px;font-weight:700;">${card.question}</div>
                        <span style="font-size:10px;color:#475569;display:block;margin-top:24px;">👆 Click to flip</span>
                    </div>
                </div>
                <div class="flashcard-back">
                    <div>
                        <span style="font-size:10px;color:#f472b6;font-weight:700;letter-spacing:.1em;display:block;margin-bottom:16px;">ANSWER</span>
                        <div style="font-size:13px;line-height:1.6;">${card.answer}</div>
                        <span style="font-size:10px;color:#475569;display:block;margin-top:24px;">👆 Click to flip</span>
                    </div>
                </div>
            </div>
        </div>
        <div class="flashcard-nav">
            <button onclick="prevFlashcard()" class="flashcard-btn" ${fIndex === 0 ? "style='opacity:.3;pointer-events:none;'" : ""}>◀</button>
            <span class="flashcard-indicator">CARD ${fIndex + 1} OF ${deck.length}</span>
            <button onclick="nextFlashcard()" class="flashcard-btn" ${fIndex + 1 === deck.length ? "style='opacity:.3;pointer-events:none;'" : ""}>▶</button>
        </div>`;
}

window.prevFlashcard = function() {
    if (aiState.currentFlashcard > 0) { aiState.currentFlashcard--; renderFlashcard(); }
};
window.nextFlashcard = function() {
    if (aiState.currentFlashcard + 1 < aiState.flashcardDeck.length) { aiState.currentFlashcard++; renderFlashcard(); }
};

// ─────────────────────────────────────────────────────────────────────────────
// Global exports
// ─────────────────────────────────────────────────────────────────────────────
window.initAISummarizer  = initializeAISummarizer;
window.handleTabClick    = handleTabClick;
window.openKeyModal      = openKeyModal;
window.restartQuiz       = window.restartQuiz;
window.submitQuizAnswer  = window.submitQuizAnswer;
window.nextQuizQuestion  = window.nextQuizQuestion;
window.prevFlashcard     = window.prevFlashcard;
window.nextFlashcard     = window.nextFlashcard;
