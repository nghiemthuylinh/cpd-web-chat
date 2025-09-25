// netlify/functions/chat.js  (CommonJS, không cần node-fetch)
const API_BASE = "https://api.openai.com/v1";

exports.handler = async (event, context) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { OPENAI_API_KEY, ASSISTANT_ID, OFFICE_LOG_WEBHOOK, LOG_TOKEN } = process.env;
  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return { statusCode: 500, body: "Missing env OPENAI_API_KEY or ASSISTANT_ID" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMsg =
      messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

    // 1) Tạo thread với toàn bộ lịch sử
    const threadResp = await fetch(`${API_BASE}/threads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messages }),
    });
    if (!threadResp.ok) {
      const t = await threadResp.text();
      throw new Error(`Create thread failed: ${threadResp.status} ${t}`);
    }
    const thread = await threadResp.json();

    // 2) Tạo run cho assistant
    const runResp = await fetch(`${API_BASE}/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
    });
    if (!runResp.ok) {
      const t = await runResp.text();
      throw new Error(`Create run failed: ${runResp.status} ${t}`);
    }
    const run = await runResp.json();

    // 3) Poll trạng thái cho tới khi xong
    let reply = "";
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));
      const statusResp = await fetch(
        `${API_BASE}/threads/${thread.id}/runs/${run.id}`,
        { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
      );
      const status = await statusResp.json();

      if (status.status === "completed") {
        const msgResp = await fetch(
          `${API_BASE}/threads/${thread.id}/messages`,
          { headers: { Authorization: `Bearer ${OPENAI_API_KEY}` } }
        );
        const msgData = await msgResp.json();
        const last = msgData.data?.find(m => m.role === "assistant");
        reply = last?.content?.[0]?.text?.value || "[Không có phản hồi]";
        break;
      }
      if (["failed", "expired", "cancelled"].includes(status.status)) {
        throw new Error(`Run ${status.status}`);
      }
    }

    // 4) Log về Power Automate (nếu cấu hình)
    try {
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
          bot: reply,
        };
        await fetch(OFFICE_LOG_WEBHOOK, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Log-Token": LOG_TOKEN,
          },
          body: JSON.stringify(logPayload),
        });
      }
    } catch (e) {
      console.error("Webhook log failed:", e?.message || e);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error("Function error:", err?.message || err);
    return { statusCode: 500, body: `Error: ${err?.message || "Unknown"}` };
  }
};
