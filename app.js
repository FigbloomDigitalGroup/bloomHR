// The backend as an Express app, without starting a server, so it can run both locally (safaricom.js) and as a
// Vercel function (api/index.js).
import express from "express";
import cors from "cors";
import emailRouter from "./email_routes.js";
import smsRouter from "./sms_routes.js";
import adminRouter from "./admin_routes.js";
import inviteRouter from "./invite_routes.js";
import aiRouter from "./ai_routes.js";
import payrollPaymentsRouter from "./payroll_payments.js";

/**
 * @param {{ mpesaRouter?: import("express").Router, routes?: { path: string, router: import("express").Router }[] }} options
 *   mpesaRouter is passed in only where payments are meant to run: it is not mounted on the public Vercel
 *   deployment (FIG-665: /api/mpesa/b2c still needs authentication before it may be reachable from the internet).
 *   routes: more routers mounted only there too (a bank adapter's result callbacks).
 */
export function buildApp({ mpesaRouter, routes = [] } = {}) {
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
  app.use("/api/ai", aiRouter);
  // queueing and retrying payroll payments only writes to the database; the money moves where the workers run
  app.use("/api/payroll-payments", payrollPaymentsRouter);
  for (const { path, router } of routes) app.use(path, router);

  // anything else under /api is an API 404 in JSON, never the website's home page
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  return app;
}
