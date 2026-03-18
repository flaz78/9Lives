const OpenAI = require('openai');

async function main() {
    const apiKey = process.env.API_KEY;
    if (!apiKey) {
        console.error("No API_KEY provided");
        process.exit(1);
    }
    const openai = new OpenAI({
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
        apiKey: apiKey
    });

    try {
        console.log("Calling Gemini with model: gemini-1.5-flash");
        const completion = await openai.chat.completions.create({
            model: "gemini-1.5-flash",
            messages: [{ role: "user", content: "Ciao!" }],
        });
        console.log("Success:", completion.choices[0].message.content);
    } catch (e) {
        console.error("Error:", e.message);
    }
}

main();
