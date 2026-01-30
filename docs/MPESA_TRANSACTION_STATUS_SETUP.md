# M-Pesa Transaction Status - Issues & Setup Guide

## 🔴 **CRITICAL ISSUES FOUND**

### **Issue 1: Missing M-Pesa Environment Variables**
The `.env` file is **completely missing** all M-Pesa configuration variables. Without these, the M-Pesa API cannot authenticate with Safaricom's servers.

**Status:** ❌ **BLOCKING** - Transaction status checks will fail

---

## 📋 **REQUIRED SETUP STEPS**

### **Step 1: Add M-Pesa Credentials to `.env`**

You need to add the following variables to your `/Users/mac/Downloads/ZiraPro/.env` file:

```env
# ============================================================================
# M-PESA CONFIGURATION
# ============================================================================

# Consumer Key and Secret (from Safaricom Daraja Portal)
MPESA_CONSUMER_KEY=your_consumer_key_here
MPESA_CONSUMER_SECRET=your_consumer_secret_here

# Initiator credentials
MPESA_INITIATOR_NAME=your_initiator_name_here
MPESA_SECURITY_CREDENTIAL=your_security_credential_here

# M-Pesa Shortcode (Paybill or Till Number)
MPESA_SHORTCODE=your_shortcode_here

# ============================================================================
# CALLBACK URLs - Must be publicly accessible HTTPS URLs
# ============================================================================

# B2C Payment Callbacks
MPESA_B2C_RESULT_URL=https://mpesa-22p0.onrender.com/api/mpesa/b2c-result
MPESA_B2C_QUEUE_TIMEOUT_URL=https://mpesa-22p0.onrender.com/api/mpesa/b2c-timeout

# Transaction Status Callbacks
MPESA_TRANSACTION_STATUS_RESULT_URL=https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-result
MPESA_TRANSACTION_STATUS_QUEUE_TIMEOUT_URL=https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-timeout
```

### **Step 2: Get Your M-Pesa Credentials**

1. **Go to Safaricom Daraja Portal:** https://developer.safaricom.co.ke/
2. **Login** to your account
3. **Navigate to your App** (or create one if you don't have it)
4. **Copy the following:**
   - Consumer Key
   - Consumer Secret
   - Shortcode
   - Initiator Name
   - Security Credential (encrypted password)

### **Step 3: Update Callback URLs**

The callback URLs in the `.env` file are currently pointing to:
```
https://mpesa-22p0.onrender.com
```

**You need to:**
1. **If using production:** Replace with your actual deployed backend URL
2. **If testing locally:** Use ngrok to expose your local server:
   ```bash
   ngrok http 3001
   ```
   Then update all callback URLs with your ngrok URL (e.g., `https://abc123.ngrok.io/api/mpesa/...`)

### **Step 4: Register Callback URLs with Safaricom**

Once you have your callback URLs set up, you need to register them with Safaricom:

1. **For C2B (Customer to Business):**
   - Use the endpoint: `POST /api/mpesa/register-c2b`
   - This is already implemented in `mpesa.js`

2. **For Transaction Status:**
   - These URLs are automatically used when you make status check requests
   - Safaricom will POST results to these URLs

---

## 🔍 **HOW TRANSACTION STATUS WORKS**

### **Current Implementation (in `mpesa.js`):**

1. **Frontend calls:** `POST https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status`
   - Located in: `SalaryAdmin.tsx` line 2409
   
2. **Backend (`mpesa.js`) does:**
   - Generates M-Pesa access token using Consumer Key/Secret
   - Sends transaction status query to Safaricom API
   - Returns acknowledgment to frontend
   
3. **Safaricom processes the request and:**
   - Sends result to: `MPESA_TRANSACTION_STATUS_RESULT_URL`
   - Or timeout to: `MPESA_TRANSACTION_STATUS_QUEUE_TIMEOUT_URL`
   
4. **Backend receives callback:**
   - Endpoint: `/api/mpesa/transaction-status-result`
   - Updates database (`mpesa_callbacks` table)
   - Frontend auto-refreshes every 30 seconds to show updated status

### **Available Endpoints:**

✅ **Transaction Status Endpoints (Already Implemented):**
- `POST /api/mpesa/check-transaction-status` - Check by transaction ID
- `POST /api/mpesa/check-transaction-by-receipt` - Check by receipt number
- `POST /api/mpesa/transaction-status-result` - Callback for results
- `POST /api/mpesa/transaction-status-timeout` - Callback for timeouts

✅ **B2C Payment Endpoints:**
- `POST /api/mpesa/b2c` - Initiate B2C payment
- `POST /api/mpesa/b2c-result` - Callback for B2C results
- `POST /api/mpesa/b2c-timeout` - Callback for B2C timeouts

✅ **C2B Payment Endpoints:**
- `POST /api/mpesa/c2b-confirmation` - Callback for C2B confirmations
- `POST /api/mpesa/register-c2b` - Register C2B URLs

✅ **Utility Endpoints:**
- `GET /api/mpesa/health` - Health check
- `POST /api/mpesa/test-callback` - Test callback endpoint

---

## 🚀 **TESTING LOCALLY**

### **1. Start the M-Pesa Backend Server:**
```bash
cd /Users/mac/Downloads/ZiraPro
npm start
```
This will start the server on `http://localhost:3001`

### **2. Expose Local Server with ngrok:**
```bash
ngrok http 3001
```

### **3. Update `.env` with ngrok URL:**
```env
MPESA_B2C_RESULT_URL=https://your-ngrok-url.ngrok.io/api/mpesa/b2c-result
MPESA_B2C_QUEUE_TIMEOUT_URL=https://your-ngrok-url.ngrok.io/api/mpesa/b2c-timeout
MPESA_TRANSACTION_STATUS_RESULT_URL=https://your-ngrok-url.ngrok.io/api/mpesa/transaction-status-result
MPESA_TRANSACTION_STATUS_QUEUE_TIMEOUT_URL=https://your-ngrok-url.ngrok.io/api/mpesa/transaction-status-timeout
```

### **4. Restart the server:**
```bash
# Stop the current server (Ctrl+C)
npm start
```

---

## 🔧 **TROUBLESHOOTING**

### **Error: "Failed to generate access token"**
- ✅ Check `MPESA_CONSUMER_KEY` and `MPESA_CONSUMER_SECRET` are correct
- ✅ Ensure credentials are from the correct environment (Sandbox vs Production)

### **Error: "Failed to check transaction status"**
- ✅ Verify `MPESA_INITIATOR_NAME` is correct
- ✅ Verify `MPESA_SECURITY_CREDENTIAL` is properly encrypted
- ✅ Check that `MPESA_SHORTCODE` matches your app configuration

### **Callbacks not received:**
- ✅ Ensure callback URLs are **HTTPS** (not HTTP)
- ✅ Verify URLs are publicly accessible (test with curl or browser)
- ✅ Check ngrok is still running (it expires after 2 hours on free plan)
- ✅ Look at server logs for incoming requests

### **Transaction status shows "Pending" forever:**
- ✅ Check if Safaricom sent the callback (look at server logs)
- ✅ Verify the callback URL is correct in `.env`
- ✅ Check if the transaction ID is valid

---

## 📊 **DATABASE SCHEMA**

The `mpesa_callbacks` table stores all M-Pesa transactions:

```sql
- id (primary key)
- originator_conversation_id (unique)
- transaction_id
- conversation_id
- result_type ('B2C', 'C2B', 'TransactionStatus')
- result_code (0 = success, others = failure)
- result_desc
- amount
- status ('Pending', 'Completed', 'Failed')
- phone_number
- employee_id
- raw_response (full JSON from M-Pesa)
- callback_date
```

---

## ✅ **VERIFICATION CHECKLIST**

Before testing transaction status:

- [ ] All M-Pesa environment variables added to `.env`
- [ ] Credentials verified from Daraja Portal
- [ ] Callback URLs are HTTPS and publicly accessible
- [ ] M-Pesa backend server running (`npm start`)
- [ ] Frontend can reach backend (check `VITE_API_URL` in `.env`)
- [ ] Database `mpesa_callbacks` table exists
- [ ] Supabase credentials in `.env` are correct

---

## 📞 **NEXT STEPS**

1. **Add the missing environment variables** to `.env`
2. **Restart the M-Pesa backend server** (`npm start`)
3. **Test the transaction status check** from the admin portal
4. **Monitor server logs** for any errors
5. **Check the `mpesa_callbacks` table** in Supabase for results

---

## 📝 **NOTES**

- The frontend is currently hardcoded to call `https://mpesa-22p0.onrender.com`
- For local development, you may want to update this to use `VITE_API_URL` from `.env`
- The transaction status check is asynchronous - results come via callback
- Auto-refresh is set to 30 seconds in the frontend
