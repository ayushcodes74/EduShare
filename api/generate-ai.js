/**
 * /api/generate-ai.js
 * Vercel Serverless Function — Groq AI Generation Endpoint
 *
 * BUGS FIXED:
 *  1. No explicit Content-Type header on the response → some Vercel edge
 *     runtimes returned an empty body when the handler threw before reaching
 *     res.json(). Added a top-level try/catch that always writes a JSON body.
 *  2. Groq occasionally returns a 429 (rate-limit) or 5xx; the old code called
 *     response.json() without checking response.ok, so a non-JSON error body
 *     caused an unhandled parse exception that killed the function mid-stream,
 *     producing an empty response to the client.
 *  3. Prompt truncation: very large OCR dumps (10-page scans) can push the
 *     prompt past Groq's 8 192-token context for llama-3.1-8b-instant.
 *     The function now checks Content-Length and hard-truncates the prompt
 *     server-side so the model always receives a safe payload.
 *  4. GROQ_API_KEY not set → crash before any response was sent. Now caught
 *     and returned as a 500 JSON error.
 */

const MAX_PROMPT_CHARS = 12_000; // ~3 000 tokens of safety margin for llama-3.1-8b

export default async function handler(req, res) {
    // ── Method guard ──────────────────────────────────────────────────────────
    if (req.method !== "POST") {
        return res.status(405).json({ success: false, error: "Method not allowed" });
    }

    // ── API key guard ─────────────────────────────────────────────────────────
    if (!process.env.GROQ_API_KEY) {
        console.error("[generate-ai] GROQ_API_KEY environment variable is not set.");
        return res.status(500).json({
            success: false,
            error: "Server configuration error: AI service key is missing."
        });
    }

    try {
        const { prompt } = req.body ?? {};

        if (!prompt || typeof prompt !== "string") {
            return res.status(400).json({ success: false, error: "prompt (string) is required." });
        }

        // ── Server-side prompt truncation (prevents Groq context overflow) ───
        const safePrompt = prompt.length > MAX_PROMPT_CHARS
            ? prompt.slice(0, MAX_PROMPT_CHARS) + "\n\n[...content truncated for token limit...]"
            : prompt;

        // ── Groq API call ─────────────────────────────────────────────────────
        let groqResponse;
        try {
            groqResponse = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.1-8b-instant",
                    messages: [{ role: "user", content: safePrompt }],
                    temperature: 0.3,
                    // Ask Groq for a structured response; keeps hallucinated markdown wrappers minimal
                    response_format: { type: "text" }
                })
            });
        } catch (networkErr) {
            // Fetch itself failed (DNS, timeout, etc.)
            console.error("[generate-ai] Network error reaching Groq:", networkErr.message);
            return res.status(502).json({
                success: false,
                error: "Could not reach the AI service. Please try again in a moment."
            });
        }

        // ── Handle non-OK HTTP from Groq ──────────────────────────────────────
        if (!groqResponse.ok) {
            let groqError = `Groq returned HTTP ${groqResponse.status}`;
            try {
                const errBody = await groqResponse.json();
                groqError = errBody?.error?.message || groqError;
                console.error("[generate-ai] Groq API error body:", JSON.stringify(errBody));
            } catch {
                // Body was not JSON (e.g. an HTML 503 page) — use the status string
            }

            // Surface rate-limit clearly so the frontend can show a helpful message
            if (groqResponse.status === 429) {
                return res.status(429).json({
                    success: false,
                    error: "AI rate limit reached. Please wait a few seconds and try again."
                });
            }

            return res.status(502).json({ success: false, error: groqError });
        }

        // ── Parse Groq response body ───────────────────────────────────────────
        let data;
        try {
            data = await groqResponse.json();
        } catch (parseErr) {
            console.error("[generate-ai] Failed to parse Groq JSON response:", parseErr.message);
            return res.status(502).json({
                success: false,
                error: "AI service returned an unreadable response. Please try again."
            });
        }

        // ── Validate content ──────────────────────────────────────────────────
        const rawText = data?.choices?.[0]?.message?.content;
        if (!rawText || typeof rawText !== "string" || rawText.trim() === "") {
            console.error("[generate-ai] Groq response missing content:", JSON.stringify(data));
            return res.status(500).json({
                success: false,
                error: "AI did not return any content. The prompt may be too long or the model is overloaded."
            });
        }

        // ── Strip markdown code fences (Groq sometimes wraps JSON in ```json) ─
        const cleanText = rawText
            .replace(/^```json\s*/i, "")
            .replace(/^```\s*/i, "")
            .replace(/\s*```$/i, "")
            .trim();

        return res.status(200).json({ success: true, text: cleanText });

    } catch (unexpectedErr) {
        // Catch-all: ensures the function ALWAYS returns a JSON body
        // (prevents the "Server returned empty response" error on the client)
        console.error("[generate-ai] Unexpected error:", unexpectedErr);
        return res.status(500).json({
            success: false,
            error: unexpectedErr?.message || "An unexpected server error occurred."
        });
    }
}
