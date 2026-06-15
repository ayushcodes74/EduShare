async function runOCR(pdfUrl) {

    const pdf =
        await pdfjsLib.getDocument(pdfUrl).promise;

    let finalText = "";

    for (
        let pageNum = 1;
        pageNum <= Math.min(pdf.numPages, 10);
        pageNum++
    ) {

        const page =
            await pdf.getPage(pageNum);

        const viewport =
            page.getViewport({ scale: 2 });

        const canvas =
            document.createElement("canvas");

        const ctx =
            canvas.getContext("2d");

        canvas.width =
            viewport.width;

        canvas.height =
            viewport.height;

        await page.render({
            canvasContext: ctx,
            viewport
        }).promise;

        const {
            data: { text }
        } = await Tesseract.recognize(
            canvas,
            "eng"
        );

        finalText += text + "\n";
    }

    return finalText;
}

window.runOCR = runOCR;