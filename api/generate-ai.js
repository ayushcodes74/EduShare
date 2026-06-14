export default async function handler(req, res) {
    console.log("VERSION TEST 12345");
    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {
        const { prompt } = req.body;
        console.log("Prompt received:", prompt);

        const modelsResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY}`
        );

        const modelsData = await modelsResponse.json();

        console.log("AVAILABLE MODELS:");
        console.log(JSON.stringify(modelsData, null, 2));

        return res.status(200).json({
            success: false,
            error: JSON.stringify(modelsData)
        });

        const data = await response.json();

        console.log("Gemini Response:", JSON.stringify(data, null, 2));

        if (!data.candidates) {
            return res.status(500).json({
                success: false,
                error: JSON.stringify(data)
            });
        }

        const text = data.candidates[0].content.parts[0].text;

        return res.status(200).json({
            success: true,
            text
        });

    } catch (error) {

        console.error(error);

        return res.status(500).json({
            success: false,
            error: error.message
        });

    }
}