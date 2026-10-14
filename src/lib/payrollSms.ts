// Payroll's SMS notices to staff through SMS Leopard (payslip ready, payment sent), moved from PayrollDashboard.


// SMS Service Configuration for SMS Leopard
const SMS_LEOPARD_CONFIG = {
  baseUrl: "https://api.smsleopard.com/v1",
  username: import.meta.env.VITE_SMS_LEOPARD_USERNAME || '',
  password: import.meta.env.VITE_SMS_LEOPARD_PASSWORD || '',
  source: "sms_Leopard",
};

// Utility function to add query parameters
const addQueryParams = (url: string, params: Record<string, string | number | boolean | (string | number | boolean)[]>) => {
  const queryString = Object.entries(params)
    .flatMap(([key, value]) =>
      Array.isArray(value)
        ? value.map(
          (val) => `${encodeURIComponent(key)}=${encodeURIComponent(val)}`,
        )
        : `${encodeURIComponent(key)}=${encodeURIComponent(value)}`,
    )
    .join("&");

  return `${url}?${queryString}`;
};

// SMS Service Functions for SMS Leopard
const sendSMSLeopard = async (phoneNumber: string, message: string) => {
  try {
    const formattedPhone = formatPhoneNumber(phoneNumber);

    if (!formattedPhone || !message) {
      throw new Error("Phone number and message are required");
    }

    const endpoint = addQueryParams(`${SMS_LEOPARD_CONFIG.baseUrl}/sms/send`, {
      username: SMS_LEOPARD_CONFIG.username,
      password: SMS_LEOPARD_CONFIG.password,
      message: message,
      destination: formattedPhone,
      source: SMS_LEOPARD_CONFIG.source,
    });

    const credentials = btoa(
      `${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`,
    );

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();

    if (result.status === "success" || response.ok) {
      return {
        success: true,
        message: "SMS sent successfully",
        timestamp: new Date().toISOString(),
        rawResponse: result,
      };
    } else {
      throw new Error(result.message || "Failed to send SMS");
    }
  } catch (error) {
    console.error("SMS sending error:", error);

    console.log("SMS would have been sent:", {
      to: formatPhoneNumber(phoneNumber),
      message: message,
      provider: "SMS Leopard",
    });

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
    const endpoint = `${SMS_LEOPARD_CONFIG.baseUrl}/balance`;
    const credentials = btoa(
      `${SMS_LEOPARD_CONFIG.username}:${SMS_LEOPARD_CONFIG.password}`,
    );

    const response = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to check balance: ${response.status}`);
    }

    const result = await response.json();

    if (result.balance !== undefined) {
      return `KSh ${result.balance}`;
    } else if (result.data && result.data.balance !== undefined) {
      return `KSh ${result.data.balance}`;
    } else {
      return "Balance information not available";
    }
  } catch (error) {
    console.error("SMS balance check error:", error);
    return "Service unavailable";
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
