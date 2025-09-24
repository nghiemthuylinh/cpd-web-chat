// netlify/functions/chat.js — Assistant mode + debug
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
    const asstId = process.env.ASSISTANT_ID;

    // DEBUG: in log, we only print booleans (không lộ key)
    console.log("ENV_OK", {
      hasApiKey: !!apiKey,
      hasAssistantId: !!asstId,
      model: "gpt-4o-mini"
    });

    if (!apiKey) return ok({ error: "Thiếu OPENAI_API_KEY" }, 500);
    if (!asstId) return ok({ error: "Thiếu ASSISTANT_ID" }, 500);

    const client = new OpenAI({ apiKey });

    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";
    const transcript = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // Responses API with assistant_id + model
    const resp = await client.responses.create({
      model: "gpt-4o-mini",     // BẮT BUỘC có model
      assistant_id: asstId,
      input: [
        { role: "user", content: `Context so far:\n${transcript}\n\nUser (new): ${lastUser}` }
      ]
      // Assistant sẽ tự dùng instructions/files/tools bạn đã cấu hình trong Platform
    });

    const reply =
      resp.output_text ??
      resp.output?.[0]?.content?.[0]?.text?.value ??
      "[No reply]";
    return ok({ reply });
  } catch (err) {
    console.error("[chat-func/asst] error:", err);
    return ok({ error: err.message || "Server error" }, 500);
  }
}
