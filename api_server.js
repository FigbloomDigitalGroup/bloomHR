// api_server.js: the backend Vercel serves from api/index.js (admin, email, SMS, ...), as an always-on server for the
// AWS host (figbloom-platform, HrBackend stack). Like api/index.js it leaves out M-Pesa and the payroll payment workers;
// safaricom.js is the full backend with those.
import express from "express";
import { buildApp } from "./app.js";

const server = express();

// The load balancer's health check. Outside /api so it never reaches the app's routes, and it touches nothing else:
// a slow database must not make the host look dead.
server.get("/healthz", (_req, res) => res.json({ status: "ok" }));

server.use(buildApp());

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});
