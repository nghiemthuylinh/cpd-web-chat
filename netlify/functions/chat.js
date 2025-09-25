// netlify/functions/chat.js — Assistants API (Threads + Runs) + debug
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
    const assistantId = process.env.ASSISTANT_ID;

    console.log("ENV_OK", { hasApiKey: !!apiKey, hasAssistantId: !!assistantId });
    if (!apiKey) return ok({ error: "Thiếu OPENAI_API_KEY" }, 500);
    if (!assistantId) return ok({ error: "Thiếu ASSISTANT_ID" }, 500);

    const client = new OpenAI({ apiKey });

    // Gộp lịch sử thành transcript để giữ ngữ cảnh ngắn gọn
    const transcript = messages
      .map(m => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
      .join("\n");

    // 1) Tạo thread
    const thread = await client.beta.threads.create();

    // 2) Thêm message người dùng (chứa transcript)
    await client.beta.threads.messages.create(thread.id, {
      role: "user",
      content: transcript
    });

    // 3) Chạy Assistant
    let run = await client.beta.threads.runs.create(thread.id, {
      assistant_id: assistantId
    });

    // 4) Poll tới khi xong
    const deadline = Date.now() + 45_000;
    while (["queued", "in_progress", "requires_action"].includes(run.status)) {
      if (Date.now() > deadline) throw new Error("Run timeout");
      await new Promise(r => setTimeout(r, 1000));
      run = await client.beta.threads.runs.retrieve(thread.id, run.id);
    }
    if (run.status !== "completed") {
      console.error("RUN_NOT_COMPLETED", run.status, run.last_error || "");
      throw new Error(`Run not completed: ${run.status}`);
    }

    // 5) Lấy câu trả lời mới nhất
    const msgs = await client.beta.threads.messages.list(thread.id, { limit: 1 });
    const latest = msgs.data?.[0];
    const parts = latest?.content || [];
    const reply =
      parts.find(p => p.type === "text")?.text?.value ?? "[No text in assistant response]";

    return ok({ reply });
  } catch (err) {
    console.error("[chat-func/assistants] error:", err);
    return ok({ error: err.message || "Server error" }, 500);
  }
}
