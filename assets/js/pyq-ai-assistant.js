/**
 * EduShare PYQ AI Assistant
 * ─────────────────────────────────────────────────────────────────────────────
 * Drop-in companion to ai-summarizer.js that activates automatically when
 * resource.type === "pyq".  All Notes AI features continue to work unchanged.
 *
 * Six PYQ-specific tools:
 *   1. predicted_questions  – likely future exam questions
 *   2. repeated_topics      – most frequently tested topics
 *   3. exam_pattern         – long/short split, marks & unit distribution
 *   4. long_questions       – curated important long answers
 *   5. short_questions      – curated important short answers
 *   6. topic_weightage      – unit-wise weightage analysis
 *
 * Uses the same:
 *   • generateWithGroq pipeline  (via /api/generate-ai)
 *   • extractedText / OCR system (shared with ai-summarizer.js)
 *   • Supabase caching           (separate columns to avoid clashing)
 *   • Sidebar DOM structure      (rebuilt when mode switches)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── PYQ tab definitions ───────────────────────────────────────────────────────
const PYQ_TABS = [
    { id: "predicted_questions", label: "🎯 Predicted Qs"    },
    { id: "repeated_topics",     label: "🔁 Repeated Topics" },
    { id: "exam_pattern",        label: "📊 Exam Pattern"    },
    { id: "long_questions",      label: "📝 Long Questions"  },
    { id: "short_questions",     label: "⚡ Short Questions"  },
    { id: "topic_weightage",     label: "⚖️ Weightage"       }
];

// Supabase column names for PYQ cache
const PYQ_DB_COLUMNS = {
    predicted_questions: "pyq_predicted_questions",
    repeated_topics:     "pyq_repeated_topics",
    exam_pattern:        "pyq_exam_pattern",
    long_questions:      "pyq_long_questions",
    short_questions:     "pyq_short_questions",
    topic_weightage:     "pyq_topic_weightage"
};

// ── Groq prompts ──────────────────────────────────────────────────────────────
const PYQ_PROMPTS = {

    predicted_questions: `You are an expert exam analyst.  Analyse the Previous Year Question paper text provided and predict the most likely questions for the NEXT exam.
Return ONLY a valid JSON object — no markdown, no fences, no explanation:
{
  "predictions": [
    {
      "question": "Full predicted question text",
      "type": "Long" | "Short",
      "likelihood": "Highly Likely" | "Likely" | "Possible",
      "basis": "Brief reason why this is likely (e.g., appeared 3 times, covers key unit)",
      "hint": "Key points the answer should cover"
    }
  ]
}
Generate at least 8 predictions covering different units.`,

    repeated_topics: `You are an expert exam analyst.  Identify the most frequently recurring topics in the Previous Year Question paper.
Return ONLY a valid JSON object:
{
  "topics": [
    {
      "topic": "Topic name",
      "frequency": 5,
      "units": ["Unit 1", "Unit 3"],
      "importance": "High" | "Medium" | "Low",
      "description": "Why this topic appears repeatedly and what sub-concepts to focus on."
    }
  ]
}
Sort by frequency descending.  Include at least 6 topics.`,

    exam_pattern: `You are an expert exam analyst.  Analyse the exam structure of the Previous Year Question paper.
Return ONLY a valid JSON object:
{
  "total_questions": 20,
  "total_marks": 100,
  "long_questions": {
    "count": 8,
    "marks_each": 10,
    "total_marks": 80,
    "description": "Detailed description questions requiring 300-500 word answers."
  },
  "short_questions": {
    "count": 12,
    "marks_each": 2,
    "total_marks": 24,
    "description": "Concise factual or definition-based questions."
  },
  "unit_distribution": [
    { "unit": "Unit 1 – Name", "question_count": 4, "marks": 20, "percentage": 20 }
  ],
  "marks_breakdown": [
    { "category": "Theory", "marks": 60, "percentage": 60 },
    { "category": "Numerical / Problem Solving", "marks": 40, "percentage": 40 }
  ],
  "pattern_summary": "One-paragraph insight about the exam structure and which areas are heavily tested."
}`,

    long_questions: `You are an expert exam analyst.  Extract and curate the most important long-answer questions from the Previous Year Question paper.
Return ONLY a valid JSON object:
{
  "questions": [
    {
      "question": "Full question text as it appeared in the paper",
      "marks": 10,
      "unit": "Unit name or number",
      "frequency": 2,
      "key_points": ["Point 1 to cover", "Point 2 to cover"],
      "importance": "High" | "Medium"
    }
  ]
}
Include at least 6 questions.  Prioritise by frequency and marks.`,

    short_questions: `You are an expert exam analyst.  Extract and curate the most important short-answer questions from the Previous Year Question paper.
Return ONLY a valid JSON object:
{
  "questions": [
    {
      "question": "Full question text",
      "marks": 2,
      "unit": "Unit name or number",
      "frequency": 3,
      "answer_hint": "One or two sentence guide to the correct answer",
      "importance": "High" | "Medium"
    }
  ]
}
Include at least 8 questions.  Prioritise by frequency.`,

    topic_weightage: `You are an expert exam analyst.  Analyse topic and unit weightage from the Previous Year Question paper.
Return ONLY a valid JSON object:
{
  "units": [
    {
      "unit": "Unit 1",
      "name": "Unit full name or main topics",
      "marks": 25,
      "percentage": 25,
      "question_count": 5,
      "importance": "High" | "Medium" | "Low",
      "top_topics": ["Topic A", "Topic B"]
    }
  ],
  "insights": [
    "Actionable study insight 1",
    "Actionable study insight 2"
  ],
  "recommended_focus": "One-paragraph study strategy based on the weightage data."
}`
};

// ─────────────────────────────────────────────────────────────────────────────
// CSS for PYQ sidebar (extends base ai-styles already injected)
// ─────────────────────────────────────────────────────────────────────────────
function injectPYQStyles() {
    if (document.getElementById("pyq-ai-styles")) return;
    const style = document.createElement("style");
    style.id = "pyq-ai-styles";
    style.innerHTML = `
        /* PYQ header accent */
        .pyq-header-accent { background: linear-gradient(135deg, #f59e0b, #ef4444) !important; }
        .pyq-header-badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            font-size: 9px;
            font-weight: 800;
            letter-spacing: .08em;
            text-transform: uppercase;
            padding: 3px 10px;
            border-radius: 999px;
            background: rgba(245,158,11,.15);
            border: 1px solid rgba(245,158,11,.35);
            color: #fbbf24;
            margin-bottom: 4px;
        }

        /* Likelihood pill colours */
        .pill-high   { color:#ef4444; background:rgba(239,68,68,.12);  border:1px solid rgba(239,68,68,.3);  }
        .pill-medium { color:#f59e0b; background:rgba(245,158,11,.12); border:1px solid rgba(245,158,11,.3); }
        .pill-low    { color:#10b981; background:rgba(16,185,129,.12); border:1px solid rgba(16,185,129,.3); }
        .pill-likely-high   { color:#ec4899; background:rgba(236,72,153,.12); border:1px solid rgba(236,72,153,.3); }
        .pill-likely-medium { color:#a855f7; background:rgba(168,85,247,.12); border:1px solid rgba(168,85,247,.3); }
        .pill-likely-low    { color:#3b82f6; background:rgba(59,130,246,.12); border:1px solid rgba(59,130,246,.3); }
        .pyq-pill {
            font-size:10px; font-weight:800;
            padding:3px 10px; border-radius:999px;
        }

        /* Pattern bar chart */
        .pyq-bar-track {
            height: 8px;
            background: rgba(255,255,255,.06);
            border-radius: 999px;
            overflow: hidden;
            margin-top: 6px;
        }
        .pyq-bar-fill {
            height: 100%;
            border-radius: 999px;
            transition: width .6s cubic-bezier(0.16,1,0.3,1);
        }

        /* Unit rows */
        .pyq-unit-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid rgba(255,255,255,.05);
            gap: 10px;
        }
        .pyq-unit-row:last-child { border-bottom: none; }

        /* Question cards */
        .pyq-q-card {
            background: rgba(255,255,255,.03);
            border: 1px solid rgba(168,85,247,.12);
            border-radius: 14px;
            padding: 14px 16px;
            margin-bottom: 14px;
            transition: border-color .2s;
        }
        .pyq-q-card:hover { border-color: rgba(245,158,11,.3); }
        .pyq-q-text { font-size:13.5px; font-weight:700; color:#ffffff; margin-bottom:10px; line-height:1.5; }
        .pyq-q-meta { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
        .pyq-q-tag {
            font-size:10px; font-weight:700;
            padding:2px 8px; border-radius:6px;
            background:rgba(255,255,255,.06); color:#94a3b8;
        }
        .pyq-hint {
            font-size:11.5px; color:#94a3b8; line-height:1.5;
            background:rgba(0,0,0,.2); padding:8px 10px; border-radius:8px;
        }
        .pyq-key-points { margin-top:8px; padding-left:0; list-style:none; }
        .pyq-key-points li { font-size:11.5px; color:#cbd5e1; padding-left:16px; position:relative; margin-bottom:4px; }
        .pyq-key-points li::before { content:"▸"; position:absolute; left:0; color:#f59e0b; }

        /* Stat numbers */
        .pyq-stat-box {
            background: rgba(255,255,255,.04);
            border: 1px solid rgba(168,85,247,.12);
            border-radius: 14px;
            padding: 16px;
            text-align: center;
        }
        .pyq-stat-num { font-size:28px; font-weight:900; color:#f59e0b; }
        .pyq-stat-label { font-size:11px; color:#64748b; margin-top:4px; }

        /* Insight bullets */
        .pyq-insight {
            display:flex; gap:10px; align-items:flex-start;
            font-size:12.5px; color:#e2e8f0; line-height:1.5;
            padding:10px 0;
            border-bottom:1px solid rgba(255,255,255,.04);
        }
        .pyq-insight:last-child { border-bottom:none; }
        .pyq-insight-icon { font-size:14px; flex-shrink:0; }
    `;
    document.head.appendChild(style);
}

// ─────────────────────────────────────────────────────────────────────────────
// Build the PYQ sidebar DOM (replaces Notes tabs while preserving structure)
// ─────────────────────────────────────────────────────────────────────────────
function buildPYQSidebar() {
    const sidebar = document.getElementById("ai-sidebar");
    if (!sidebar) return;

    // Header
    sidebar.querySelector(".ai-sidebar-logo-icon").textContent = "📄";
    sidebar.querySelector(".ai-sidebar-logo-icon").classList.add("pyq-header-accent");
    sidebar.querySelector(".ai-sidebar-title").textContent = "PYQ AI Analyser";
    sidebar.querySelector(".ai-sidebar-subtitle").textContent = "Previous Year Question Intelligence";

    // Footer
    const footer = sidebar.querySelector(".ai-sidebar-footer");
    if (footer) footer.textContent = "📄 Powered by EduShare AI · PYQ Mode · Groq llama-3.1-8b";

    // Tabs
    const tabsEl = sidebar.querySelector(".ai-sidebar-tabs");
    tabsEl.innerHTML = PYQ_TABS.map((t, i) =>
        `<button class="ai-tab-btn ${i === 0 ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
    ).join("");

    // Content panes
    const contentEl = sidebar.querySelector(".ai-sidebar-content");
    contentEl.innerHTML = PYQ_TABS.map((t, i) =>
        `<div class="ai-tab-content ${i === 0 ? "active" : ""}" id="tab-${t.id}"></div>`
    ).join("");

    // Re-bind tab click events
    tabsEl.querySelectorAll(".ai-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            tabsEl.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
            contentEl.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            const tabId = btn.getAttribute("data-tab");
            document.getElementById(`tab-${tabId}`).classList.add("active");
            handlePYQTabClick(tabId);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Restore Notes sidebar DOM (called when switching back to a notes resource)
// ─────────────────────────────────────────────────────────────────────────────
function buildNotesSidebar() {
    const sidebar = document.getElementById("ai-sidebar");
    if (!sidebar) return;

    const logoIcon = sidebar.querySelector(".ai-sidebar-logo-icon");
    logoIcon.textContent = "🤖";
    logoIcon.classList.remove("pyq-header-accent");
    sidebar.querySelector(".ai-sidebar-title").textContent  = "EduShare AI Assistant";
    sidebar.querySelector(".ai-sidebar-subtitle").textContent = "Smart Academic Ecosystem";

    const footer = sidebar.querySelector(".ai-sidebar-footer");
    if (footer) footer.textContent = "🤖 Powered by EduShare AI · Groq llama-3.1-8b";

    const NOTES_TABS = [
        { id: "summary",     label: "🤖 Summary"       },
        { id: "quiz",        label: "🧠 MCQ Quiz"      },
        { id: "topics",      label: "📌 Topics"        },
        { id: "predictions", label: "🎯 Predictions"   },
        { id: "flashcards",  label: "🗂 Flashcards"    },
        { id: "revision",    label: "⚡ 5-Min Revision" }
    ];

    const tabsEl    = sidebar.querySelector(".ai-sidebar-tabs");
    const contentEl = sidebar.querySelector(".ai-sidebar-content");

    tabsEl.innerHTML = NOTES_TABS.map((t, i) =>
        `<button class="ai-tab-btn ${i === 0 ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`
    ).join("");

    contentEl.innerHTML = NOTES_TABS.map((t, i) =>
        `<div class="ai-tab-content ${i === 0 ? "active" : ""}" id="tab-${t.id}"></div>`
    ).join("");

    tabsEl.querySelectorAll(".ai-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            tabsEl.querySelectorAll(".ai-tab-btn").forEach(b => b.classList.remove("active"));
            contentEl.querySelectorAll(".ai-tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            const tabId = btn.getAttribute("data-tab");
            document.getElementById(`tab-${tabId}`).classList.add("active");
            window.handleTabClick(tabId);
        });
    });
}

// ─────────────────────────────────────────────────────────────────────────────
// Main PYQ tab handler (mirrors handleTabClick from ai-summarizer.js)
// ─────────────────────────────────────────────────────────────────────────────
async function handlePYQTabClick(tabId) {
    const tabContainer = document.getElementById(`tab-${tabId}`);
    if (!tabContainer) return;

    // Borrow renderSkeleton from ai-summarizer.js (it's module-level, not exported,
    // so we redefine a local copy below — see pyqRenderSkeleton)
    tabContainer.innerHTML = pyqRenderSkeleton();

    try {
        // ── Re-use ai-summarizer state & DB helpers ───────────────────────────
        // aiState is shared global from ai-summarizer.js
        if (typeof loadResourceFromDb === "function") await loadResourceFromDb();

        // ── Cache check ───────────────────────────────────────────────────────
        const cacheCol = PYQ_DB_COLUMNS[tabId];
        if (aiState.resourceData?.[cacheCol]) {
            try {
                renderPYQTabContent(tabId, JSON.parse(aiState.resourceData[cacheCol]));
                return;
            } catch {
                console.warn("[pyq-ai] Cached PYQ data invalid JSON, regenerating.");
            }
        }

        // ── Text extraction (re-use aiState.extractedText if already done) ───
        if (!aiState.extractedText) {
            tabContainer.innerHTML = pyqRenderSkeleton("Reading PYQ PDF...", "Extracting questions with PDF.js");
            if (typeof extractPdfText === "function") await extractPdfText();

            if (aiState.extractedText.length < 50) {
                tabContainer.innerHTML = pyqRenderSkeleton("Scanned paper detected...", "Running OCR — may take 20–40 s");
                if (typeof window.runOCR === "function") {
                    aiState.extractedText = await window.runOCR(aiState.pdfUrl) || "";
                }
            }
        }

        if (!aiState.extractedText || aiState.extractedText.length < 50) {
            throw new Error("Could not extract readable text from this PYQ PDF. Ensure the file is not password-protected or blank.");
        }

        // ── Groq generation ───────────────────────────────────────────────────
        tabContainer.innerHTML = pyqRenderSkeleton(`Analysing ${tabId.replace(/_/g, " ")}...`, "Running PYQ intelligence with Groq AI");

        const data = await generatePYQWithGroq(tabId);

        // ── Cache result ──────────────────────────────────────────────────────
        if (typeof saveCachedData === "function") {
            await saveCachedData(cacheCol, data);
        }
        if (aiState.resourceData) aiState.resourceData[cacheCol] = JSON.stringify(data);

        renderPYQTabContent(tabId, data);

    } catch (e) {
        console.error("[pyq-ai] Tab error:", e);
        tabContainer.innerHTML = pyqRenderError("PYQ Analysis Failed", e.message || "An unexpected error occurred.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Groq call — same pipeline, PYQ-specific prompts
// ─────────────────────────────────────────────────────────────────────────────
async function generatePYQWithGroq(tabId) {
    const CLIENT_MAX = 8_000;
    const textChunk  = aiState.extractedText.slice(0, CLIENT_MAX);

    const fullPrompt = `${PYQ_PROMPTS[tabId]}

---
PREVIOUS YEAR QUESTION PAPER TEXT (extracted from PDF):

${textChunk}

---
Return ONLY valid JSON matching the structure above. Do not include any explanation, markdown, or code fences.`;

    let response;
    try {
        response = await fetch("/api/generate-ai", {
            method:  "POST",
            headers: { "Content-Type": "application/json" },
            body:    JSON.stringify({ prompt: fullPrompt })
        });
    } catch (netErr) {
        throw new Error("Network error: could not reach the AI backend.");
    }

    let responseText;
    try { responseText = await response.text(); }
    catch { throw new Error("Failed to read the server response."); }

    if (!responseText || !responseText.trim()) {
        throw new Error(`Server returned an empty response (HTTP ${response.status}).`);
    }

    let result;
    try { result = JSON.parse(responseText); }
    catch {
        throw new Error(`Server returned an invalid response (HTTP ${response.status}). Check Vercel logs.`);
    }

    if (!result.success) throw new Error(result.error || "AI generation failed on the server.");

    try {
        const clean = result.text
            .replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
        return JSON.parse(clean);
    } catch {
        throw new Error("The AI returned a response that could not be parsed as JSON. Please try again.");
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton / Error helpers (local copies so this file is standalone)
// ─────────────────────────────────────────────────────────────────────────────
function pyqRenderSkeleton(title = "Analysing PYQ...", subtitle = "Please wait a moment") {
    return `
        <div class="ai-loading-container">
            <div class="ai-spinner"></div>
            <div class="ai-loading-title">${title}</div>
            <div class="ai-loading-sub">${subtitle}</div>
        </div>`;
}

function pyqRenderError(title, message) {
    return `
        <div class="ai-card ai-error-card">
            <div class="ai-error-icon">⚠️</div>
            <div class="ai-loading-title" style="color:#fca5a5;">${title}</div>
            <p class="ai-error-msg">${message}</p>
            <button onclick="handlePYQTabClick(document.querySelector('.ai-tab-btn.active')?.getAttribute('data-tab') || 'predicted_questions')" class="ai-retry-btn">
                🔄 Retry
            </button>
        </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────
function renderPYQTabContent(tabId, data) {
    const container = document.getElementById(`tab-${tabId}`);
    if (!container) return;
    container.innerHTML = "";

    switch (tabId) {
        case "predicted_questions": renderPredictedQuestions(container, data); break;
        case "repeated_topics":     renderRepeatedTopics(container, data);     break;
        case "exam_pattern":        renderExamPattern(container, data);        break;
        case "long_questions":      renderLongQuestions(container, data);      break;
        case "short_questions":     renderShortQuestions(container, data);     break;
        case "topic_weightage":     renderTopicWeightage(container, data);     break;
    }
}

// 1. Predicted Questions ──────────────────────────────────────────────────────
function renderPredictedQuestions(el, data) {
    const preds = data.predictions ?? [];
    if (!preds.length) { el.innerHTML = _emptyState("No predictions generated."); return; }

    el.innerHTML = `
        <div class="ai-card" style="background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.2);margin-bottom:20px;">
            <div class="ai-card-title" style="color:#fbbf24;">🎯 Predicted Questions for Next Exam</div>
            <div style="font-size:12px;color:#94a3b8;line-height:1.5;">Based on frequency analysis of this PYQ paper. Higher likelihood = appeared more often or covers heavily-tested units.</div>
        </div>
    ` + preds.map(p => {
        const [pillCls, likelyLabel] = _likelihoodStyle(p.likelihood);
        const typeCls = p.type === "Long" ? "color:#a855f7" : "color:#3b82f6";
        return `
        <div class="pyq-q-card">
            <div class="pyq-q-meta">
                <span class="pyq-q-tag" style="${typeCls};background:rgba(168,85,247,.08);">${p.type}</span>
                <span class="pyq-pill ${pillCls}">🔥 ${likelyLabel}</span>
                ${p.basis ? `<span class="pyq-q-tag">📌 ${p.basis}</span>` : ""}
            </div>
            <div class="pyq-q-text">${p.question}</div>
            <div class="pyq-hint">💡 <b>Hint:</b> ${p.hint}</div>
        </div>`;
    }).join("");
}

// 2. Most Repeated Topics ─────────────────────────────────────────────────────
function renderRepeatedTopics(el, data) {
    const topics = data.topics ?? [];
    if (!topics.length) { el.innerHTML = _emptyState("No repeated topics found."); return; }

    const maxFreq = Math.max(...topics.map(t => t.frequency || 1));

    el.innerHTML = `
        <div class="ai-card" style="background:rgba(168,85,247,.06);border-color:rgba(168,85,247,.2);margin-bottom:20px;">
            <div class="ai-card-title">🔁 Most Repeated Topics</div>
            <div style="font-size:12px;color:#94a3b8;">Topics sorted by how often they appear across question papers. Focus highest-frequency topics first.</div>
        </div>
    ` + topics.map(t => {
        const [impCls] = _importanceStyle(t.importance);
        const pct = Math.round(((t.frequency || 1) / maxFreq) * 100);
        const barColor = t.importance === "High" ? "#ef4444" : t.importance === "Medium" ? "#f59e0b" : "#10b981";
        return `
        <div class="ai-card" style="margin-bottom:14px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <span style="font-weight:700;color:#fff;font-size:14px;">${t.topic}</span>
                <span class="pyq-pill ${impCls}">${t.importance.toUpperCase()}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:11px;color:#64748b;">Appeared</span>
                <span style="font-size:13px;font-weight:800;color:#fbbf24;">${t.frequency}×</span>
                ${(t.units ?? []).map(u => `<span class="pyq-q-tag">${u}</span>`).join("")}
            </div>
            <div class="pyq-bar-track">
                <div class="pyq-bar-fill" style="width:${pct}%;background:${barColor};"></div>
            </div>
            <div style="font-size:12px;color:#94a3b8;margin-top:8px;line-height:1.4;">${t.description}</div>
        </div>`;
    }).join("");
}

// 3. Exam Pattern Analysis ────────────────────────────────────────────────────
function renderExamPattern(el, data) {
    const lq = data.long_questions  ?? {};
    const sq = data.short_questions ?? {};
    const units = data.unit_distribution ?? [];
    const marks = data.marks_breakdown   ?? [];

    // Stat boxes
    el.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px;">
            <div class="pyq-stat-box">
                <div class="pyq-stat-num">${data.total_questions ?? "—"}</div>
                <div class="pyq-stat-label">Total Questions</div>
            </div>
            <div class="pyq-stat-box">
                <div class="pyq-stat-num">${data.total_marks ?? "—"}</div>
                <div class="pyq-stat-label">Total Marks</div>
            </div>
            <div class="pyq-stat-box">
                <div class="pyq-stat-num">${units.length || "—"}</div>
                <div class="pyq-stat-label">Units Covered</div>
            </div>
        </div>

        <!-- Long vs Short -->
        <div class="ai-card" style="margin-bottom:16px;">
            <div class="ai-card-title">📋 Question Type Split</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:4px;">
                <div style="background:rgba(168,85,247,.08);border:1px solid rgba(168,85,247,.2);border-radius:12px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:900;color:#a855f7;">${lq.count ?? 0}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Long Questions</div>
                    <div style="font-size:10px;color:#64748b;">${lq.marks_each ?? "?"}M each · ${lq.total_marks ?? "?"}M total</div>
                </div>
                <div style="background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.2);border-radius:12px;padding:14px;text-align:center;">
                    <div style="font-size:22px;font-weight:900;color:#3b82f6;">${sq.count ?? 0}</div>
                    <div style="font-size:11px;color:#94a3b8;margin-bottom:4px;">Short Questions</div>
                    <div style="font-size:10px;color:#64748b;">${sq.marks_each ?? "?"}M each · ${sq.total_marks ?? "?"}M total</div>
                </div>
            </div>
            ${lq.description ? `<p style="font-size:11.5px;color:#94a3b8;margin-top:12px;line-height:1.4;">📝 ${lq.description}</p>` : ""}
            ${sq.description ? `<p style="font-size:11.5px;color:#94a3b8;margin-top:6px;line-height:1.4;">⚡ ${sq.description}</p>` : ""}
        </div>

        <!-- Unit Distribution -->
        ${units.length ? `
        <div class="ai-card" style="margin-bottom:16px;">
            <div class="ai-card-title">📐 Unit Distribution</div>
            ${units.map(u => {
                const pct = u.percentage ?? 0;
                const barColor = pct >= 25 ? "#ef4444" : pct >= 15 ? "#f59e0b" : "#10b981";
                return `
                <div class="pyq-unit-row">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:12.5px;font-weight:700;color:#e2e8f0;margin-bottom:4px;truncate;">${u.unit}</div>
                        <div class="pyq-bar-track" style="max-width:140px;">
                            <div class="pyq-bar-fill" style="width:${pct}%;background:${barColor};"></div>
                        </div>
                    </div>
                    <div style="text-align:right;flex-shrink:0;">
                        <div style="font-size:13px;font-weight:800;color:#fbbf24;">${u.marks}M</div>
                        <div style="font-size:10px;color:#64748b;">${u.question_count} Qs · ${pct}%</div>
                    </div>
                </div>`;
            }).join("")}
        </div>` : ""}

        <!-- Marks Breakdown -->
        ${marks.length ? `
        <div class="ai-card" style="margin-bottom:16px;">
            <div class="ai-card-title">⚖️ Marks Breakdown</div>
            ${marks.map(m => `
                <div class="pyq-unit-row">
                    <span style="font-size:13px;color:#e2e8f0;">${m.category}</span>
                    <span style="font-size:13px;font-weight:800;color:#a855f7;">${m.marks}M (${m.percentage}%)</span>
                </div>`).join("")}
        </div>` : ""}

        <!-- Pattern Summary -->
        ${data.pattern_summary ? `
        <div class="ai-card" style="background:rgba(245,158,11,.05);border-color:rgba(245,158,11,.2);">
            <div class="ai-card-title" style="color:#fbbf24;">💡 Pattern Insight</div>
            <div style="font-size:13px;color:#e2e8f0;line-height:1.6;">${data.pattern_summary}</div>
        </div>` : ""}
    `;
}

// 4. Important Long Questions ─────────────────────────────────────────────────
function renderLongQuestions(el, data) {
    const qs = data.questions ?? [];
    if (!qs.length) { el.innerHTML = _emptyState("No long questions extracted."); return; }

    el.innerHTML = `
        <div class="ai-card" style="background:rgba(168,85,247,.06);border-color:rgba(168,85,247,.2);margin-bottom:20px;">
            <div class="ai-card-title">📝 Important Long Questions</div>
            <div style="font-size:12px;color:#94a3b8;">Sorted by frequency and marks. These are highest-priority for exam prep.</div>
        </div>
    ` + qs.map((q, i) => {
        const [impCls] = _importanceStyle(q.importance);
        return `
        <div class="pyq-q-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:10px;font-weight:800;color:#64748b;background:rgba(255,255,255,.06);padding:2px 8px;border-radius:4px;">Q${i + 1}</span>
                <span class="pyq-pill ${impCls}">${(q.importance ?? "").toUpperCase()}</span>
                ${q.marks ? `<span class="pyq-q-tag" style="color:#fbbf24;">${q.marks}M</span>` : ""}
                ${q.frequency > 1 ? `<span class="pyq-q-tag" style="color:#ef4444;">🔁 ${q.frequency}×</span>` : ""}
                ${q.unit ? `<span class="pyq-q-tag">${q.unit}</span>` : ""}
            </div>
            <div class="pyq-q-text">${q.question}</div>
            ${(q.key_points ?? []).length ? `
                <ul class="pyq-key-points">${q.key_points.map(p => `<li>${p}</li>`).join("")}</ul>
            ` : ""}
        </div>`;
    }).join("");
}

// 5. Important Short Questions ────────────────────────────────────────────────
function renderShortQuestions(el, data) {
    const qs = data.questions ?? [];
    if (!qs.length) { el.innerHTML = _emptyState("No short questions extracted."); return; }

    el.innerHTML = `
        <div class="ai-card" style="background:rgba(59,130,246,.06);border-color:rgba(59,130,246,.2);margin-bottom:20px;">
            <div class="ai-card-title" style="color:#60a5fa;">⚡ Important Short Questions</div>
            <div style="font-size:12px;color:#94a3b8;">Quick-answer questions that appear frequently. Know these definitions and concepts cold.</div>
        </div>
    ` + qs.map((q, i) => {
        const [impCls] = _importanceStyle(q.importance);
        return `
        <div class="pyq-q-card">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <span style="font-size:10px;font-weight:800;color:#64748b;background:rgba(255,255,255,.06);padding:2px 8px;border-radius:4px;">SQ${i + 1}</span>
                <span class="pyq-pill ${impCls}">${(q.importance ?? "").toUpperCase()}</span>
                ${q.marks ? `<span class="pyq-q-tag" style="color:#fbbf24;">${q.marks}M</span>` : ""}
                ${q.frequency > 1 ? `<span class="pyq-q-tag" style="color:#ef4444;">🔁 ${q.frequency}×</span>` : ""}
                ${q.unit ? `<span class="pyq-q-tag">${q.unit}</span>` : ""}
            </div>
            <div class="pyq-q-text">${q.question}</div>
            ${q.answer_hint ? `<div class="pyq-hint">💡 ${q.answer_hint}</div>` : ""}
        </div>`;
    }).join("");
}

// 6. Topic Weightage Analysis ─────────────────────────────────────────────────
function renderTopicWeightage(el, data) {
    const units   = data.units    ?? [];
    const insights= data.insights ?? [];
    if (!units.length) { el.innerHTML = _emptyState("No weightage data found."); return; }

    const maxMarks = Math.max(...units.map(u => u.marks || 0));

    el.innerHTML = `
        <div class="ai-card" style="background:rgba(16,185,129,.06);border-color:rgba(16,185,129,.2);margin-bottom:20px;">
            <div class="ai-card-title" style="color:#34d399;">⚖️ Topic Weightage Analysis</div>
            <div style="font-size:12px;color:#94a3b8;">Unit-wise breakdown of marks and question frequency. Allocate study time proportionally.</div>
        </div>
    ` + units.map(u => {
        const pct = u.percentage ?? Math.round(((u.marks || 0) / (units.reduce((s,x) => s + (x.marks||0), 0) || 1)) * 100);
        const [impCls] = _importanceStyle(u.importance);
        const barColor = u.importance === "High" ? "#ef4444" : u.importance === "Medium" ? "#f59e0b" : "#10b981";
        return `
        <div class="ai-card" style="margin-bottom:14px;">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px;">
                <div>
                    <div style="font-size:13px;font-weight:800;color:#fff;">${u.unit}</div>
                    ${u.name ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">${u.name}</div>` : ""}
                </div>
                <div style="text-align:right;">
                    <div style="font-size:20px;font-weight:900;color:#fbbf24;">${pct}%</div>
                    <div style="font-size:10px;color:#64748b;">${u.marks}M · ${u.question_count} Qs</div>
                </div>
            </div>
            <div class="pyq-bar-track" style="margin-bottom:10px;">
                <div class="pyq-bar-fill" style="width:${pct}%;background:${barColor};"></div>
            </div>
            <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
                <span class="pyq-pill ${impCls}">${(u.importance ?? "").toUpperCase()}</span>
                ${(u.top_topics ?? []).map(t => `<span class="pyq-q-tag">${t}</span>`).join("")}
            </div>
        </div>`;
    }).join("") +

    (insights.length ? `
        <div class="ai-card" style="margin-bottom:16px;">
            <div class="ai-card-title">💡 Study Insights</div>
            ${insights.map(ins => `
                <div class="pyq-insight">
                    <span class="pyq-insight-icon">✦</span>
                    <span>${ins}</span>
                </div>`).join("")}
        </div>` : "") +

    (data.recommended_focus ? `
        <div class="ai-card" style="background:rgba(245,158,11,.05);border-color:rgba(245,158,11,.2);">
            <div class="ai-card-title" style="color:#fbbf24;">🎯 Recommended Focus Strategy</div>
            <div style="font-size:13px;color:#e2e8f0;line-height:1.6;">${data.recommended_focus}</div>
        </div>` : "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────
function _likelihoodStyle(likelihood) {
    if (likelihood === "Highly Likely") return ["pill-likely-high",   "Highly Likely"];
    if (likelihood === "Likely")        return ["pill-likely-medium", "Likely"];
    return                                     ["pill-likely-low",    "Possible"];
}

function _importanceStyle(importance) {
    if (importance === "High")   return ["pill-high"];
    if (importance === "Medium") return ["pill-medium"];
    return                              ["pill-low"];
}

function _emptyState(msg) {
    return `<div style="text-align:center;padding:40px;color:#64748b;font-size:13px;">${msg}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public entry point — called from preview.html instead of initAISummarizer
// when resource.type === "pyq"
// ─────────────────────────────────────────────────────────────────────────────
async function initPYQAssistant(resource, initialTab = "predicted_questions") {
    // 1. Inject base Notes styles (ai-summarizer.js may not have been called yet)
    if (typeof injectAIStyles === "function") injectAIStyles();
    injectPYQStyles();

    // 2. Open / create the sidebar (ai-summarizer.js handles DOM creation)
    if (typeof openSidebar === "function") openSidebar();
    else {
        // Fallback if called standalone
        const s = document.getElementById("ai-sidebar");
        if (s) s.classList.add("active");
    }

    // 3. Populate shared aiState (same fields as initAISummarizer)
    aiState.resourceId       = resource.id;
    aiState.pdfUrl           = resource.pdf_url;
    aiState.subject          = resource.subject || "PYQ";
    aiState.college          = resource.college  || "";
    aiState.branch           = resource.branch   || "";
    aiState.semester         = resource.semester || "";
    aiState.extractedText    = "";
    aiState.extractionMethod = null;
    aiState.metadataLoaded   = false;
    aiState.resourceData     = null;

    // 4. Rebuild sidebar for PYQ mode
    buildPYQSidebar();

    // 5. Activate the requested tab
    const validTabs = PYQ_TABS.map(t => t.id);
    const activeTab = validTabs.includes(initialTab) ? initialTab : "predicted_questions";

    document.querySelectorAll(".ai-tab-btn").forEach(b => {
        b.classList.toggle("active", b.getAttribute("data-tab") === activeTab);
    });
    document.querySelectorAll(".ai-tab-content").forEach(c => {
        c.classList.toggle("active", c.id === `tab-${activeTab}`);
    });

    await handlePYQTabClick(activeTab);
}

// ─────────────────────────────────────────────────────────────────────────────
// Global exports
// ─────────────────────────────────────────────────────────────────────────────
window.initPYQAssistant    = initPYQAssistant;
window.handlePYQTabClick   = handlePYQTabClick;
window.buildPYQSidebar     = buildPYQSidebar;
window.buildNotesSidebar   = buildNotesSidebar;