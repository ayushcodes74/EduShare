/**
 * EduShare AI Study Assistant & Notes Summarizer
 * Handles PDF text extraction, Gemini API calls, Supabase caching,
 * and renders a beautiful slide-over control panel with interactive tabs.
 */

// Configuration and state
const AI_CONFIG = {
    supabaseUrl: "https://acdjioftdlsugfycsbvj.supabase.co",
    supabaseKey: "sb_publishable_DtfvA3EJm991gqezfeYNng_jlSS0I9h",
    geminiUrl: "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent"
};

let aiState = {
    resourceId: null,
    pdfUrl: null,
    subject: "Notes",
    college: "",
    branch: "",
    semester: "",
    extractedText: "",
    metadataLoaded: false,
    resourceData: null,
    supabaseClient: null,
    currentQuizQuestion: 0,
    quizScore: 0,
    selectedAnswers: []
};

// Inject CSS styles for AI panel
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

        #ai-sidebar.active {
            right: 0;
        }

        @media (max-width: 640px) {
            #ai-sidebar {
                width: 100%;
                right: -100%;
            }
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

        .ai-sidebar-logo {
            display: flex;
            align-items: center;
            gap: 12px;
        }

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

        .ai-sidebar-title {
            font-size: 16px;
            font-weight: 800;
            color: #ffffff;
            margin: 0;
        }

        .ai-sidebar-subtitle {
            font-size: 11px;
            color: #d8b4fe;
            margin: 2px 0 0 0;
        }

        .ai-sidebar-close-btn {
            background: transparent;
            border: none;
            color: #c084fc;
            font-size: 28px;
            cursor: pointer;
            transition: color 0.2s;
            line-height: 1;
        }

        .ai-sidebar-close-btn:hover {
            color: #f472b6;
        }

        /* ── TABS ── */
        .ai-sidebar-tabs {
            display: flex;
            overflow-x: auto;
            border-bottom: 1px solid rgba(168, 85, 247, 0.15);
            background: rgba(13, 10, 35, 0.5);
            scrollbar-width: none; /* Firefox */
        }

        .ai-sidebar-tabs::-webkit-scrollbar {
            display: none; /* Safari and Chrome */
        }

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

        .ai-tab-btn:hover {
            color: #ddd6fe;
            background: rgba(168, 85, 247, 0.05);
        }

        .ai-tab-btn.active {
            color: #ffffff;
            border-bottom: 2px solid #ec4899;
            background: rgba(168, 85, 247, 0.1);
        }

        /* ── CONTENT AREA ── */
        .ai-sidebar-content {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
        }

        .ai-tab-content {
            display: none;
            animation: fadeIn 0.3s ease-out;
        }

        .ai-tab-content.active {
            display: block;
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
        }

        /* ── CARDS AND SECTIONS ── */
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

        .ai-card-body {
            font-size: 13.5px;
            line-height: 1.6;
            color: #e2e8f0;
        }

        .ai-card-body ul {
            list-style: none;
            padding: 0;
            margin: 0;
        }

        .ai-card-body li {
            position: relative;
            padding-left: 20px;
            margin-bottom: 8px;
        }

        .ai-card-body li::before {
            content: "✦";
            position: absolute;
            left: 0;
            color: #a855f7;
            font-weight: bold;
        }

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

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .ai-loading-title {
            font-size: 16px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 8px;
        }

        .ai-loading-sub {
            font-size: 12px;
            color: #a78bfa;
            max-width: 250px;
        }

        /* ── ERROR STATE ── */
        .ai-error-card {
            border-color: rgba(239, 68, 68, 0.3);
            background: rgba(239, 68, 68, 0.05);
            text-align: center;
            padding: 24px;
        }

        .ai-error-icon {
            font-size: 32px;
            margin-bottom: 12px;
        }

        .ai-error-msg {
            color: #fca5a5;
            font-size: 13.5px;
            line-height: 1.5;
            margin-bottom: 16px;
        }

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

        .ai-retry-btn:hover {
            opacity: 0.9;
        }

        /* ── INTERACTIVE COMPONENTS ── */
        
        /* MCQs Quiz */
        .quiz-question-wrap {
            margin-bottom: 20px;
        }
        .quiz-question {
            font-size: 15px;
            font-weight: 700;
            color: #ffffff;
            margin-bottom: 14px;
        }
        .quiz-options {
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
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
        .quiz-option:hover {
            border-color: #a855f7;
            background: rgba(168, 85, 247, 0.08);
        }
        .quiz-option.correct {
            background: rgba(34, 197, 94, 0.15) !important;
            border-color: #22c55e !important;
            color: #4ade80 !important;
        }
        .quiz-option.incorrect {
            background: rgba(239, 68, 68, 0.15) !important;
            border-color: #ef4444 !important;
            color: #f87171 !important;
        }
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
        .quiz-score-card {
            text-align: center;
            padding: 30px 20px;
        }
        .quiz-score-num {
            font-size: 48px;
            font-weight: 900;
            color: #ec4899;
            margin-bottom: 10px;
            text-shadow: 0 0 15px rgba(236, 72, 153, 0.4);
        }

        /* Flipping Flashcards */
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
        .flashcard-container.flipped .flashcard-inner {
            transform: rotateY(180deg);
        }
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
        .flashcard-nav {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
        }
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
        .flashcard-btn:hover {
            background: rgba(168, 85, 247, 0.3);
        }
        .flashcard-indicator {
            font-size: 13px;
            color: #a78bfa;
            font-weight: bold;
        }

        /* ── FOOTER & SETTINGS ── */
        .ai-sidebar-footer {
            padding: 16px 24px;
            border-top: 1px solid rgba(168, 85, 247, 0.15);
            background: rgba(13, 10, 35, 0.7);
            display: flex;
            justify-content: center;
        }

        .ai-settings-btn {
            background: transparent;
            border: 1px dashed rgba(168, 85, 247, 0.4);
            color: #d8b4fe;
            padding: 8px 16px;
            border-radius: 10px;
            font-size: 11px;
            font-weight: 600;
            cursor: pointer;
            transition: all 0.2s;
        }

        .ai-settings-btn:hover {
            border-color: #ec4899;
            color: #ffffff;
            background: rgba(168, 85, 247, 0.05);
        }

        /* ── API KEY MODAL ── */
        .ai-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.85);
            z-index: 1010;
            display: none;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.3s ease;
        }

        .ai-modal-backdrop.active {
            display: flex;
            opacity: 1;
        }

        .ai-modal {
            background: #0b091f;
            border: 1px solid rgba(168, 85, 247, 0.3);
            border-radius: 24px;
            width: 90%;
            max-width: 440px;
            padding: 28px;
            box-shadow: 0 15px 50px rgba(0, 0, 0, 0.8);
            transform: scale(0.9);
            transition: transform 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
            color: #e2e8f0;
        }

        .ai-modal-backdrop.active .ai-modal {
            transform: scale(1);
        }

        .ai-modal-title {
            font-size: 18px;
            font-weight: 800;
            color: #ffffff;
            margin-bottom: 8px;
        }

        .ai-modal-desc {
            font-size: 12px;
            color: #a78bfa;
            line-height: 1.5;
            margin-bottom: 20px;
        }

        .ai-modal-input {
            width: 100%;
            background: rgba(0, 0, 0, 0.3);
            border: 1px solid rgba(168, 85, 247, 0.3);
            border-radius: 12px;
            padding: 12px 16px;
            font-size: 13px;
            color: #ffffff;
            margin-bottom: 20px;
        }

        .ai-modal-input:focus {
            outline: none;
            border-color: #ec4899;
            box-shadow: 0 0 10px rgba(236, 72, 153, 0.2);
        }

        .ai-modal-btns {
            display: flex;
            justify-content: flex-end;
            gap: 12px;
        }

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

// Build and Inject DOM Elements
function injectDOM() {
    if (document.getElementById("ai-sidebar")) return;

    // Sidebar panel
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
        <div style="font-size:12px;color:#c084fc;">
🤖 Powered by EduShare AI
</div>
    `;
    document.body.appendChild(sidebar);

    // Modal
    const backdrop = document.createElement("div");
    backdrop.id = "ai-modal-backdrop";
    backdrop.className = "ai-modal-backdrop";
    backdrop.innerHTML = `
        <div class="ai-modal">
            <h3 class="ai-modal-title">Configure Gemini API Key</h3>
            <p class="ai-modal-desc">
                An API Key is needed to generate summaries, quizzes, and predicted questions directly from PDF text. 
                Your key is saved securely in your browser's local storage and is only sent to Google's Gemini API endpoints.
            </p>
            <input type="password" id="ai-api-key-input" class="ai-modal-input" placeholder="Paste your API key here (AIzaSy...)">
            <div class="ai-modal-btns">
                <button id="ai-modal-cancel" class="ai-modal-cancel">Cancel</button>
                <button id="ai-modal-save" class="ai-modal-save">Save Key</button>
            </div>
        </div>
    `;
    document.body.appendChild(backdrop);

    // Events
    document.getElementById("ai-sidebar-close").addEventListener("click", closeSidebar);

    document.getElementById("ai-modal-cancel").addEventListener("click", closeKeyModal);
    document.getElementById("ai-modal-save").addEventListener("click", saveApiKey);

    // Tab buttons
    document.querySelectorAll(".ai-tab-btn").forEach(btn => {
        btn.addEventListener("click", (e) => {
            document.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));

            btn.classList.add("active");
            const tabId = btn.getAttribute("data-tab");
            document.getElementById(`tab-${tabId}`).classList.add("active");

            handleTabClick(tabId);
        });
    });
}

// Ensure external libraries are loaded (Supabase and PDF.js)
async function ensureLibrariesLoaded() {
    // 1. Supabase
    if (typeof supabase === "undefined") {
        await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
    }
    if (!aiState.supabaseClient) {
        if (window.supabaseClient) {
            aiState.supabaseClient = window.supabaseClient;
        } else {
            aiState.supabaseClient = supabase.createClient(AI_CONFIG.supabaseUrl, AI_CONFIG.supabaseKey);
        }
    }

    // 2. PDF.js
    if (typeof pdfjsLib === "undefined") {
        await loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js");
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
}

function loadScript(url) {
    return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = url;
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
    });
}

// Show Sidebar
function openSidebar() {
    injectDOM();
    document.getElementById("ai-sidebar").classList.add("active");
}

function closeSidebar() {
    const sidebar = document.getElementById("ai-sidebar");
    if (sidebar) sidebar.classList.remove("active");
}

// API Key Modal Handling
function openKeyModal() {
    const backdrop = document.getElementById("ai-modal-backdrop");
    const input = document.getElementById("ai-api-key-input");
    input.value = localStorage.getItem("gemini_api_key") || "";
    backdrop.classList.add("active");
}

function closeKeyModal() {
    document.getElementById("ai-modal-backdrop").classList.remove("active");
}

function saveApiKey() {
    const key = document.getElementById("ai-api-key-input").value.trim();
    if (key) {
        localStorage.setItem("gemini_api_key", key);
        closeKeyModal();
        alert("API key saved successfully! You can now use AI features.");
    } else {
        localStorage.removeItem("gemini_api_key");
        closeKeyModal();
        alert("API key cleared.");
    }
}

function getApiKey() {
    return localStorage.getItem("gemini_api_key");
}

// Trigger side panel for a resource
async function initializeAISummarizer(resource) {
    injectAIStyles();
    openSidebar();

    aiState.resourceId = resource.id;
    aiState.pdfUrl = resource.pdf_url;
    aiState.subject = resource.subject || "Notes";
    aiState.college = resource.college || "";
    aiState.branch = resource.branch || "";
    aiState.semester = resource.semester || "";

    // Reset local cache
    aiState.extractedText = "";
    aiState.metadataLoaded = false;
    aiState.resourceData = null;

    // Highlight summary tab automatically
    document.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
    document.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));
    const summaryTabBtn = document.querySelector('.ai-tab-btn[data-tab="summary"]');
    if (summaryTabBtn) summaryTabBtn.classList.add("active");
    const summaryTabContent = document.getElementById("tab-summary");
    if (summaryTabContent) summaryTabContent.classList.add("active");

    // Load initial metadata and summaries
    await handleTabClick("summary");
}

// Load metadata from database
async function loadResourceFromDb() {
    if (aiState.metadataLoaded) return;

    await ensureLibrariesLoaded();

    if (aiState.resourceId) {
        // Query by id
        const { data, error } = await aiState.supabaseClient
            .from("resources")
            .select("*")
            .eq("id", aiState.resourceId)
            .single();

        if (!error && data) {
            aiState.resourceData = data;
            aiState.metadataLoaded = true;
            return;
        }
    }

    // Fallback: Query by pdf_url or subject/college if not present
    if (aiState.pdfUrl) {
        const { data, error } = await aiState.supabaseClient
            .from("resources")
            .select("*")
            .eq("pdf_url", aiState.pdfUrl);

        if (!error && data && data.length > 0) {
            aiState.resourceData = data[0];
            aiState.resourceId = data[0].id;
            aiState.metadataLoaded = true;
            return;
        }
    }

    // Dynamic Insertion: Create record in database if static PDF preview page that is not yet tracked in DB
    if (!aiState.metadataLoaded && aiState.pdfUrl) {
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
                status: "approved",
                downloads: 0
            }])
            .select()
            .single();

        if (!error && data) {
            aiState.resourceData = data;
            aiState.resourceId = data.id;
            aiState.metadataLoaded = true;
        } else {
            console.error("Dynamic resource insertion failed", error);
        }
    }
}

// Main logic for each tab click
async function handleTabClick(tabId) {
    const tabContainer = document.getElementById(`tab-${tabId}`);
    tabContainer.innerHTML = renderSkeleton();

    try {
        await loadResourceFromDb();

        // Check if database contains cached column data
        const dbColumnMap = {
            summary: "summary",
            quiz: "quiz",
            topics: "important_topics",
            predictions: "predicted_questions",
            flashcards: "flashcards",
            revision: "five_min_revision"
        };

        const cacheCol = dbColumnMap[tabId];

        if (aiState.resourceData && aiState.resourceData[cacheCol]) {
            // Render cached data!
            renderTabContent(tabId, JSON.parse(aiState.resourceData[cacheCol]));
            return;
        }

        // Cache not available, need to generate!


        // Extract PDF text if not extracted yet
        if (!aiState.extractedText) {
            tabContainer.innerHTML = renderSkeleton("Extracting note text...", "Loading pages with PDF.js");
            await extractPdfText();
        }

        if (!aiState.extractedText || aiState.extractedText.length < 20) {
            throw new Error("Could not extract enough text from this note. Please verify that this is a valid text PDF (and not scanned image only).");
        }

        // Call Gemini API
        tabContainer.innerHTML = renderSkeleton(`Generating ${tabId === "predictions" ? "predictions" : tabId} details...`, "Analyzing note text using Gemini AI");
        const generatedData = await generateWithGemini(tabId);

        // Save generated data to Supabase
        await saveCachedData(cacheCol, generatedData);

        // Update local object
        if (aiState.resourceData) {
            aiState.resourceData[cacheCol] = JSON.stringify(generatedData);
        }

        // Render final content
        renderTabContent(tabId, generatedData);

    } catch (e) {
        console.error(e);
        tabContainer.innerHTML = renderErrorCard("AI Generation Failed", e.message || "An unexpected error occurred during processing.");
    }
}

// Text Extraction using PDF.js
async function extractPdfText() {
    await ensureLibrariesLoaded();

    if (!aiState.pdfUrl) {
        throw new Error("PDF URL is missing. Cannot extract text.");
    }

    try {
        const pdf = await pdfjsLib.getDocument({
            url: aiState.pdfUrl,
            cMapPacked: true
        }).promise;

        let fullText = "";
        const maxPages = Math.min(pdf.numPages, 15); // Process up to 15 pages to stay within limits and ensure speed

        for (let i = 1; i <= maxPages; i++) {
            const page = await pdf.getPage(i);
            const content = await page.getTextContent();
            const pageText = content.items.map(item => item.str).join(" ");
            fullText += pageText + "\n";
        }

        aiState.extractedText = fullText.trim();
    } catch (e) {
        console.error("PDF.js text extraction failure", e);
        throw new Error("Failed to read the PDF document. This may be due to CORS permissions on your storage bucket, or a corrupt file. Ensure CORS is enabled on Supabase storage.");
    }
}

// Gemini API Connection
async function generateWithGemini(tabId) {

    const prompts = {
        summary: `Generate JSON:
{
  "summary":"...",
  "key_concepts":["..."],
  "important_definitions":[
    {"concept":"...","definition":"..."}
  ],
  "exam_revision_points":["..."]
}`,

        quiz: `Generate JSON:
{
  "questions":[
    {
      "question":"...",
      "options":["A","B","C","D"],
      "answer_index":0,
      "explanation":"..."
    }
  ]
}`,

        topics: `Generate JSON:
{
  "topics":[
    {
      "topic":"...",
      "importance":"High",
      "description":"..."
    }
  ]
}`,

        predictions: `Generate JSON:
{
  "predictions":[
    {
      "question":"...",
      "type":"Long",
      "likelihood":"Highly Likely",
      "hint":"..."
    }
  ]
}`,

        flashcards: `Generate JSON:
{
  "flashcards":[
    {
      "question":"...",
      "answer":"..."
    }
  ]
}`,

        revision: `Generate JSON:
{
  "quick_summary":"...",
  "cheat_sheet_items":["..."],
  "mnemonics_or_shortcuts":["..."]
}`
    };

    const textChunk = aiState.extractedText.slice(0, 30000);

    const prompt = `
${prompts[tabId]}

NOTES:

${textChunk}

Return ONLY valid JSON.
`;

    const response = await fetch("/api/generate-ai", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            prompt
        })
    });

    const result = await response.json();
    console.log("Backend Response:", result);
    alert(JSON.stringify(result).substring(0, 500));

    if (!result.success) {
        throw new Error(result.error || "AI generation failed");
    }

    try {
        const cleanText = result.text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        return JSON.parse(cleanText);
    } catch (err) {
        console.error(result.text);
        throw new Error("AI returned invalid JSON");
    }
}


// Update Supabase Database Caching Row
async function saveCachedData(column, data) {
    if (!aiState.resourceId) return;

    await ensureLibrariesLoaded();

    const updates = {};
    updates[column] = JSON.stringify(data);

    const { error } = await aiState.supabaseClient
        .from("resources")
        .update(updates)
        .eq("id", aiState.resourceId);

    if (error) {
        console.error(`Failed to cache ${column} in Supabase`, error);
    }
}

// Render Templates inside tabs
function renderTabContent(tabId, data) {
    const container = document.getElementById(`tab-${tabId}`);
    container.innerHTML = "";

    if (tabId === "summary") {
        container.innerHTML = `
            <div class="ai-card">
                <div class="ai-card-title">📌 Short Summary</div>
                <div class="ai-card-body">${data.summary}</div>
            </div>
            
            <div class="ai-card">
                <div class="ai-card-title">📚 Key Concepts</div>
                <div class="ai-card-body">
                    <ul>
                        ${data.key_concepts.map(item => `<li>${item}</li>`).join("")}
                    </ul>
                </div>
            </div>

            <div class="ai-card">
                <div class="ai-card-title">📝 Important Definitions</div>
                <div class="ai-card-body">
                    <ul>
                        ${data.important_definitions.map(item => `<li><b>${item.concept}:</b> ${item.definition}</li>`).join("")}
                    </ul>
                </div>
            </div>

            <div class="ai-card">
                <div class="ai-card-title">🎯 Exam Revision Points</div>
                <div class="ai-card-body">
                    <ul>
                        ${data.exam_revision_points.map(item => `<li>${item}</li>`).join("")}
                    </ul>
                </div>
            </div>
        `;
    } else if (tabId === "quiz") {
        aiState.quizQuestions = data.questions;
        aiState.currentQuizQuestion = 0;
        aiState.quizScore = 0;
        aiState.selectedAnswers = new Array(data.questions.length).fill(null);
        renderQuizQuestion();
    } else if (tabId === "topics") {
        container.innerHTML = data.topics.map(t => {
            const badgeColor = t.importance === "High" ? "#ef4444" : (t.importance === "Medium" ? "#f59e0b" : "#10b981");
            const badgeBg = t.importance === "High" ? "rgba(239, 68, 68, 0.15)" : (t.importance === "Medium" ? "rgba(245, 158, 11, 0.15)" : "rgba(16, 185, 129, 0.15)");
            return `
                <div class="ai-card">
                    <div class="flex items-center justify-between mb-3">
                        <div class="font-bold text-white text-base">${t.topic}</div>
                        <span style="font-size: 10px; font-weight:800; padding:3px 10px; border-radius:999px; color:${badgeColor}; background:${badgeBg}; border: 1px solid ${badgeColor}30;">
                            ${t.importance.toUpperCase()} IMPORTANCE
                        </span>
                    </div>
                    <div class="text-slate-300 text-xs leading-relaxed">${t.description}</div>
                </div>
            `;
        }).join("");
    } else if (tabId === "predictions") {
        container.innerHTML = data.predictions.map(p => {
            const badgeColor = p.likelihood === "Highly Likely" ? "#ec4899" : (p.likelihood === "Likely" ? "#a855f7" : "#3b82f6");
            const badgeBg = p.likelihood === "Highly Likely" ? "rgba(236, 72, 153, 0.15)" : (p.likelihood === "Likely" ? "rgba(168, 85, 247, 0.15)" : "rgba(59, 130, 246, 0.15)");
            return `
                <div class="ai-card">
                    <div class="flex items-center justify-between mb-3">
                        <span style="font-size:10px; font-weight:800; color:#cbd5e1; background:rgba(255,255,255,0.08); padding:3px 8px; border-radius:4px;">
                            ${p.type}
                        </span>
                        <span style="font-size: 10px; font-weight:800; padding:3px 10px; border-radius:999px; color:${badgeColor}; background:${badgeBg}; border: 1px solid ${badgeColor}30;">
                            🔥 ${p.likelihood.toUpperCase()}
                        </span>
                    </div>
                    <div class="text-white font-bold text-sm mb-3 leading-snug">${p.question}</div>
                    <div class="text-slate-400 text-xs" style="background:rgba(0,0,0,0.2); padding:10px; border-radius:8px;">
                        💡 <b>Exam Hint:</b> ${p.hint}
                    </div>
                </div>
            `;
        }).join("");
    } else if (tabId === "flashcards") {
        aiState.flashcardDeck = data.flashcards;
        aiState.currentFlashcard = 0;
        renderFlashcard();
    } else if (tabId === "revision") {
        container.innerHTML = `
            <div class="ai-card">
                <div class="ai-card-title">⚡ 5-Minute Summary</div>
                <div class="ai-card-body" style="font-style: italic;">"${data.quick_summary}"</div>
            </div>

            <div class="ai-card">
                <div class="ai-card-title">📝 Core Cheat-Sheet Notes</div>
                <div class="ai-card-body">
                    <ul>
                        ${data.cheat_sheet_items.map(item => `<li>${item}</li>`).join("")}
                    </ul>
                </div>
            </div>

            <div class="ai-card">
                <div class="ai-card-title">💡 Recall Mnemonics / Shortcuts</div>
                <div class="ai-card-body">
                    <ul>
                        ${data.mnemonics_or_shortcuts.map(item => `<li>${item}</li>`).join("")}
                    </ul>
                </div>
            </div>
        `;
    }
}

// Render Quiz Questions
function renderQuizQuestion() {
    const container = document.getElementById("tab-quiz");
    const qIndex = aiState.currentQuizQuestion;
    const questions = aiState.quizQuestions;

    if (qIndex >= questions.length) {
        // Render Score Board
        const percent = Math.round((aiState.quizScore / questions.length) * 100);
        container.innerHTML = `
            <div class="ai-card quiz-score-card">
                <div class="quiz-score-num">${aiState.quizScore} / ${questions.length}</div>
                <div class="text-white font-bold text-lg mb-2">Quiz Completed!</div>
                <p class="text-slate-400 text-xs mb-5">You scored ${percent}% on this notes quiz.</p>
                <button onclick="restartQuiz()" class="ai-retry-btn">📝 Try Again</button>
            </div>
        `;
        return;
    }

    const q = questions[qIndex];
    const prevAnswer = aiState.selectedAnswers[qIndex];

    container.innerHTML = `
        <div class="ai-card">
            <div class="flex items-center justify-between text-xs text-slate-500 mb-4">
                <span>PRACTICE QUIZ</span>
                <span>QUESTION ${qIndex + 1} OF ${questions.length}</span>
            </div>
            
            <div class="quiz-question">${q.question}</div>
            
            <div class="quiz-options">
                ${q.options.map((opt, i) => {
        let classes = "quiz-option";
        if (prevAnswer !== null) {
            if (i === q.answer_index) classes += " correct";
            else if (prevAnswer === i) classes += " incorrect";
        }
        return `<button onclick="submitQuizAnswer(${i})" class="${classes}" ${prevAnswer !== null ? "disabled" : ""}>${opt}</button>`;
    }).join("")}
            </div>

            ${prevAnswer !== null ? `
                <div class="quiz-explanation">
                    <b>Answer Explanation:</b><br>${q.explanation}
                </div>
                <button onclick="nextQuizQuestion()" class="ai-retry-btn w-full mt-4">
                    ${qIndex + 1 === questions.length ? "Finish Quiz 🏁" : "Next Question ➔"}
                </button>
            ` : ""}
        </div>
    `;
}

window.submitQuizAnswer = function (optIndex) {
    const qIndex = aiState.currentQuizQuestion;
    const q = aiState.quizQuestions[qIndex];
    aiState.selectedAnswers[qIndex] = optIndex;

    if (optIndex === q.answer_index) {
        aiState.quizScore++;
    }
    renderQuizQuestion();
};

window.nextQuizQuestion = function () {
    aiState.currentQuizQuestion++;
    renderQuizQuestion();
};

window.restartQuiz = function () {
    aiState.currentQuizQuestion = 0;
    aiState.quizScore = 0;
    aiState.selectedAnswers = new Array(aiState.quizQuestions.length).fill(null);
    renderQuizQuestion();
};

// Render Flashcards
function renderFlashcard() {
    const container = document.getElementById("tab-flashcards");
    const deck = aiState.flashcardDeck;
    const fIndex = aiState.currentFlashcard;

    if (!deck || deck.length === 0) {
        container.innerHTML = `<div class="text-center py-6 text-slate-500">No flashcards generated.</div>`;
        return;
    }

    const card = deck[fIndex];

    container.innerHTML = `
        <div class="flashcard-container" onclick="this.classList.toggle('flipped')">
            <div class="flashcard-inner">
                <div class="flashcard-front">
                    <div>
                        <span class="text-xs text-purple-400 font-bold uppercase tracking-widest block mb-4">QUESTION</span>
                        <div class="text-lg font-bold">${card.question}</div>
                        <span class="text-[10px] text-slate-500 block mt-6">👆 Click card to flip</span>
                    </div>
                </div>
                <div class="flashcard-back">
                    <div>
                        <span class="text-xs text-pink-400 font-bold uppercase tracking-widest block mb-4">ANSWER</span>
                        <div class="text-sm leading-relaxed">${card.answer}</div>
                        <span class="text-[10px] text-slate-500 block mt-6">👆 Click card to flip</span>
                    </div>
                </div>
            </div>
        </div>

        <div class="flashcard-nav">
            <button onclick="prevFlashcard()" class="flashcard-btn" ${fIndex === 0 ? "style='opacity:0.3;pointer-events:none;'" : ""}>◀</button>
            <span class="flashcard-indicator">CARD ${fIndex + 1} OF ${deck.length}</span>
            <button onclick="nextFlashcard()" class="flashcard-btn" ${fIndex + 1 === deck.length ? "style='opacity:0.3;pointer-events:none;'" : ""}>▶</button>
        </div>
    `;
}

window.prevFlashcard = function () {
    if (aiState.currentFlashcard > 0) {
        aiState.currentFlashcard--;
        renderFlashcard();
    }
};

window.nextFlashcard = function () {
    if (aiState.currentFlashcard + 1 < aiState.flashcardDeck.length) {
        aiState.currentFlashcard++;
        renderFlashcard();
    }
};

// HTML Templates Helper
function renderSkeleton(title = "Extracting content...", subtitle = "Please wait a moment") {
    return `
        <div class="ai-loading-container">
            <div class="ai-spinner"></div>
            <div class="ai-loading-title">${title}</div>
            <div class="ai-loading-sub">${subtitle}</div>
        </div>
    `;
}

function renderErrorCard(title, message, isApiKeyMissing = false) {
    return `
        <div class="ai-card ai-error-card">
            <div class="ai-error-icon">⚠️</div>
            <div class="ai-loading-title" style="color: #fca5a5;">${title}</div>
            <p class="ai-error-msg">${message}</p>
            ${isApiKeyMissing
            ? `<button onclick="openKeyModal()" class="ai-retry-btn">🔑 Configure Key</button>`
            : `<button onclick="handleTabClick(document.querySelector('.ai-tab-btn.active').getAttribute('data-tab'))" class="ai-retry-btn">🔄 Retry Process</button>`
        }
        </div>
    `;
}

// Global exposure
window.initAISummarizer = initializeAISummarizer;
window.openKeyModal = openKeyModal;
window.restartQuiz = restartQuiz;
window.submitQuizAnswer = submitQuizAnswer;
window.nextQuizQuestion = nextQuizQuestion;
window.prevFlashcard = prevFlashcard;
window.nextFlashcard = nextFlashcard;
