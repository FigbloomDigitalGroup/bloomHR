// server.js: the full backend for local use (includes M-Pesa). On Vercel the backend runs from api/index.js.
import mpesaRouter, { mpesaConfigured, requestB2C } from "./mpesa.js";
import { buildApp } from "./app.js";
import { admin } from "./admin_routes.js";
import { applyPaymentResult, loadBankProvider, mpesaSender, startPaymentWorker } from "./payroll_payments.js";

// Payroll payment workers (FIG-744): they send queued M-Pesa and bank payments of approved payroll runs. Each one
// starts only once its credentials are set; until then its payments wait in the queue. PAYROLL_PAYMENTS_WORKER=off
// keeps both off (for example on a second server, so only one sends).
const workersOn = process.env.PAYROLL_PAYMENTS_WORKER !== "off" && Boolean(admin);
const bank = workersOn
  ? await loadBankProvider().catch((err) => {
      console.error("Bank payouts not started:", err.message);
      return null;
    })
  : null;
const routes =
  bank && typeof bank.callbackRouter === "function"
    ? [{ path: `/api/bank/${bank.name}`, router: bank.callbackRouter({ applyPaymentResult, db: admin }) }]
    : [];

const app = buildApp({ mpesaRouter, routes });

if (!workersOn) {
  console.log("Payroll payment workers are off.");
} else {
  if (mpesaConfigured()) startPaymentWorker(admin, "mpesa", mpesaSender(requestB2C));
  else console.log("M-Pesa is not set up: M-Pesa payroll payments stay queued.");
  if (bank) startPaymentWorker(admin, "bank", bank.send);
  else console.log("No bank payout adapter (BANK_PAYOUT_PROVIDER): bank payroll payments stay queued.");
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
