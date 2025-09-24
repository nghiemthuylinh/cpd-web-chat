// netlify/functions/chat.js  (assistant mode)
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
    if (!apiKey || !asstId) return ok({ error: "Thiếu OPENAI_API_KEY hoặc ASSISTANT_ID" }, 500);

    const client = new OpenAI({ apiKey });

    // Gộp toàn bộ lịch sử thành 1 input “đợt này người dùng nói gì và trước đó là gì”
    // (Cách dễ cho người mới. Sau này có thể chuyển qua cơ chế conversation state nâng cao)
    const lastUser = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";
    const transcript = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    const resp = await client.responses.create({
      assistant_id: asstId,
      // input chính là câu hỏi mới nhất, cộng thêm tóm tắt ngữ cảnh trước đó
      input: `Context so far:\n${transcript}\n\nUser (new): ${lastUser}`
      // Nếu Assistant của bạn có File Search/Tools, SDK sẽ tự xử lý khi assistant_id được cấp
    });

    // Lấy text từ Responses API
    const reply =
      resp.output?.[0]?.content?.[0]?.text?.value ??
      resp.output_text ??
      "[No reply]";
    return ok({ reply });
  } catch (err) {
    console.error("[chat-func/asst] error:", err);
    return ok({ error: err.message || "Server error" }, 500);
  }
}
