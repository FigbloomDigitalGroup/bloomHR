# M-Pesa Transaction Status Debugging Guide
## For Deployed Server on Render (https://mpesa-22p0.onrender.com)

---

## ✅ **VERIFIED WORKING**

1. ✅ **Server is UP and HEALTHY**
   - URL: https://mpesa-22p0.onrender.com/api/mpesa/health
   - Status: Running
   - All endpoints are registered correctly

2. ✅ **Transaction Status Endpoints Available:**
   - `POST /api/mpesa/check-transaction-status`
   - `POST /api/mpesa/transaction-status-result`
   - `POST /api/mpesa/transaction-status-timeout`

3. ✅ **Frontend Implementation Correct:**
   - Calling: `https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status`
   - Sending correct payload: `{ transactionID, remarks, occasion }`

---

## 🔍 **DEBUGGING STEPS**

### **Step 1: Check Render Server Logs**

Since your M-Pesa server is deployed on Render, you need to check the logs there:

1. **Go to Render Dashboard:** https://dashboard.render.com/
2. **Select your M-Pesa service** (mpesa-22p0)
3. **Click on "Logs" tab**
4. **Look for these log messages when you trigger a transaction status check:**

   **Expected logs:**
   ```
   🔍 Initiating transaction status check: { transactionID: '...', ... }
   🔍 Checking transaction status: { TransactionID: '...', ... }
   ✅ Transaction status query initiated: { ... }
   ```

   **Error logs to watch for:**
   ```
   ❌ Error checking transaction status: ...
   ❌ Transaction status check failed: ...
   ❌ Error generating access token: ...
   ```

### **Step 2: Verify Environment Variables on Render**

1. **Go to your service on Render**
2. **Click "Environment" tab**
3. **Verify ALL these variables are set:**

   ```
   MPESA_CONSUMER_KEY=...
   MPESA_CONSUMER_SECRET=...
   MPESA_INITIATOR_NAME=...
   MPESA_SECURITY_CREDENTIAL=...
   MPESA_SHORTCODE=...
   MPESA_TRANSACTION_STATUS_RESULT_URL=https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-result
   MPESA_TRANSACTION_STATUS_QUEUE_TIMEOUT_URL=https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-timeout
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_SERVICE_ROLE_KEY=...
   ```

4. **If any are missing, add them and redeploy**

### **Step 3: Test the Endpoint Directly**

Use this curl command to test the endpoint directly:

```bash
curl -X POST https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status \
  -H "Content-Type: application/json" \
  -d '{
    "transactionID": "SGL31HA2UV",
    "remarks": "Test status check",
    "occasion": "TestCheck"
  }'
```

**Expected Response (Success):**
```json
{
  "success": true,
  "message": "Transaction status query initiated successfully",
  "data": {
    "OriginatorConversationID": "...",
    "ConversationID": "...",
    "ResponseCode": "0",
    "ResponseDescription": "Accept the service request successfully."
  }
}
```

**Expected Response (Error):**
```json
{
  "success": false,
  "message": "Error message here"
}
```

### **Step 4: Check Supabase Database**

1. **Go to Supabase Dashboard**
2. **Open SQL Editor**
3. **Run this query to see recent transaction status checks:**

```sql
SELECT 
  id,
  transaction_id,
  originator_conversation_id,
  result_type,
  status,
  result_code,
  result_desc,
  callback_date,
  created_at
FROM mpesa_callbacks
WHERE result_type LIKE '%TransactionStatus%'
ORDER BY created_at DESC
LIMIT 20;
```

**What to look for:**
- Records with `result_type = 'TransactionStatus_Pending'` (request initiated)
- Records with `result_type = 'TransactionStatus'` (result received)
- Check if `status` changes from 'Pending' to 'Completed' or 'Failed'

---

## 🐛 **COMMON ISSUES & SOLUTIONS**

### **Issue 1: "Failed to generate access token"**

**Cause:** Invalid M-Pesa Consumer Key/Secret

**Solution:**
1. Verify credentials in Render environment variables
2. Check if using correct environment (Sandbox vs Production)
3. Ensure no extra spaces in the credentials
4. Regenerate credentials from Daraja Portal if needed

**Test:**
```bash
# Test if credentials work by calling auth endpoint directly
curl -X GET https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials \
  -H "Authorization: Basic $(echo -n 'CONSUMER_KEY:CONSUMER_SECRET' | base64)"
```

### **Issue 2: "Transaction status query initiated but no callback received"**

**Cause:** Callback URLs not reachable or incorrect

**Solution:**
1. Verify callback URLs in Render environment:
   ```
   MPESA_TRANSACTION_STATUS_RESULT_URL=https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-result
   ```
2. Test if callback endpoint is accessible:
   ```bash
   curl https://mpesa-22p0.onrender.com/api/mpesa/transaction-status-result
   ```
3. Check Render logs for incoming POST requests to `/api/mpesa/transaction-status-result`

### **Issue 3: "Invalid Security Credential"**

**Cause:** Security credential not properly encrypted

**Solution:**
1. Get the correct Security Credential from Daraja Portal
2. It should be a long encrypted string (not plain password)
3. Update in Render environment variables
4. Redeploy the service

### **Issue 4: "Transaction ID not found"**

**Cause:** Transaction ID doesn't exist or is invalid

**Solution:**
1. Verify the transaction ID is correct (from M-Pesa receipt)
2. Check if it's a real M-Pesa transaction (not test data)
3. Ensure the transaction was done on the same shortcode

### **Issue 5: Frontend shows "Pending" forever**

**Cause:** Callback not updating the database

**Solution:**
1. Check Render logs for callback reception
2. Verify Supabase credentials in Render environment
3. Check if `mpesa_callbacks` table has correct schema
4. Look for database errors in Render logs:
   ```
   ❌ DB Error during transaction status save: ...
   ```

---

## 🔧 **MANUAL TESTING WORKFLOW**

### **Test 1: Check Server Health**
```bash
curl https://mpesa-22p0.onrender.com/api/mpesa/health
```
Expected: `{"status":"healthy",...}`

### **Test 2: Initiate Transaction Status Check**
```bash
curl -X POST https://mpesa-22p0.onrender.com/api/mpesa/check-transaction-status \
  -H "Content-Type: application/json" \
  -d '{
    "transactionID": "ACTUAL_MPESA_TRANSACTION_ID",
    "remarks": "Manual test",
    "occasion": "DebugTest"
  }'
```

### **Test 3: Check Render Logs**
- Go to Render Dashboard → Logs
- Look for the log messages from Test 2
- Check for errors

### **Test 4: Check Database**
```sql
-- In Supabase SQL Editor
SELECT * FROM mpesa_callbacks 
WHERE result_type LIKE '%TransactionStatus%' 
ORDER BY created_at DESC 
LIMIT 5;
```

### **Test 5: Wait for Callback**
- Wait 30-60 seconds
- Check Render logs for incoming callback
- Re-run Test 4 to see if status updated

---

## 📊 **EXPECTED FLOW**

```
1. Frontend calls: POST /api/mpesa/check-transaction-status
   ↓
2. Backend logs: "🔍 Initiating transaction status check"
   ↓
3. Backend inserts: Pending record in mpesa_callbacks
   ↓
4. Backend calls: Safaricom API (TransactionStatusQuery)
   ↓
5. Backend logs: "✅ Transaction status query initiated"
   ↓
6. Backend returns: { success: true, ... }
   ↓
7. Safaricom processes (10-60 seconds)
   ↓
8. Safaricom calls: POST /api/mpesa/transaction-status-result
   ↓
9. Backend logs: "✅ Transaction Status Result received"
   ↓
10. Backend updates: mpesa_callbacks record (status = 'Completed')
    ↓
11. Frontend auto-refresh (every 30s) shows updated status
```

---

## 🚨 **CRITICAL CHECKS**

Before reporting an issue, verify:

- [ ] Render service is running (not sleeping/crashed)
- [ ] All environment variables are set on Render
- [ ] Supabase credentials are correct
- [ ] M-Pesa credentials are valid (test with curl)
- [ ] Transaction ID being tested is a real M-Pesa transaction
- [ ] Callback URLs are HTTPS and publicly accessible
- [ ] `mpesa_callbacks` table exists in Supabase
- [ ] No errors in Render logs

---

## 📞 **NEXT STEPS**

1. **Check Render logs** while triggering a transaction status check
2. **Copy any error messages** you see
3. **Run the SQL query** to check database records
4. **Test with curl** to isolate frontend vs backend issues
5. **Share the error logs** for further debugging

---

## 💡 **QUICK FIX CHECKLIST**

If transaction status is not working:

1. **Restart Render service** (sometimes fixes temporary issues)
2. **Verify environment variables** are all set
3. **Check M-Pesa credentials** are valid
4. **Test with a recent transaction ID** (within last 30 days)
5. **Monitor Render logs** in real-time while testing
6. **Check Supabase connection** from Render

---

## 📝 **RENDER LOG EXAMPLES**

**Successful Flow:**
```
🔍 Initiating transaction status check: { transactionID: 'SGL31HA2UV', ... }
🔍 Checking transaction status: { TransactionID: 'SGL31HA2UV', ... }
✅ Transaction status query initiated: { OriginatorConversationID: '...', ... }
✅ Transaction Status Result received: { Result: { ... } }
✅ Transaction status updated in DB
```

**Failed Flow (Auth Error):**
```
🔍 Initiating transaction status check: { transactionID: 'SGL31HA2UV', ... }
Error generating access token: Request failed with status code 401
❌ Transaction status check failed: Failed to generate access token
```

**Failed Flow (Invalid Transaction):**
```
🔍 Initiating transaction status check: { transactionID: 'INVALID123', ... }
🔍 Checking transaction status: { TransactionID: 'INVALID123', ... }
❌ Error checking transaction status: { errorCode: '404.001.03', errorMessage: 'Transaction not found' }
❌ Transaction status check failed: Transaction not found
```
