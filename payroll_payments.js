// payroll_payments.js - paying an approved payroll run from the server, by M-Pesa or bank (FIG-744).
//
// "Pay" queues one payment per employee (table payroll_payments): M-Pesa for staff paid by M-Pesa, bank for staff
// paid by bank transfer. A worker per channel, on the server that holds the credentials (safaricom.js), sends them
// in batches and marks each one sent; the M-Pesa or bank result marks it paid or failed. Every step is saved, so the
// browser can be closed, and a payment that may have gone out is never sent again by itself.
//
// Queueing and retrying only write to the database, so this router is safe on every deployment; money moves only
// where a worker runs.
//
// A channel's sender: async (payment row) => ({ accepted, providerRef?, description? }). It throws an error with
// `definite: true` when nothing can have been sent (refused, not configured) and `definite: false` when the call broke
// off and the payment may have gone through. Results come back through applyPaymentResult.
import express from "express";
import { admin, authenticate, HttpError } from "./admin_routes.js";
import { callerHasModule } from "./authz.js";

const PAGE = 1000; // the API returns at most this many rows per request
const IN_LIST = 200; // values per `in (...)` filter
const WRITE_BATCH = 500;

/** Smallest and largest amount sent in one M-Pesa payment; above the largest, pay another way. */
export const MPESA_MIN_AMOUNT = 10;
export const mpesaMaxAmount = () => Number(process.env.PAYROLL_MPESA_MAX_AMOUNT) || 150000;
/** Largest single bank payment, when the bank sets one (PAYROLL_BANK_MAX_AMOUNT); none by default. */
export const bankMaxAmount = () => Number(process.env.PAYROLL_BANK_MAX_AMOUNT) || Infinity;

// ---------------------------------------------------------------------------------------------
// who is paid how, and how much
// ---------------------------------------------------------------------------------------------

/** A Kenyan mobile number as M-Pesa wants it (2547XXXXXXXX or 2541XXXXXXXX), or null when it is not one. */
export function toMpesaPhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  let phone = digits;
  if (/^0[17]\d{8}$/.test(digits)) phone = `254${digits.slice(1)}`;
  else if (/^[17]\d{8}$/.test(digits)) phone = `254${digits}`;
  return /^254[17]\d{8}$/.test(phone) ? phone : null;
}

/**
 * The channel a payslip's payment method is paid through, read the way payroll reads it: no method set means M-Pesa;
 * Airtel, cash and anything else are paid outside this (null).
 */
export function channelFor(method) {
  const m = String(method ?? "").trim().toLowerCase().replace(/[\s_-]/g, "");
  if (m === "" || /^(mpesa|mobilemoney|mobile|safaricom)$/.test(m)) return "mpesa";
  if (/^(bank|banktransfer|eft|rtgs)$/.test(m)) return "bank";
  return null;
}

const text = (value) => (value === null || value === undefined ? "" : String(value).trim());

/**
 * Splits a run's payslips into payments to queue and people left out (with why). Method and amount come from the
 * approved payslip; where to pay (phone, bank account) from the employee's current record (`employees`: employee
 * number -> employees row).
 */
export function planRunPayments(payslips, employees) {
  const payments = [];
  const skipped = [];
  for (const p of payslips) {
    const employee_number = text(p.employee_id);
    if (!employee_number) continue;
    const employee_name = p.employee_name ?? null;
    const skip = (reason) => skipped.push({ employee_number, employee_name, reason });
    const channel = channelFor(p.payment_method);
    if (!channel) {
      skip(`paid by ${p.payment_method}, which is paid outside the app`);
      continue;
    }
    const record = employees.get(employee_number) ?? {};

    if (channel === "mpesa") {
      const amount = Math.round(Number(p.net_pay) || 0); // M-Pesa sends whole shillings
      if (amount < MPESA_MIN_AMOUNT) {
        skip(`net pay of KSh ${amount} is below the M-Pesa minimum of KSh ${MPESA_MIN_AMOUNT}`);
        continue;
      }
      if (amount > mpesaMaxAmount()) {
        skip(`net pay of KSh ${amount.toLocaleString()} is above the M-Pesa limit of KSh ${mpesaMaxAmount().toLocaleString()}; pay by bank`);
        continue;
      }
      const mobile = text(record["Mobile Number"]);
      const phone = toMpesaPhone(mobile);
      if (!phone) {
        skip(mobile ? `mobile number ${mobile} is not a Kenyan mobile number` : "no mobile number");
        continue;
      }
      payments.push({ employee_number, employee_name, channel, phone, amount });
      continue;
    }

    const amount = Math.round((Number(p.net_pay) || 0) * 100) / 100;
    if (amount <= 0) {
      skip("net pay is KSh 0");
      continue;
    }
    if (amount > bankMaxAmount()) {
      skip(`net pay of KSh ${amount.toLocaleString()} is above the bank's single-payment limit`);
      continue;
    }
    const bank_name = text(record["Bank"]);
    const account_number = text(record["Account Number"]).replace(/[\s-]/g, "");
    if (!bank_name || !account_number) {
      skip(!bank_name ? "no bank" : "no bank account number");
      continue;
    }
    if (!/^\d{5,20}$/.test(account_number)) {
      skip(`bank account number ${text(record["Account Number"])} should be digits only`);
      continue;
    }
    payments.push({
      employee_number,
      employee_name,
      channel,
      bank_name,
      bank_branch: text(record["Bank Branch"]) || null,
      account_number,
      account_name: text(record["account_number_name"]) || employee_name,
      amount,
    });
  }
  return { payments, skipped };
}

// ---------------------------------------------------------------------------------------------
// queueing (payroll users, through the routes below)
// ---------------------------------------------------------------------------------------------

async function fetchAll(page) {
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

const chunks = (items, size) => {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/** The run, checked to belong to the caller's company and to be approved (or already marked paid). */
async function approvedRun(db, tenantId, runId) {
  const { data: run, error } = await db.from("payroll_runs").select("id, tenant_id, pay_period, status").eq("id", runId).maybeSingle();
  if (error) throw error;
  if (!run || run.tenant_id !== tenantId) throw new HttpError(404, "That payroll run was not found");
  if (!["approved", "paid"].includes(run.status)) throw new HttpError(409, `Payroll for ${run.pay_period} is a ${run.status}: approve it before paying`);
  return run;
}

/**
 * Queues a payment for everyone in the run paid by M-Pesa or bank. Employees already queued are left as they are
 * (one payment per employee per run), so pressing it twice never pays twice.
 */
export async function queueRunPayments(db, { tenantId, userId, runId }) {
  const run = await approvedRun(db, tenantId, runId);
  const payslips = await fetchAll((from, to) =>
    db.from("salary_history").select("employee_id, employee_name, net_pay, payment_method").eq("run_id", run.id).order("id").range(from, to)
  );
  const numbers = [...new Set(payslips.map((p) => text(p.employee_id)).filter(Boolean))];
  const employees = new Map();
  for (const list of chunks(numbers, IN_LIST)) {
    const { data, error } = await db
      .from("employees")
      .select('"Employee Number", "Mobile Number", "Bank", "Bank Branch", "Account Number", account_number_name')
      .eq("tenant_id", tenantId)
      .in('"Employee Number"', list);
    if (error) throw error;
    for (const e of data ?? []) employees.set(e["Employee Number"], e);
  }

  const { payments, skipped } = planRunPayments(payslips, employees);
  let queued = 0;
  for (const batch of chunks(payments, WRITE_BATCH)) {
    const { data, error } = await db
      .from("payroll_payments")
      .upsert(
        batch.map((p) => ({ ...p, tenant_id: tenantId, run_id: run.id, queued_by: userId, status: "queued" })),
        { onConflict: "run_id,employee_number", ignoreDuplicates: true }
      )
      .select("id");
    if (error) throw error;
    queued += (data ?? []).length;
  }
  return { queued, alreadyQueued: payments.length - queued, skipped };
}

/** Puts the run's failed payments back in the queue. Payments whose outcome is unknown are never retried. */
export async function retryFailedPayments(db, { tenantId, runId }) {
  await approvedRun(db, tenantId, runId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("payroll_payments")
    .update({ status: "queued", queued_at: now, updated_at: now })
    .eq("tenant_id", tenantId)
    .eq("run_id", runId)
    .eq("status", "failed")
    .select("id");
  if (error) throw error;
  return { requeued: (data ?? []).length };
}

// ---------------------------------------------------------------------------------------------
// the workers
// ---------------------------------------------------------------------------------------------

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Takes up to `batchSize` queued payments of one channel and sends each with `send`, one after another.
 * Returns how many were sent, failed and left unknown.
 */
export async function processPaymentBatch(db, channel, send, { batchSize = 50, gapMs = 300 } = {}) {
  const { data: claimed, error } = await db.rpc("claim_payroll_payments", { p_channel: channel, p_limit: batchSize });
  if (error) throw error;
  const counts = { sent: 0, failed: 0, unknown: 0 };
  for (const [i, p] of (claimed ?? []).entries()) {
    if (i > 0 && gapMs > 0) await pause(gapMs);
    const now = new Date().toISOString();
    let update;
    try {
      const answer = await send(p);
      if (answer?.accepted) {
        update = { status: "sent", provider_ref: answer.providerRef ?? null, sent_at: now };
        counts.sent += 1;
      } else {
        update = { status: "failed", result_desc: answer?.description || "The payment was not accepted", completed_at: now };
        counts.failed += 1;
      }
    } catch (err) {
      if (err?.definite) {
        update = { status: "failed", result_desc: err.message || "The payment was refused", completed_at: now };
        counts.failed += 1;
      } else {
        update = { status: "unknown", result_desc: `The request broke off (${err?.message || "no response"}). Check before paying again.` };
        counts.unknown += 1;
      }
    }
    const { error: saveError } = await db
      .from("payroll_payments")
      .update({ ...update, updated_at: now })
      .eq("id", p.id)
      .eq("status", "sending");
    if (saveError) console.error("payroll payment not saved:", p.id, saveError.message);
  }
  return counts;
}

/** Payments left in "sending" by a worker that stopped mid-batch: they may have gone out, so they become unknown. */
export async function markStalledAsUnknown(db, channel, { olderThanMinutes = 10 } = {}) {
  const before = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
  const { data, error } = await db
    .from("payroll_payments")
    .update({
      status: "unknown",
      result_desc: "The payment worker stopped while sending this payment. Check before paying again.",
      updated_at: new Date().toISOString(),
    })
    .eq("channel", channel)
    .eq("status", "sending")
    .lt("updated_at", before)
    .select("id");
  if (error) throw error;
  return (data ?? []).length;
}

/**
 * Runs a channel's worker every `intervalMs` until stopped: stalled payments become unknown, then batches are sent
 * until the queue is empty. Ticks never overlap. Returns a function that stops it.
 */
export function startPaymentWorker(db, channel, send, { intervalMs = 15000, batchSize = 50, gapMs = 300, log = console } = {}) {
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const stalled = await markStalledAsUnknown(db, channel);
      if (stalled) log.warn(`payroll ${channel} payments: ${stalled} stalled payment(s) marked unknown`);
      for (;;) {
        const counts = await processPaymentBatch(db, channel, send, { batchSize, gapMs });
        const total = counts.sent + counts.failed + counts.unknown;
        if (total) log.log(`payroll ${channel} payments: sent ${counts.sent}, failed ${counts.failed}, unknown ${counts.unknown}`);
        if (total < batchSize || stopped) break;
      }
    } catch (err) {
      log.error(`payroll ${channel} payment worker:`, err?.message || err);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

// ---------------------------------------------------------------------------------------------
// results
// ---------------------------------------------------------------------------------------------

/**
 * Records the outcome of a payment request (from M-Pesa or a bank). Returns false when `requestId` is not a payroll
 * payment. A result for a different accepted request (`providerRef` does not match), or for a payment already
 * settled, changes nothing.
 */
export async function applyPaymentResult(db, { requestId, providerRef, ok, receipt, code, description }) {
  if (!db || !requestId) return false;
  const { data: payment, error } = await db
    .from("payroll_payments")
    .select("id, status, provider_ref")
    .eq("request_id", requestId)
    .maybeSingle();
  if (error) throw error;
  if (!payment) return false;
  if (payment.provider_ref && providerRef && payment.provider_ref !== providerRef) {
    console.warn("payroll payment result ignored: reference does not match", requestId);
    return true;
  }
  if (!["sending", "sent", "unknown"].includes(payment.status)) return true;
  const now = new Date().toISOString();
  const { error: saveError } = await db
    .from("payroll_payments")
    .update({
      status: ok ? "paid" : "failed",
      receipt: ok ? receipt ?? null : null,
      provider_ref: payment.provider_ref || providerRef || null,
      result_code: code === undefined || code === null ? null : String(code),
      result_desc: description ?? null,
      completed_at: now,
      updated_at: now,
    })
    .eq("id", payment.id);
  if (saveError) throw saveError;
  return true;
}

/** The provider gave up on a request: whether it went out is not known, so it is marked for checking. */
export async function markPaymentUnknown(db, requestId, description) {
  if (!db || !requestId) return false;
  const { data, error } = await db
    .from("payroll_payments")
    .update({ status: "unknown", result_desc: description, updated_at: new Date().toISOString() })
    .eq("request_id", requestId)
    .in("status", ["sending", "sent"])
    .select("id");
  if (error) throw error;
  return (data ?? []).length > 0;
}

// --- M-Pesa ------------------------------------------------------------------------------------

/** The M-Pesa sender, around mpesa.js requestB2C. */
export const mpesaSender = (requestB2C) => async (p) => {
  const response = await requestB2C({
    originatorConversationID: p.request_id,
    phoneNumber: p.phone,
    amount: Number(p.amount),
    remarks: `Salary ${p.employee_name || p.employee_number}`.slice(0, 100),
    occasion: `Payroll ${p.employee_number}`.slice(0, 100),
  });
  return String(response?.ResponseCode) === "0"
    ? { accepted: true, providerRef: response.ConversationID ?? null }
    : { accepted: false, description: response?.ResponseDescription || "Safaricom did not accept the payment" };
};

const resultParameter = (result, key) =>
  (Array.isArray(result?.ResultParameters?.ResultParameter) ? result.ResultParameters.ResultParameter : []).find((p) => p?.Key === key)?.Value ??
  null;

/** Safaricom's B2C result callback, recorded on the payroll payment it belongs to (false when it is not one). */
export const applyB2CResult = (db, result) =>
  applyPaymentResult(db, {
    requestId: result?.OriginatorConversationID,
    providerRef: result?.ConversationID,
    ok: Number(result?.ResultCode) === 0,
    receipt: resultParameter(result, "TransactionReceipt") || result?.TransactionID || null,
    code: result?.ResultCode,
    description: result?.ResultDesc,
  });

/** Safaricom's B2C queue timeout. */
export const applyB2CTimeout = (db, result) =>
  markPaymentUnknown(db, result?.OriginatorConversationID, "Safaricom timed out processing this payment. Check with Safaricom before paying again.");

// --- banks -------------------------------------------------------------------------------------

/**
 * The bank payout adapter named by BANK_PAYOUT_PROVIDER (bank_providers/<name>.js), or null when none is set up.
 * See bank_providers/README.md for what an adapter provides.
 */
export async function loadBankProvider(name = process.env.BANK_PAYOUT_PROVIDER) {
  if (!name) return null;
  if (!/^[a-z0-9_-]+$/i.test(name)) throw new Error(`BANK_PAYOUT_PROVIDER "${name}" is not a valid adapter name`);
  const adapter = (await import(`./bank_providers/${name}.js`)).default;
  if (typeof adapter?.send !== "function") throw new Error(`bank_providers/${name}.js does not export a send function`);
  if (typeof adapter.configured === "function" && !adapter.configured()) return null;
  return { name, ...adapter };
}

// ---------------------------------------------------------------------------------------------
// routes (payroll users of the run's company)
// ---------------------------------------------------------------------------------------------

const router = express.Router();

const payrollOnly = (handler) => async (req, res) => {
  try {
    if (!admin) throw new HttpError(500, "The server is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)");
    const caller = await authenticate(req);
    if (!(await callerHasModule(caller, ["payroll"]))) throw new HttpError(403, "Only payroll users can pay a payroll run");
    const runId = String(req.body?.runId ?? "");
    if (!/^[0-9a-f-]{36}$/i.test(runId)) throw new HttpError(400, "runId is required");
    res.json(await handler(caller, runId));
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) console.error("payroll payments:", err);
    res.status(status).json({ error: status === 500 ? "Could not update the payments" : err.message });
  }
};

router.post(
  "/queue",
  payrollOnly((caller, runId) => queueRunPayments(admin, { tenantId: caller.tenantId, userId: caller.id, runId }))
);

router.post(
  "/retry-failed",
  payrollOnly((caller, runId) => retryFailedPayments(admin, { tenantId: caller.tenantId, runId }))
);

export default router;
