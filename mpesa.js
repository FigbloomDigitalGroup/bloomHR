// mpesa.js
import express from "express";
import axios from "axios";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: process.env.ENV_FILE || '.env' });

const router = express.Router();

// --- M-PESA Configuration ---
const MPESA_CONFIG = {
  consumerKey: process.env.MPESA_CONSUMER_KEY,
  consumerSecret: process.env.MPESA_CONSUMER_SECRET,
  initiatorName: process.env.MPESA_INITIATOR_NAME,
  securityCredential: process.env.MPESA_SECURITY_CREDENTIAL,
  shortCode: process.env.MPESA_SHORTCODE,
  b2cResultURL: process.env.MPESA_B2C_RESULT_URL,
  b2cQueueTimeoutURL: process.env.MPESA_B2C_QUEUE_TIMEOUT_URL,
  transactionStatusResultURL: process.env.MPESA_TRANSACTION_STATUS_RESULT_URL,
  transactionStatusQueueTimeoutURL: process.env.MPESA_TRANSACTION_STATUS_QUEUE_TIMEOUT_URL,
};

// C2B Configuration - UPDATED WITH YOUR PUBLIC URL
const C2B_CONFIG = {
  shortCode: process.env.MPESA_SHORTCODE,
  confirmationURL: "https://mpesa-22p0.onrender.com/api/mpesa/c2b-confirmation",
  responseType: "Completed"
};

const MPESA_URLS = {
  auth: "https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials",
  b2c: "https://api.safaricom.co.ke/mpesa/b2c/v1/paymentrequest",
  c2bRegister: "https://api.safaricom.co.ke/mpesa/c2b/v2/registerurl",
  transactionStatus: "https://api.safaricom.co.ke/mpesa/transactionstatus/v1/query",
};

// --- Supabase Init ---
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_KEY;

const supabase = (supabaseUrl && supabaseKey)
  ? createClient(supabaseUrl, supabaseKey)
  : null;

if (!supabase) {
  console.warn("⚠️ Supabase not initialized in mpesa.js - DB updates will be skipped");
}

// --- Generate Access Token ---
const generateAccessToken = async () => {
  try {
    const auth = Buffer.from(
      `${MPESA_CONFIG.consumerKey}:${MPESA_CONFIG.consumerSecret}`
    ).toString("base64");

    const response = await axios.get(MPESA_URLS.auth, {
      headers: { Authorization: `Basic ${auth}` },
      timeout: 30000,
    });

    if (!response.data.access_token) {
      throw new Error("No access token received from M-Pesa");
    }
    return response.data.access_token;
  } catch (error) {
    console.error("Error generating access token:", error.response?.data || error.message);
    throw new Error("Failed to generate access token");
  }
};

// ============================================================================
// TRANSACTION STATUS FUNCTIONALITY
// ============================================================================

// --- Check Transaction Status ---
const checkTransactionStatus = async (transactionData) => {
  try {
    const accessToken = await generateAccessToken();

    const requestData = {
      Initiator: MPESA_CONFIG.initiatorName,
      SecurityCredential: MPESA_CONFIG.securityCredential,
      CommandID: "TransactionStatusQuery",
      TransactionID: transactionData.transactionID,
      OriginatorConversationID: transactionData.originatorConversationID,
      PartyA: MPESA_CONFIG.shortCode,
      IdentifierType: "4", // 4 = Organization shortcode
      ResultURL: MPESA_CONFIG.transactionStatusResultURL,
      QueueTimeOutURL: MPESA_CONFIG.transactionStatusQueueTimeoutURL,
      Remarks: transactionData.remarks || "Transaction status query",
      Occasion: transactionData.occasion || "StatusCheck",
    };

    console.log("🔍 Checking transaction status:", {
      TransactionID: requestData.TransactionID,
      OriginatorConversationID: requestData.OriginatorConversationID,
      PartyA: requestData.PartyA
    });

    const response = await axios.post(MPESA_URLS.transactionStatus, requestData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    console.log("✅ Transaction status query initiated:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Error checking transaction status:", error.response?.data || error.message);
    throw new Error(error.response?.data?.errorMessage || "Failed to check transaction status");
  }
};

// --- Transaction Status Result Callback Endpoint ---
router.post("/transaction-status-result", async (req, res) => {
  try {
    console.log("✅ Transaction Status Result received:", JSON.stringify(req.body, null, 2));

    const result = req.body.Result;

    if (!result) {
      console.warn("⚠️ Result object missing in transaction status callback");
      return res.status(400).json({ ResultCode: 1, ResultDesc: "Result object missing" });
    }

    if (result.ResultCode === 0) {
      console.log("🎉 Transaction status query successful:", {
        ResultCode: result.ResultCode,
        ResultDesc: result.ResultDesc,
        OriginatorConversationID: result.OriginatorConversationID,
        ConversationID: result.ConversationID,
        TransactionID: result.TransactionID,
        ReceiptNumber: result.ReceiptNo,
        TransactionStatus: result.ResultParameters?.ResultParameter || "Unknown"
      });

      // Process the transaction status result
      if (result.ResultParameters && result.ResultParameters.ResultParameter) {
        const transactionDetails = parseTransactionStatusParameters(result.ResultParameters.ResultParameter);
        console.log("📊 Transaction Details:", transactionDetails);

        if (supabase) {
          try {
            // Upsert: Match by OriginatorConversationID. 
            // This preserves the 'employee_id' if we inserted it during the request.
            // If it doesn't exist, it inserts a new one.
            // Determine the correct Transaction ID
            // If M-Pesa returns the generic 'UAT1000000', use the actual ReceiptNo from parameters
            let finalTransactionID = result.TransactionID;
            if (finalTransactionID === 'UAT1000000' && transactionDetails.ReceiptNo) {
              console.log(`🔄 Replacing generic ID ${finalTransactionID} with actual ReceiptNo: ${transactionDetails.ReceiptNo}`);
              finalTransactionID = transactionDetails.ReceiptNo;
            } else if (!finalTransactionID && transactionDetails.ReceiptNo) {
              finalTransactionID = transactionDetails.ReceiptNo;
            }

            const { error } = await supabase.from('mpesa_callbacks').upsert({
              originator_conversation_id: result.OriginatorConversationID, // PK preferably
              transaction_id: finalTransactionID,
              result_type: 'TransactionStatus',
              result_code: result.ResultCode,
              result_desc: result.ResultDesc,
              conversation_id: result.ConversationID,
              amount: transactionDetails.Amount || 0,
              status: result.ResultCode === 0 ? 'Completed' : 'Failed',
              raw_response: JSON.stringify(req.body),
              callback_date: new Date().toISOString()
              // employee_id is NOT overwritten here if it exists in the row and we use upsert correctly
              // However, simple upsert overwrites unless we are careful. 
              // Better approach: Update if exists, Insert if not. 
              // Since Supabase upsert overwrites by default unless ignoreDuplicates is on (which skips update).
              // We want to MERGE. simpler way:
            }, { onConflict: 'originator_conversation_id' });

            // Note: For this to work efficiently, 'originator_conversation_id' should be a unique constraint/index.

            if (error) {
              console.warn("⚠️ Upsert failed, attempting manual update/insert check:", error.message);
              // Fallback logic if needed, but upsert is best.
            } else {
              console.log("✅ Transaction status updated in DB");
            }

          } catch (dbError) {
            console.error("❌ DB Error during transaction status save:", dbError);
          }
        }
      }
    } else {
      console.log("❌ Transaction status query failed:", {
        ResultCode: result.ResultCode,
        ResultDesc: result.ResultDesc,
        OriginatorConversationID: result.OriginatorConversationID
      });
    }

    res.json({ ResultCode: 0, ResultDesc: "Transaction status result received successfully" });
  } catch (error) {
    console.error("❌ Error processing transaction status result:", error);
    res.json({ ResultCode: 0, ResultDesc: "Result processed with warnings" });
  }
});

// --- Transaction Status Queue Timeout Endpoint ---
router.post("/transaction-status-timeout", async (req, res) => {
  try {
    console.log("⏰ Transaction Status Queue Timeout received:", JSON.stringify(req.body, null, 2));

    res.json({
      ResultCode: 0,
      ResultDesc: "Transaction status queue timeout acknowledged"
    });
  } catch (error) {
    console.error("Error processing transaction status timeout:", error);
    res.json({
      ResultCode: 0,
      ResultDesc: "Timeout processed"
    });
  }
});

// --- Parse Transaction Status Parameters ---
const parseTransactionStatusParameters = (parameters) => {
  try {
    const parsed = {};

    if (Array.isArray(parameters)) {
      parameters.forEach(param => {
        if (param.Key && param.Value) {
          parsed[param.Key] = param.Value;
        }
      });
    }

    return parsed;
  } catch (error) {
    console.error("Error parsing transaction status parameters:", error);
    return parameters; // Return original if parsing fails
  }
};

// --- Check Transaction Status Endpoint ---
router.post("/check-transaction-status", async (req, res) => {
  try {
    const { transactionID, originatorConversationID, remarks, occasion, employeeId } = req.body;

    // Generate a unique OriginatorConversationID if not provided
    const uniqueOriginatorID = originatorConversationID || `StatusCheck_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

    if (!transactionID && !originatorConversationID) {
      return res.status(400).json({
        success: false,
        message: "Either transactionID or originatorConversationID is required"
      });
    }

    console.log("🔍 Initiating transaction status check:", {
      transactionID,
      originatorConversationID: uniqueOriginatorID,
      remarks,
      occasion,
      employeeId
    });

    // Save Pending Request to DB (to link EmployeeID)
    if (supabase) {
      try {
        await supabase.from('mpesa_callbacks').insert({
          originator_conversation_id: uniqueOriginatorID,
          transaction_id: transactionID,
          result_type: 'TransactionStatus_Pending',
          status: 'Pending',
          result_desc: 'Request Initiated',
          callback_date: new Date().toISOString()
        });
      } catch (dbErr) {
        console.error("⚠️ Failed to log pending status check:", dbErr);
        // Proceed anyway
      }
    }

    const transactionData = {
      transactionID: transactionID || undefined,
      originatorConversationID: uniqueOriginatorID, // Use our generated ID
      remarks: remarks || "Transaction status query from API",
      occasion: occasion || `StatusCheck_${Date.now()}`
    };

    const result = await checkTransactionStatus(transactionData);

    res.json({
      success: true,
      message: "Transaction status query initiated successfully",
      data: result
    });
  } catch (error) {
    console.error("❌ Transaction status check failed:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to check transaction status"
    });
  }
});

// --- Get Transaction Status by Receipt Number (Convenience Endpoint) ---
router.post("/check-transaction-by-receipt", async (req, res) => {
  try {
    const { receiptNumber, remarks, occasion, employeeId } = req.body;

    if (!receiptNumber) {
      return res.status(400).json({
        success: false,
        message: "receiptNumber is required"
      });
    }

    // Generate Request ID
    const uniqueOriginatorID = `ReceiptCheck_${receiptNumber}_${Date.now()}`;

    console.log("🔍 Checking transaction status by receipt:", { receiptNumber, employeeId });

    // Save Pending Log
    if (supabase) {
      try {
        await supabase.from('mpesa_callbacks').insert({
          originator_conversation_id: uniqueOriginatorID,
          transaction_id: receiptNumber,
          result_type: 'TransactionStatus_Pending',
          status: 'Pending',
          result_desc: 'Receipt Check Initiated',
          callback_date: new Date().toISOString()
        });
      } catch (dbErr) {
        console.error("⚠️ Failed to log pending receipt check:", dbErr);
      }
    }

    const transactionData = {
      transactionID: receiptNumber,
      originatorConversationID: uniqueOriginatorID,
      remarks: remarks || `Status check for receipt: ${receiptNumber}`,
      occasion: occasion || `ReceiptCheck_${Date.now()}`
    };

    const result = await checkTransactionStatus(transactionData);

    res.json({
      success: true,
      message: "Transaction status query by receipt initiated successfully",
      data: result
    });
  } catch (error) {
    console.error("❌ Transaction status check by receipt failed:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to check transaction status by receipt"
    });
  }
});

// ============================================================================
// EXISTING FUNCTIONALITY (Keep all your existing code below)
// ============================================================================

// --- Register C2B URLs (Confirmation Only) ---
const registerC2BURLs = async () => {
  try {
    const accessToken = await generateAccessToken();

    const requestData = {
      ShortCode: C2B_CONFIG.shortCode,
      ResponseType: C2B_CONFIG.responseType,
      ConfirmationURL: C2B_CONFIG.confirmationURL,
      ValidationURL: C2B_CONFIG.confirmationURL // Required field but won't be used
    };

    console.log("Registering C2B URLs:", {
      ShortCode: requestData.ShortCode,
      ResponseType: requestData.ResponseType,
      ConfirmationURL: requestData.ConfirmationURL
    });

    const response = await axios.post(MPESA_URLS.c2bRegister, requestData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    console.log("✅ C2B URL registration successful:", response.data);
    return response.data;
  } catch (error) {
    console.error("❌ Error registering C2B URLs:", error.response?.data || error.message);
    throw new Error(error.response?.data?.errorMessage || "Failed to register C2B URLs");
  }
};

// --- C2B Confirmation Callback Endpoint ---
router.post("/c2b-confirmation", async (req, res) => {
  try {
    console.log("✅ C2B Payment Confirmation received:", JSON.stringify(req.body, null, 2));

    const transactionData = req.body;

    // Process the successful payment notification
    if (transactionData.TransID && transactionData.TransAmount) {
      console.log("🎉 C2B Payment Received:", {
        TransactionID: transactionData.TransID,
        Amount: transactionData.TransAmount,
        MSISDN: transactionData.MSISDN,
        BillRefNumber: transactionData.BillRefNumber,
        FirstName: transactionData.FirstName,
        LastName: transactionData.LastName
      });

      if (supabase) {
        try {
          await supabase.from('mpesa_callbacks').upsert({
            transaction_id: transactionData.TransID,
            result_type: 'C2B',
            result_code: 0,
            result_desc: `C2B Payment from ${transactionData.FirstName} ${transactionData.LastName}`,
            amount: Number(transactionData.TransAmount),
            status: 'Completed',
            phone_number: transactionData.MSISDN,
            raw_response: JSON.stringify(req.body),
            callback_date: new Date().toISOString()
          }, { onConflict: 'transaction_id' });
          console.log("✅ C2B payment saved to DB");
        } catch (dbErr) {
          console.error("❌ DB Error saving C2B confirmation:", dbErr.message);
        }
      }
    }

    // Always respond with success to M-Pesa within 8 seconds
    res.json({
      ResultCode: 0,
      ResultDesc: "Confirmation received successfully"
    });
  } catch (error) {
    console.error("❌ Error processing C2B confirmation:", error);
    res.json({
      ResultCode: 0,
      ResultDesc: "Confirmation processed with warnings"
    });
  }
});

// --- Register C2B URLs Endpoint ---
router.post("/register-c2b", async (req, res) => {
  try {
    console.log("🔄 Registering C2B URLs...");

    const result = await registerC2BURLs();

    res.json({
      success: true,
      message: "C2B URLs registered successfully",
      data: result
    });
  } catch (error) {
    console.error("❌ Failed to register C2B URLs:", error.message);
    res.status(500).json({
      success: false,
      message: error.message || "Failed to register C2B URLs"
    });
  }
});

// --- Check C2B Registration Status ---
router.post("/check-c2b-registration", async (req, res) => {
  try {
    console.log("🔍 Checking C2B registration status...");
    const result = await registerC2BURLs();

    console.log("✅ C2B Registration Response:", result);
    res.json({
      success: true,
      message: "C2B URLs are properly registered",
      data: result
    });
  } catch (error) {
    console.error("❌ C2B Registration FAILED:", error.message);
    res.status(500).json({
      success: false,
      message: "C2B registration failed",
      error: error.message
    });
  }
});

// --- Test Callback Endpoint ---
router.post("/test-callback", (req, res) => {
  console.log("✅ TEST Callback received:", {
    headers: req.headers,
    body: req.body,
    timestamp: new Date().toISOString()
  });

  res.json({
    success: true,
    message: "Test callback received successfully",
    receivedAt: new Date().toISOString()
  });
});

// --- Health Check ---
router.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    serverTime: new Date().toISOString(),
    endpoints: {
      c2bConfirmation: "POST /api/mpesa/c2b-confirmation",
      b2cResult: "POST /api/mpesa/b2c-result",
      registerC2B: "POST /api/mpesa/register-c2b",
      testCallback: "POST /api/mpesa/test-callback",
      checkTransactionStatus: "POST /api/mpesa/check-transaction-status",
      checkTransactionByReceipt: "POST /api/mpesa/check-transaction-by-receipt",
      transactionStatusResult: "POST /api/mpesa/transaction-status-result",
      transactionStatusTimeout: "POST /api/mpesa/transaction-status-timeout"
    }
  });
});

// --- B2C Queue Timeout Endpoint ---
router.post("/b2c-timeout", async (req, res) => {
  try {
    console.log("⏰ B2C Queue Timeout received:", JSON.stringify(req.body, null, 2));

    res.json({
      ResultCode: 0,
      ResultDesc: "Queue timeout acknowledged"
    });
  } catch (error) {
    console.error("Error processing B2C timeout:", error);
    res.json({
      ResultCode: 0,
      ResultDesc: "Timeout processed"
    });
  }
});

// --- Initiate B2C Payment ---
const initiateB2CPayment = async (paymentData) => {
  try {
    const accessToken = await generateAccessToken();

    const requestData = {
      OriginatorConversationID: paymentData.originatorConversationID || `B2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      InitiatorName: MPESA_CONFIG.initiatorName,
      SecurityCredential: MPESA_CONFIG.securityCredential,
      CommandID: "SalaryPayment",
      Amount: Math.round(paymentData.amount),
      PartyA: MPESA_CONFIG.shortCode,
      PartyB: paymentData.phoneNumber,
      Remarks: paymentData.remarks || `Salary advance for ${paymentData.employeeNumber}`,
      QueueTimeOutURL: MPESA_CONFIG.b2cQueueTimeoutURL,
      ResultURL: MPESA_CONFIG.b2cResultURL,
      Occasion: paymentData.occasion || `SalaryAdvance_${paymentData.employeeNumber}`,
    };

    console.log("🚀 Initiating B2C payment:", {
      OriginatorConversationID: requestData.OriginatorConversationID,
      Amount: requestData.Amount,
      PartyB: requestData.PartyB,
      ResultURL: requestData.ResultURL,
      QueueTimeOutURL: requestData.QueueTimeOutURL
    });

    const response = await axios.post(MPESA_URLS.b2c, requestData, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      timeout: 45000,
    });

    console.log("B2C payment response:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error initiating B2C payment:", error.response?.data || error.message);
    throw new Error(error.response?.data?.errorMessage || error.message || "Failed to initiate B2C payment");
  }
};

// --- B2C Payment Endpoint ---
router.post("/b2c", async (req, res) => {
  try {
    const { phoneNumber, amount, employeeNumber, fullName } = req.body;

    if (!phoneNumber || !amount || !employeeNumber) {
      return res.status(400).json({ success: false, message: "Missing required parameters" });
    }

    const phoneRegex = /^254[17]\d{8}$/;

    if (!phoneRegex.test(phoneNumber)) {
      console.error("❌ Invalid phone number format:", phoneNumber);
      return res.status(400).json({
        success: false,
        message: "Invalid phone number format. Must be 254xxxxxxxxx (12 digits)"
      });
    }

    console.log("✅ Phone number validated:", phoneNumber);

    const numericAmount = Number(amount);
    if (isNaN(numericAmount) || numericAmount < 10 || numericAmount > 100000) {
      return res.status(400).json({ success: false, message: "Invalid amount. Must be between 10 and 100,000 KES" });
    }

    const originatorConversationID = `B2C_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const paymentData = {
      phoneNumber,
      amount: numericAmount,
      employeeNumber,
      fullName,
      originatorConversationID,
      remarks: `Salary advance payment for ${fullName} (${employeeNumber})`,
      occasion: `SalaryAdvance_${employeeNumber}_${Date.now()}`,
    };

    // Save Pending record to Supabase
    if (supabase) {
      try {
        await supabase.from('mpesa_callbacks').insert({
          originator_conversation_id: originatorConversationID,
          result_type: 'B2C',
          amount: numericAmount,
          status: 'Pending',
          result_desc: 'Transaction Initiated',
          phone_number: phoneNumber,
          employee_id: employeeNumber,
          callback_date: new Date().toISOString()
        });
        console.log("✅ B2C pending record logged to DB");
      } catch (dbErr) {
        console.error("⚠️ Failed to log pending B2C request:", dbErr.message);
      }
    }

    const result = await initiateB2CPayment(paymentData);

    res.json({ success: true, data: result, message: "B2C payment initiated successfully" });
  } catch (error) {
    console.error("B2C payment endpoint error:", error.message);
    res.status(500).json({ success: false, message: error.message || "Internal server error" });
  }
});

// --- B2C Result Callback Endpoint ---
router.post("/b2c-result", async (req, res) => {
  try {
    console.log("✅ B2C Result callback received:", JSON.stringify(req.body, null, 2));

    const result = req.body.Result;

    if (!result) {
      console.warn("⚠️ Result object missing in callback");
      return res.status(400).json({ ResultCode: 1, ResultDesc: "Result object missing" });
    }

    const b2cParams = parseTransactionStatusParameters(result.ResultParameters?.ResultParameter);
    console.log("📊 Parsed B2C Parameters:", b2cParams);

    const transactionId = result.TransactionID || b2cParams.TransactionReceipt;
    const amount = b2cParams.TransactionAmount || result.TransactionAmount || 0;

    // Extract phone from ReceiverPartyPublicName (format: "254712345678 - John Doe")
    let phoneNumber = "";
    if (b2cParams.ReceiverPartyPublicName) {
      const match = b2cParams.ReceiverPartyPublicName.match(/\d{12}/);
      if (match) phoneNumber = match[0];
    }

    if (result.ResultCode === 0) {
      console.log("🎉 B2C payment successful:", {
        ConversationID: result.ConversationID,
        TransactionID: transactionId,
        Amount: amount,
        PhoneNumber: phoneNumber
      });

      if (supabase) {
        try {
          // Attempt to match by OriginatorConversationID or ConversationID
          const { error } = await supabase.from('mpesa_callbacks').upsert({
            originator_conversation_id: result.OriginatorConversationID,
            transaction_id: transactionId,
            conversation_id: result.ConversationID,
            result_type: 'B2C',
            result_code: result.ResultCode,
            result_desc: result.ResultDesc,
            amount: amount,
            status: 'Completed',
            phone_number: phoneNumber,
            raw_response: JSON.stringify(req.body),
            callback_date: new Date().toISOString()
          }, { onConflict: 'originator_conversation_id' });

          if (error) {
            console.error("❌ DB Error during B2C success save:", error.message);
            // Fallback: If upsert failed due to missing constraint, try simple insert
            await supabase.from('mpesa_callbacks').insert({
              originator_conversation_id: result.OriginatorConversationID,
              transaction_id: transactionId,
              conversation_id: result.ConversationID,
              result_type: 'B2C',
              result_code: result.ResultCode,
              result_desc: result.ResultDesc,
              amount: amount,
              status: 'Completed',
              phone_number: phoneNumber,
              raw_response: JSON.stringify(req.body),
              callback_date: new Date().toISOString()
            });
          } else {
            console.log("✅ B2C successful payment saved to DB");
          }
        } catch (dbErr) {
          console.error("❌ DB Error saving B2C success:", dbErr.message);
        }
      }
    } else {
      console.log("❌ B2C payment failed:", {
        ConversationID: result.ConversationID,
        ResultCode: result.ResultCode,
        ResultDesc: result.ResultDesc,
      });

      if (supabase) {
        try {
          await supabase.from('mpesa_callbacks').upsert({
            originator_conversation_id: result.OriginatorConversationID,
            conversation_id: result.ConversationID,
            result_type: 'B2C',
            result_code: result.ResultCode,
            result_desc: result.ResultDesc,
            status: 'Failed',
            raw_response: JSON.stringify(req.body),
            callback_date: new Date().toISOString()
          }, { onConflict: 'originator_conversation_id' });
          console.log("✅ B2C failed payment saved to DB");
        } catch (dbErr) {
          console.error("❌ DB Error saving B2C failure:", dbErr.message);
        }
      }
    }

    res.json({ ResultCode: 0, ResultDesc: "Service received successfully" });
  } catch (error) {
    console.error("Error processing B2C result:", error);
    res.status(500).json({ ResultCode: 1, ResultDesc: "Service processing failed" });
  }
});

export default router;