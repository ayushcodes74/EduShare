export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {

        const { prompt } = req.body;

        console.log("Prompt received:", prompt);

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                {
                                    text: prompt
                                }
                            ]
                        }
                    ]
                })
            }
        );

        const data = await response.json();

        console.log("Gemini Response:", JSON.stringify(data, null, 2));

        if (!data.candidates) {
            return res.status(500).json({
                success: false,
                error: JSON.stringify(data)
            });
        }

        let text =
            data.candidates?.[0]?.content?.parts?.[0]?.text ||
            "No response generated";

        text = text
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

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