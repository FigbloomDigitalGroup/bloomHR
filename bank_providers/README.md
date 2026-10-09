# Bank payout adapters

Payroll pays bank-paid staff through a bank's API, one adapter per bank (FIG-744). The payment queue, retries and
records live in `payroll_payments.js`. An adapter only knows how to talk to its bank.

To switch one on, on the server that runs the payment workers (`safaricom.js`):

```
BANK_PAYOUT_PROVIDER=<name>      # loads bank_providers/<name>.js
...the bank's own credentials, read by the adapter...
```

Without `BANK_PAYOUT_PROVIDER`, bank payments stay queued and the payroll page says they are waiting for bank setup.

## What `bank_providers/<name>.js` exports

```js
export default {
  /** false when its credentials are missing: the bank worker then does not start */
  configured: () => Boolean(process.env.MYBANK_CLIENT_ID),

  /**
   * Sends one payment. `p` is a payroll_payments row: request_id (unique per attempt; give it to the bank as your
   * reference), amount (KSh, 2 decimals), bank_name, bank_branch, account_number, account_name, employee_number.
   * Resolve { accepted: true, providerRef } when the bank took the request, or { accepted: false, description }.
   * Throw an error with `definite = true` when nothing can have been sent (refused, bad credentials), and
   * `definite = false` when the call broke off (it may have gone through: it is never sent again by itself).
   */
  async send(p) {},

  /**
   * Optional: an Express router for the bank's result callbacks, mounted at /api/bank/<name>. Call
   * applyPaymentResult(db, { requestId, providerRef, ok, receipt, code, description }) for each result.
   */
  callbackRouter({ applyPaymentResult, db }) {},
};
```

If the bank only reports results when asked, rather than by callback, have the adapter poll for them and call
`applyPaymentResult` the same way.
