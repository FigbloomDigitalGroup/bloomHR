// The backend as an Express app, without starting a server, so it can run both locally (safaricom.js) and as a
// Vercel function (api/index.js).
import express from "express";
import cors from "cors";
import emailRouter from "./email_routes.js";
import smsRouter from "./sms_routes.js";
import adminRouter from "./admin_routes.js";
import inviteRouter from "./invite_routes.js";

/**
 * @param {{ mpesaRouter?: import("express").Router }} options
 *   mpesaRouter is passed in only where payments are meant to run: it is not mounted on the public Vercel
 *   deployment (FIG-665: /api/mpesa/b2c still needs authentication before it may be reachable from the internet).
 */
export function buildApp({ mpesaRouter } = {}) {
  const app = express();

  // CORS_ORIGIN (comma separated) limits which sites may call the API; unset allows any, as before.
  const origins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : undefined));
  app.use(express.json({ limit: "50mb" }));

  if (mpesaRouter) app.use("/api/mpesa", mpesaRouter);
  app.use("/api/email", emailRouter);
  app.use("/api/sms", smsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/invites", inviteRouter);

  // anything else under /api is an API 404 in JSON, never the website's home page
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  return app;
}
