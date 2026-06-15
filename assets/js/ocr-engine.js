/**
 * ocr-engine.js
 * Browser-side OCR using PDF.js + Tesseract.js
 *
 * BUGS FIXED:
 *  1. Tesseract.js was not being loaded/awaited before runOCR() was called.
 *     If the script tag for Tesseract is missing or loads slowly, `Tesseract`
 *     is undefined and the function throws synchronously inside the for-loop,
 *     leaving extractedText as an empty string — which then propagates to the
 *     backend as an empty prompt, making Groq return a near-empty response.
 *
 *  2. Individual page failures (corrupt page, render timeout) crashed the
 *     entire OCR run and returned "" instead of the text extracted so far.
 *     Now each page is wrapped in a try/catch and skipped on failure.
 *
 *  3. Tesseract.recognize() was called with no worker config — the default
 *     auto-downloads the language pack on every call. This races with the
 *     in-progress PDF render. Fixed by creating a single worker, loading
 *     the language once, and terminating after all pages are done.
 *
 *  4. No minimum quality guard: if OCR yields only whitespace / garbage
 *     symbols the caller's threshold check (< 200 chars) would still re-
 *     trigger OCR endlessly. Added a clean-text sanity check before returning.
 *
 *  5. pdfjsLib global availability was not verified inside this module,
 *     leading to a confusing "pdfjsLib is not defined" error if the caller
 *     and this module load in a different order.
 */

const OCR_MAX_PAGES = 10; // Keep in sync with extractPdfText limit
const OCR_RENDER_SCALE = 2; // Higher = better OCR quality, more memory

/**
 * Ensure Tesseract.js is loaded in the page.
 * If the caller's HTML already has a <script> tag for Tesseract, this is a no-op.
 */
async function ensureTesseract() {
    if (typeof Tesseract !== "undefined") return;

    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        // Pin to a stable CDN version to avoid breaking changes
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/4.1.1/tesseract.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Failed to load Tesseract.js from CDN."));
        document.head.appendChild(script);
    });
}

/**
 * Ensure PDF.js is loaded (defensive — ai-summarizer.js also does this,
 * but ocr-engine.js may be used standalone).
 */
async function ensurePdfJs() {
    if (typeof pdfjsLib !== "undefined") return;

    await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
        script.onload = () => {
            pdfjsLib.GlobalWorkerOptions.workerSrc =
                "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
            resolve();
        };
        script.onerror = () => reject(new Error("Failed to load PDF.js from CDN."));
        document.head.appendChild(script);
    });
}

/**
 * Run OCR on a PDF URL.
 *
 * @param {string} pdfUrl  - Full URL to the PDF file (must be CORS-accessible).
 * @param {Function} [onProgress] - Optional callback(pageNum, totalPages, pageText)
 * @returns {Promise<string>} - Concatenated OCR text from all pages.
 */
async function runOCR(pdfUrl, onProgress) {
    if (!pdfUrl) throw new Error("runOCR: pdfUrl is required.");

    // ── Load dependencies ────────────────────────────────────────────────────
    await ensurePdfJs();
    await ensureTesseract();

    // ── Open PDF ─────────────────────────────────────────────────────────────
    let pdf;
    try {
        pdf = await pdfjsLib.getDocument({ url: pdfUrl, cMapPacked: true }).promise;
    } catch (err) {
        throw new Error(`OCR: Could not open PDF — ${err.message}. Check CORS settings on your storage bucket.`);
    }

    const totalPages = Math.min(pdf.numPages, OCR_MAX_PAGES);

    // ── Create a single Tesseract worker (much faster than one per page) ─────
    let worker;
    try {
        worker = await Tesseract.createWorker("eng", 1, {
            // Suppress verbose Tesseract logs in the console
            logger: () => {}
        });
    } catch (err) {
        throw new Error(`OCR: Failed to initialise Tesseract worker — ${err.message}`);
    }

    let finalText = "";

    try {
        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
            try {
                // ── Render PDF page to canvas ─────────────────────────────────
                const page = await pdf.getPage(pageNum);
                const viewport = page.getViewport({ scale: OCR_RENDER_SCALE });

                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");
                canvas.width = viewport.width;
                canvas.height = viewport.height;

                await page.render({ canvasContext: ctx, viewport }).promise;

                // ── Run OCR on the rendered canvas ────────────────────────────
                const { data: { text } } = await worker.recognize(canvas);
                const pageText = (text || "").trim();

                if (pageText) {
                    finalText += pageText + "\n";
                }

                // Destroy canvas to free memory (important for large PDFs)
                canvas.width = 0;
                canvas.height = 0;

                if (typeof onProgress === "function") {
                    onProgress(pageNum, totalPages, pageText);
                }

            } catch (pageErr) {
                // A single bad page should not abort the whole document
                console.warn(`[ocr-engine] Page ${pageNum} failed, skipping:`, pageErr.message);
            }
        }
    } finally {
        // Always terminate the worker to avoid memory leaks
        await worker.terminate().catch(() => {});
    }

    // ── Sanity check: OCR on a blank/image-less scan returns garbage ─────────
    const cleanedText = finalText.trim();
    const meaningfulChars = cleanedText.replace(/[\s\W]/g, "").length;

    if (meaningfulChars < 50) {
        console.warn("[ocr-engine] OCR produced very little meaningful text. The PDF may be blank or purely graphical.");
    }

    return cleanedText;
}

window.runOCR = runOCR;