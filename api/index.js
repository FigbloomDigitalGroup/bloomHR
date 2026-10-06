// Vercel function: the same Express backend (admin, email, SMS) served from this project at /api/*, so the website
// and its API share one address (no VITE_API_URL, no CORS). M-Pesa is deliberately not mounted here yet (FIG-665).
import { buildApp } from "../app.js";

export default buildApp();
