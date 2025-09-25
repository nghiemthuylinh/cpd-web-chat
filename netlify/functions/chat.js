// netlify/functions/chat.js
import fetch from "node-fetch";

export async function handler(event, context) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { OPENAI_API_KEY, ASSISTANT_ID, OFFICE_LOG_WEBHOOK, LOG_TOKEN } = process.env;
  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return { statusCode: 500, body: "Missing env variables" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = body.messages || [];
    const lastUserMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

    // 1. Gọi Assistants API → tạo thread và run
    const threadResp = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ messages })
    });
    const thread = await threadResp.json();
    if (!thread.id) throw new Error("Thread creation failed");

    const runResp = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID })
    });
    const run = await runResp.json();
    if (!run.id) throw new Error("Run creation failed");

    // 2. Poll kết quả trả lời
    let reply = "";
    while (true) {
      const statusResp = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` }
      });
      const status = await statusResp.json();

      if (status.status === "completed") {
        const msgResp = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
          headers: { "Authorization": `Bearer ${OPENAI_API_KEY}` }
        });
        const msgData = await msgResp.json();
        const last = msgData.data?.find(m => m.role === "assistant");
        reply = last?.content?.[0]?.text?.value || "[Không có phản hồi]";
        break;
      }

      if (status.status === "failed" || status.status === "expired") {
        throw new Error("Assistant run failed");
      }
      await new Promise(r => setTimeout(r, 1200)); // chờ 1.2s rồi poll lại
    }

    // 3. Log về Office webhook (Power Automate)
    if (OFFICE_LOG_WEBHOOK && LOG_TOKEN) {
      const logPayload = {
        time: new Date().toISOString(),
        session: body.session || context.awsRequestId,
        ip: event.headers["x-forwarded-for"] || "",
        ua: event.headers["user-agent"] || "",
        site: event.headers["host"] || "",
        assistantId: ASSISTANT_ID,
        threadId: thread.id,
        runId: run.id,
        user: lastUserMsg,
        bot: reply
      };

      try {
        await fetch(OFFICE_LOG_WEBHOOK, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Log-Token": LOG_TOKEN
          },
          body: JSON.stringify(logPayload)
        });
      } catch (err) {
        console.error("Webhook log failed", err.message);
      }
    }

    // 4. Trả về cho frontend
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    console.error("error:", err);
    return { statusCode: 500, body: `Error: ${err.message}` };
  }
}
