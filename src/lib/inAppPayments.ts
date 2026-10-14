// Paying staff from inside the app (M-Pesa bulk pay, payment requests, "Pay staff" on an approved run). Off: finance
// pays salaries by downloading the bank and M-Pesa files from payroll and uploading them to the bank's bulk payments,
// then marks the month paid. The code stays; a Paystack integration may replace the M-Pesa server later.
export const IN_APP_PAYMENTS: boolean = false;

export const IN_APP_PAYMENTS_OFF_MESSAGE =
  'Paying from the app is switched off. Download the bank or M-Pesa file from payroll and upload it to the bank.';
