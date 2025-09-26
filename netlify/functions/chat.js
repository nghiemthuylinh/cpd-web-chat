// netlify/functions/chat.js
const API_BASE = "https://api.openai.com/v1";

// CORS dùng cho frontend fetch từ trình duyệt
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
};

exports.handler = async (event, context) => {
  // Preflight cho CORS
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 200, headers: CORS };
  }

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers: CORS, body: "Method Not Allowed" };
  }

  const { OPENAI_API_KEY, ASSISTANT_ID, OFFICE_LOG_WEBHOOK, LOG_TOKEN } = process.env;
  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return { statusCode: 500, headers: CORS, body: "Missing env OPENAI_API_KEY or ASSISTANT_ID" };
  }

  try {
    const body = JSON.parse(event.body || "{}");
    const messages = Array.isArray(body.messages) ? body.messages : [];
    const lastUserMsg = messages.filter(m => m.role === "user").slice(-1)[0]?.content || "";

    // ===== 1) Create thread (Assistants API v2 cần header OpenAI-Beta) =====
    const threadResp = await fetch(`${API_BASE}/threads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({ messages }),
    });
    if (!threadResp.ok) {
      const t = await threadResp.text();
      throw new Error(`Create thread failed: ${threadResp.status} ${t}`);
    }
    const thread = await threadResp.json();

    // ===== 2) Run assistant =====
    const runResp = await fetch(`${API_BASE}/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({ assistant_id: ASSISTANT_ID }),
    });
    if (!runResp.ok) {
      const t = await runResp.text();
      throw new Error(`Create run failed: ${runResp.status} ${t}`);
    }
    const run = await runResp.json();

    // ===== 3) Poll run status =====
    let reply = "";
    // chờ tối đa ~30s
    const started = Date.now();
    for (;;) {
      await new Promise(r => setTimeout(r, 1000));

      const statusResp = await fetch(`${API_BASE}/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          "OpenAI-Beta": "assistants=v2",
        }
      });
      if (!statusResp.ok) {
        const t = await statusResp.text();
        throw new Error(`Check run failed: ${statusResp.status} ${t}`);
      }
      const status = await statusResp.json();

      if (status.status === "completed") {
        const msgResp = await fetch(`${API_BASE}/threads/${thread.id}/messages`, {
          headers: {
            Authorization: `Bearer ${OPENAI_API_KEY}`,
            "OpenAI-Beta": "assistants=v2",
          }
        });
        if (!msgResp.ok) {
          const t = await msgResp.text();
          throw new Error(`List messages failed: ${msgResp.status} ${t}`);
        }
        const msgData = await msgResp.json();
        const last = msgData.data?.find(m => m.role === "assistant");
        const part = last?.content?.[0];
        reply = (part?.type === "text" && part?.text?.value) ? part.text.value : "[Không có phản hồi]";
        break;
      }

      if (["failed", "expired", "cancelled"].includes(status.status)) {
        throw new Error(`Run ${status.status}`);
      }

      if (Date.now() - started > 30000) {
        throw new Error("Run timeout (>30s)");
      }
    }

    // ===== 4) Log sang Power Automate (tùy chọn) =====
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
          bot: reply
        };
        await fetch(OFFICE_LOG_WEBHOOK, {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Log-Token": LOG_TOKEN },
          body: JSON.stringify(logPayload)
        });
      }
    } catch (e) {
      console.error("Webhook log failed:", e?.message || e);
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type": "application/json" },
      body: JSON.stringify({ reply })
    };

  } catch (err) {
    console.error("Function error:", err?.message || err);
    return { statusCode: 500, headers: CORS, body: JSON.stringify({ error: err?.message || "Unknown" }) };
  }
};
