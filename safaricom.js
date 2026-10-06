// server.js: the full backend for local use (includes M-Pesa). On Vercel the backend runs from api/index.js.
import mpesaRouter from "./mpesa.js";
import { buildApp } from "./app.js";

const app = buildApp({ mpesaRouter });

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
