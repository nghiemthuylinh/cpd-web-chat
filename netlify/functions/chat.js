// netlify/functions/chat.js  — Assistant mode (Responses API)
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
    if (!apiKey) return ok({ error: "Thiếu OPENAI_API_KEY" }, 500);
    if (!asstId) return ok({ error: "Thiếu ASSISTANT_ID" }, 500);

    const client = new OpenAI({ apiKey });

    // Lấy câu người dùng mới nhất
    const lastUser = [...messages].reverse().find(m => m.role === "user")?.content || "";

    // Gói lịch sử thành transcript ngắn gọn để giữ ngữ cảnh
    const transcript = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // Gọi Assistant qua Responses API
    const resp = await client.responses.create({
      model: "gpt-4o-mini",     // BẮT BUỘC có model để tránh lỗi "Missing model"
      assistant_id: asstId,     // đúng Assistant “CPD Coach”
      // Truyền ngữ cảnh + câu hỏi mới nhất
      input: [
        { role: "user", content: `Context so far:\n${transcript}\n\nUser (new): ${lastUser}` }
      ]
      // Nếu Assistant có File Search/Tools, nó sẽ tự bật theo cấu hình của bạn
    });

    // Lấy text trả về (ưu tiên output_text, fallback sang cấu trúc content)
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
