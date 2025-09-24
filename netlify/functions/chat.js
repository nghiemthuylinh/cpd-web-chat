// netlify/functions/chat.js — streaming mode
import OpenAI from "openai";

export async function handler(event) {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  try {
    const { messages } = JSON.parse(event.body || "{}");
    if (!Array.isArray(messages) || !messages.length) {
      return { statusCode: 400, body: "Thiếu messages" };
    }

    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const stream = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Bạn là CPD Coach, trả lời ngắn gọn, step-by-step, ưu tiên tiếng Việt." },
        ...messages
      ],
      stream: true
    });

    // Trả về dạng text/event-stream
    const encoder = new TextEncoder();
    const chunks = [];
    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) {
        chunks.push(delta);
      }
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*"
      },
      body: JSON.stringify({ reply: chunks.join("") })
    };
  } catch (err) {
    console.error("[chat-func] error:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
}
