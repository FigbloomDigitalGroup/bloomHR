// ai_routes.js - the AI features (HR assistant, warning letters, meeting summaries) call the model through here.
//
// The model is OpenAI's, called with OPENAI_API_KEY, which lives only on the server (a VITE_ variable would be built
// into the JavaScript every visitor downloads). OPENAI_MODEL picks the model. Callers must be signed in, have the
// module the feature belongs to (ADMIN always), and stay within a per-user hourly budget.
//
//   POST /api/ai/chat   { purpose, prompt, context? }  ->  { response, metadata }
import express from "express";
import fetch from "node-fetch";
import { authenticate, HttpError, admin } from "./admin_routes.js";
import { callerHasModule, createBudget } from "./authz.js";

const router = express.Router();

// What each feature may ask for. The system prompt is fixed here, so the endpoint is not a general-purpose model proxy.
// modules: null means any signed-in member of the company.
const PURPOSES = {
  "hr-assistant": {
    modules: ["ai-assistant", "performance"],
    system: (context) => `You are an HR assistant. Analyze this HR data and respond helpfully: ${context}`,
  },
  warning: {
    modules: ["staffcheck"],
    system: (context) => `You are an HR assistant. Analyze this HR data and respond helpfully: ${context}`,
  },
  "meeting-summary": {
    modules: null,
    system: () =>
      "You are a helpful assistant that summarizes meeting transcripts. Provide concise, structured summaries that capture key decisions, action items, and important discussion points. Keep it under 200 words.",
    maxTokens: 500,
  },
};

const DEFAULT_MODEL = "gpt-4.1-mini";
const MAX_PROMPT = 50_000; // characters
const MAX_CONTEXT = 200_000; // characters

const takeBudget = createBudget({ default: { limit: 100, windowMs: 60 * 60 * 1000 } });

router.post("/chat", async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "AI API is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);

    const rule = PURPOSES[String(req.body?.purpose || "")];
    if (!rule) throw new HttpError(400, "Unknown AI purpose");
    if (rule.modules && !(await callerHasModule(caller, rule.modules))) throw new HttpError(403, "Forbidden");

    const { prompt, context = "" } = req.body;
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT) throw new HttpError(400, "Invalid prompt");
    if (typeof context !== "string" || context.length > MAX_CONTEXT) throw new HttpError(400, "Invalid context");

    if (!process.env.OPENAI_API_KEY) throw new HttpError(503, "The AI assistant is not configured on the server");
    if (!takeBudget(caller.id, "default", 1)) throw new HttpError(429, "AI limit reached for now. Try again later.");

    // No temperature: newer OpenAI models only accept the default. max_completion_tokens works on all of them.
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: (process.env.OPENAI_MODEL || "").trim() || DEFAULT_MODEL,
        messages: [
          { role: "system", content: rule.system(context) },
          { role: "user", content: prompt },
        ],
        ...(rule.maxTokens ? { max_completion_tokens: rule.maxTokens } : {}),
      }),
    });
    if (!response.ok) {
      console.error("[ai] model request failed:", response.status, await response.text());
      throw new HttpError(502, "The AI service could not answer right now");
    }
    const data = await response.json();
    const answer = data?.choices?.[0]?.message?.content;
    if (typeof answer !== "string") throw new HttpError(502, "The AI service gave an unexpected answer");
    res.json({ response: answer, metadata: data.usage });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error("[ai]", err);
    res.status(status).json({ error: err instanceof HttpError ? err.message : "Request failed" });
  }
});

export default router;
