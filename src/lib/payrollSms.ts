import { getSmsBalance, sendSingleSms } from './smsApi';

// Payroll's SMS notices to staff (payslip ready, payment sent), moved from PayrollDashboard.

// SMS goes through the server (/api/sms), which holds the provider's credentials; the browser never sees them
const sendSMSLeopard = async (phoneNumber: string, message: string) => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);
    if (!formattedPhone || !message) {
      throw new Error("Phone number and message are required");
    }
    const result = await sendSingleSms(formattedPhone, message, { purpose: "payroll" });
    if (!result?.success) throw new Error(result?.error || "Failed to send SMS");
    return { success: true, message: "SMS sent successfully", timestamp: new Date().toISOString(), rawResponse: result };
  } catch (error) {
    console.error("SMS sending error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
      fallback: true,
      message: "SMS queued for retry",
    };
  }
};

export const checkSMSBalance = async () => {
  try {
    return await getSmsBalance();
  } catch {
    // not configured, or this user may not read it: show no balance rather than an error
    return null;
  }
};

// Enhanced phone number formatting for SMS Leopard
export const formatPhoneNumber = (phone: string | number | null | undefined): string => {
  if (!phone) return "";

  let cleaned = String(phone).replace(/\D/g, "");

  if (cleaned.startsWith("0")) {
    cleaned = "254" + cleaned.substring(1);
  } else if (cleaned.startsWith("7")) {
    cleaned = "254" + cleaned;
  } else if (cleaned.startsWith("+254")) {
    cleaned = cleaned.substring(1);
  }

  if (cleaned.length === 12 && cleaned.startsWith("254")) {
    return cleaned;
  }

  console.warn("Invalid phone number format:", phone, "cleaned:", cleaned);
  return cleaned;
};

// Enhanced SMS sending with retry logic
export const sendSMSWithRetry = async (phoneNumber: string, message: string, maxRetries = 3) => {
  let lastError: any;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`SMS attempt ${attempt} for ${phoneNumber}`);
      const result = await sendSMSLeopard(phoneNumber, message);

      if (result.success) {
        console.log(`SMS sent successfully on attempt ${attempt}`);
        return result;
      }

      lastError = new Error(result.message || "SMS sending failed");
    } catch (error) {
      lastError = error;
      console.warn(`SMS attempt ${attempt} failed:`, error);

      if (attempt < maxRetries) {
        const delay = 1000 * attempt;
        console.log(`Waiting ${delay}ms before retry...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`All ${maxRetries} SMS attempts failed for ${phoneNumber}`);
  throw lastError;
};

// SMS Templates
export const smsTemplates = {
  payslipNotification: (employeeName: string, netPay: number, payPeriod: string) =>
    `Dear ${employeeName}, your payslip for ${payPeriod} is ready. Net Pay: KSh ${netPay.toLocaleString()}. Login to view details.`,

  paymentConfirmation: (employeeName: string, amount: number) =>
    `Dear ${employeeName}, payment of KSh ${amount.toLocaleString()} has been processed successfully via M-PESA. Thank you.`,

  paymentFailed: (employeeName: string) =>
    `Dear ${employeeName}, we encountered an issue processing your payment. Please contact HR for assistance.`,

  mpesaSuccess: (employeeName: string, amount: number, reference: string) =>
    `Dear ${employeeName}, KSh ${amount.toLocaleString()} has been sent to your M-PESA account. Reference: ${reference}.`,

  mpesaFailed: (employeeName: string, reference: string) =>
    `Dear ${employeeName}, M-PESA payment failed for reference ${reference}. Please contact HR.`,
};
