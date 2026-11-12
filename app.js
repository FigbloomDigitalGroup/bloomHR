// The backend as an Express app, without starting a server, so it can run both locally (safaricom.js) and as a
// Vercel function (api/index.js).
import express from "express";
import cors from "cors";
import emailRouter from "./email_routes.js";
import smsRouter from "./sms_routes.js";
import adminRouter from "./admin_routes.js";
import inviteRouter from "./invite_routes.js";
import mfaRouter from "./mfa_routes.js";
import aiRouter from "./ai_routes.js";
import payrollPaymentsRouter from "./payroll_payments.js";
import careersRouter from "./careers_routes.js";
import iclockRouter from "./iclock_routes.js";
import attendanceRouter from "./attendance_routes.js";
import mailboxRouter from "./mailbox_routes.js";
import platformRouter from "./platform_routes.js";
import platformSchoolsRouter from "./platform_schools_routes.js";
import platformSchoolGroupsRouter from "./platform_school_groups_routes.js";
import platformSchoolHrRouter from "./platform_school_hr_routes.js";
import platformFleetRouter from "./platform_fleet_routes.js";
import { createOutboxRouter, createPlatformEventsRouter } from "./platform_events_routes.js";
import { createPlatformHandoffRouter } from "./platform_handoff_routes.js";
import { createMyHrRouter } from "./my_hr_routes.js";

/**
 * @param {{ mpesaRouter?: import("express").Router, routes?: { path: string, router: import("express").Router }[] }} options
 *   mpesaRouter is passed in only where payments are meant to run: it is not mounted on the public Vercel
 *   deployment (FIG-665: /api/mpesa/b2c still needs authentication before it may be reachable from the internet).
 *   routes: more routers mounted only there too (a bank adapter's result callbacks).
 */
export function buildApp({ mpesaRouter, routes = [] } = {}) {
  const app = express();

  // each company's public careers API (FIG-838) answers CORS itself, from the websites that company allows, so it is
  // mounted before the app-wide CORS below
  app.use("/api/careers", careersRouter);
  // door scanners call /iclock/... (vercel.json sends it here); they read their bodies as text themselves, so this
  // comes before the app-wide JSON parser and CORS (a scanner isn't a browser)
  app.use("/iclock", iclockRouter);
  // the Figbloom platform's signed events (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md): the signature covers the raw body, so
  // this reads it itself, before the JSON parser; and it is a server calling, not a browser, so no CORS
  app.use("/api/platform/events", createPlatformEventsRouter());
  // one-click sign-in from Figbloom Schools (ERP/SCHOOLS_HR_HANDOFF_CONTRACT.md): a browser arriving with the platform's
  // code, and the app finishing a first-time link. Before the app-wide CORS: the link endpoints carry a cookie and
  // answer CORS themselves, with credentials, only to the origins in CORS_ORIGIN
  app.use("/api/platform/handoff", createPlatformHandoffRouter());
  // "My HR" for Figbloom Schools staff (ERP/SCHOOLS_HR_PHASE2_CONTRACT.md): Schools' server calls with its platform
  // token, never a browser, so no CORS
  app.use("/api/integrations/my-hr", createMyHrRouter());

  // CORS_ORIGIN (comma separated) limits which sites may call the API; unset allows any, as before.
  const origins = (process.env.CORS_ORIGIN || "").split(",").map((o) => o.trim()).filter(Boolean);
  app.use(cors(origins.length ? { origin: origins } : undefined));
  app.use(express.json({ limit: "50mb" }));

  if (mpesaRouter) app.use("/api/mpesa", mpesaRouter);
  app.use("/api/email", emailRouter);
  app.use("/api/sms", smsRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/invites", inviteRouter);
  // two-step sign-in codes, made and checked here (FIG-834)
  app.use("/api/mfa", mfaRouter);
  app.use("/api/ai", aiRouter);
  // queueing and retrying payroll payments only writes to the database; the money moves where the workers run
  app.use("/api/payroll-payments", payrollPaymentsRouter);
  // the staff portal's Clock in / Clock out, so the office-network rule sees the real address (FIG-1200)
  app.use("/api/attendance", attendanceRouter);
  // each person's own mailbox, read inside the app (FIG-1205)
  app.use("/api/mailbox", mailboxRouter);
  // HR's own events for the platform, sent when pg_cron asks (x-cron-secret)
  app.use("/api/platform/outbox", createOutboxRouter());
  // Figbloom's console (console.figbloom.org): platform admins, who may belong to no company
  app.use("/api/platform", platformRouter);
  // ...and Figbloom Schools there, through Schools' own platform-schools function (ERP/SCHOOLS_CONSOLE_CONTRACT.md)
  app.use("/api/platform/schools", platformSchoolsRouter);
  // ...and its school groups, decided on the Figbloom platform (ERP/CORE_PLATFORM_DESIGN.md 5.8)
  app.use("/api/platform/school-groups", platformSchoolGroupsRouter);
  // ...and HR & Payroll switched on per school, on the platform (ERP/SCHOOLS_HR_PHASE1_CONTRACT.md)
  app.use("/api/platform/school-hr", platformSchoolHrRouter);
  // ...and Figbloom Fleet's companies: Fleet's summaries, decided on the platform (ERP/FLEET_PLATFORM_CONTRACT.md 3)
  app.use("/api/platform/fleet", platformFleetRouter);
  for (const { path, router } of routes) app.use(path, router);

  // anything else under /api is an API 404 in JSON, never the website's home page
  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  return app;
}
