export default async function handler(req, res) {

    if (req.method !== "POST") {
        return res.status(405).json({
            error: "Method not allowed"
        });
    }

    try {

        const { prompt } = req.body;

        if (!prompt) {
            return res.status(400).json({
                success: false,
                error: "Prompt is required"
            });
        }

        const response = await fetch(
            "https://api.groq.com/openai/v1/chat/completions",
            {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${process.env.GROQ_API_KEY}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model: "llama-3.3-70b-versatile",
                    messages: [
                        {
                            role: "user",
                            content: prompt
                        }
                    ],
                    temperature: 0.3
                })
            }
        );

        const data = await response.json();

        console.log("Groq Response:", JSON.stringify(data, null, 2));

        if (!data.choices) {
            return res.status(500).json({
                success: false,
                error: JSON.stringify(data)
            });
        }

        let text = data.choices[0].message.content;

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