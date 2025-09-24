import OpenAI from "openai";

const ok = (body, statusCode = 200) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  },
  body: JSON.stringify(body)
});

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") return ok({});
  if (event.httpMethod !== "POST") return ok({ error: "Method not allowed" }, 405);

  try {
    const { messages } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages) || !messages.length) {
      return ok({ error: "Thiếu messages (mảng {role, content})" }, 400);
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return ok({ error: "Thiếu OPENAI_API_KEY" }, 500);

    const client = new OpenAI({ apiKey });

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are CPD Coach for teachers at Edison. Be concise, step-by-step, Vietnamese-first. If a request is outside CPD scope, politely decline."
        },
        ...messages.map(m => ({
          role: m.role === "user" ? "user" : "assistant",
          content: m.content
        }))
      ]
    });

    const reply = completion.choices?.[0]?.message?.content ?? "";
    return ok({ reply });
  } catch (err) {
    console.error("[chat-func] error:", err);
    return ok({ error: err.message || "Server error" }, 500);
  }
}
