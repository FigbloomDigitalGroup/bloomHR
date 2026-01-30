# How M-Pesa Transactions Are Retrieved from Supabase

## 📊 **Overview**

M-Pesa transactions are stored in the **`mpesa_callbacks`** table in Supabase and retrieved using the Supabase JavaScript client.

---

## 🗄️ **Database Table: `mpesa_callbacks`**

### **Table Structure:**

```sql
CREATE TABLE mpesa_callbacks (
  id SERIAL PRIMARY KEY,
  transaction_id TEXT,
  originator_conversation_id TEXT UNIQUE,
  conversation_id TEXT,
  result_type TEXT,
  result_code INTEGER,
  result_desc TEXT,
  amount DECIMAL,
  status TEXT,
  phone_number TEXT,
  employee_id TEXT,
  raw_response JSONB,
  callback_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);
```

### **Key Fields:**

- **`transaction_id`** - M-Pesa transaction code (e.g., `UAMC14MZPJ`)
- **`originator_conversation_id`** - Unique identifier for the request
- **`result_code`** - 0 = Success, others = Failed
- **`result_desc`** - Description from M-Pesa
- **`amount`** - Transaction amount
- **`status`** - 'Pending', 'Completed', 'Failed'
- **`employee_id`** - Employee number (for linking to employees table)
- **`raw_response`** - Full JSON response from M-Pesa

---

## 🔄 **How Data Gets Into the Table**

### **1. M-Pesa Callback Flow:**

```
User initiates payment/check
    ↓
Backend sends request to M-Pesa API
    ↓
Backend inserts "Pending" record in mpesa_callbacks
    ↓
M-Pesa processes (10-60 seconds)
    ↓
M-Pesa sends callback to: /api/mpesa/b2c-result or /api/mpesa/transaction-status-result
    ↓
Backend receives callback
    ↓
Backend updates/inserts record in mpesa_callbacks
    ↓
Frontend fetches updated data
```

### **2. Backend Insertion (mpesa.js):**

**Location:** `/mpesa.js` lines 150-166, 261-268, 622-636

**Example from B2C Payment:**
```javascript
// When initiating payment (Pending)
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
```

**Example from Callback (Completed/Failed):**
```javascript
// When callback is received
await supabase.from('mpesa_callbacks').upsert({
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
```

---

## 📥 **How Frontend Retrieves Data**

### **Component: MpesaCallbacks.tsx**

**Location:** `/src/components/Settings/MpesaCallbacks.tsx`

### **Main Query Function:**

```typescript
const fetchLogs = async () => {
  try {
    setLoading(true);
    
    // Step 1: Fetch all M-Pesa callbacks
    const { data, error } = await supabase
      .from('mpesa_callbacks')
      .select('*')
      .order('callback_date', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Step 2: Enrich with employee data
    const enrichedData = await Promise.all(data.map(async (log) => {
      if (log.employee_id) {
        const { data: emp } = await supabase
          .from('employees')
          .select('"First Name", "Last Name", "Profile Image"')
          .eq('Employee Number', log.employee_id)
          .single();
        
        if (emp) return { ...log, employees: emp };
      }
      return log;
    }));

    setLogs(enrichedData);
  } catch (err) {
    console.error('Error fetching logs:', err);
    toast.error('Failed to refresh logs');
  } finally {
    setLoading(false);
  }
};
```

### **Query Breakdown:**

1. **`.from('mpesa_callbacks')`** - Select from the table
2. **`.select('*')`** - Get all columns
3. **`.order('callback_date', { ascending: false })`** - Sort by newest first
4. **`.limit(100)`** - Get last 100 transactions

---

## 🔗 **Employee Data Enrichment**

### **Why Enrichment?**

The `mpesa_callbacks` table stores `employee_id` as a string, but we need employee names and details for display.

### **How It Works:**

```typescript
// For each M-Pesa callback
if (log.employee_id) {
  // Fetch matching employee from employees table
  const { data: emp } = await supabase
    .from('employees')
    .select('"First Name", "Last Name", "Profile Image"')
    .eq('Employee Number', log.employee_id)
    .single();
  
  // Merge employee data with callback
  if (emp) return { ...log, employees: emp };
}
```

### **Result:**

```javascript
{
  id: 123,
  transaction_id: "UAMC14MZPJ",
  employee_id: "EMP001",
  amount: 5000,
  status: "Completed",
  // ... other fields
  employees: {
    "First Name": "John",
    "Last Name": "Doe",
    "Profile Image": "https://..."
  }
}
```

---

## 🔄 **Auto-Refresh Feature**

### **Real-time Updates:**

```typescript
useEffect(() => {
  fetchLogs();

  // Auto-refresh interval
  let interval: any;
  if (autoRefresh) {
    interval = setInterval(fetchLogs, 5000); // Every 5 seconds
  }
  return () => clearInterval(interval);
}, [autoRefresh]);
```

### **How to Enable:**

1. Click "Enable Stream" button in the UI
2. Data refreshes every 5 seconds automatically
3. Click "Pause Stream" to stop

---

## 🔍 **Filtering & Search**

### **Client-Side Filtering:**

```typescript
const filteredLogs = logs.filter(log => {
  // Search filter
  const matchesSearch =
    log.transaction_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.receipt_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    log.employee_id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (log.employees && `${log.employees["First Name"]} ${log.employees["Last Name"]}`
      .toLowerCase().includes(searchTerm.toLowerCase()));

  // Status filter
  const matchesStatus = statusFilter === 'all' ||
    (statusFilter === 'success' && log.result_code === 0) ||
    (statusFilter === 'failed' && log.result_code !== 0 && log.status !== 'Pending') ||
    (statusFilter === 'pending' && log.status === 'Pending');

  return matchesSearch && matchesStatus;
});
```

### **Available Filters:**

- **Search:** Transaction ID, Receipt, Employee ID, Employee Name
- **Status:** All, Success, Pending, Failed

---

## 📊 **Statistics Calculation**

### **Real-time Stats:**

```typescript
const stats = {
  total: logs.length,
  success: logs.filter(l => l.result_code === 0).length,
  failed: logs.filter(l => l.result_code !== 0 && l.status !== 'Pending').length,
  pending: logs.filter(l => l.status === 'Pending').length,
  totalAmount: logs.filter(l => l.result_code === 0)
    .reduce((sum, l) => sum + (l.amount || 0), 0)
};
```

### **Displayed Stats:**

- **Success Rate** - Percentage of successful transactions
- **Total Volume** - Sum of all successful transaction amounts
- **Failed/Pending** - Count of failed and pending transactions

---

## 🎯 **Other Components Using M-Pesa Data**

### **1. SalaryAdmin.tsx**

**Query:**
```typescript
const { data, error } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .order('callback_date', { ascending: false });
```

**Usage:** Displays M-Pesa callbacks in the Salary Admin section

---

### **2. MpesaZapPortal.tsx**

**Query:**
```typescript
const { data, error } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .order('callback_date', { ascending: false })
  .limit(50);
```

**Usage:** Shows recent transactions in the M-Pesa Zap portal

**Real-time Subscription:**
```typescript
const channel = supabase.channel('mpesa_zap_stream')
  .on('postgres_changes', {
    event: '*',
    schema: 'public',
    table: 'mpesa_callbacks'
  }, (payload) => {
    console.log('Change received!', payload);
    fetchCallbacks();
  })
  .subscribe();
```

---

## 🔐 **Security & Permissions**

### **Row Level Security (RLS):**

Ensure your Supabase table has appropriate RLS policies:

```sql
-- Allow authenticated users to read
CREATE POLICY "Allow authenticated users to read mpesa_callbacks"
ON mpesa_callbacks FOR SELECT
TO authenticated
USING (true);

-- Allow service role to insert/update
CREATE POLICY "Allow service role to insert mpesa_callbacks"
ON mpesa_callbacks FOR INSERT
TO service_role
WITH CHECK (true);
```

### **API Keys:**

- **Frontend:** Uses `VITE_SUPABASE_ANON_KEY` (read-only)
- **Backend:** Uses `VITE_SUPABASE_SERVICE_ROLE_KEY` (full access)

---

## 📝 **Data Flow Summary**

```
┌─────────────────────────────────────────────────────────┐
│                    M-Pesa API                           │
└─────────────────────────────────────────────────────────┘
                          ↓
                    (Callback)
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Backend (mpesa.js)                         │
│  - Receives callback                                    │
│  - Parses M-Pesa response                              │
│  - Inserts/Updates Supabase                            │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│         Supabase (mpesa_callbacks table)                │
│  - Stores transaction data                             │
│  - Triggers real-time updates                          │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│              Frontend Components                        │
│  - MpesaCallbacks.tsx                                  │
│  - SalaryAdmin.tsx                                     │
│  - MpesaZapPortal.tsx                                  │
│                                                         │
│  Actions:                                              │
│  1. Fetch data with supabase.from('mpesa_callbacks')  │
│  2. Enrich with employee data                          │
│  3. Filter and search                                  │
│  4. Display in UI                                      │
│  5. Auto-refresh every 5-30 seconds                    │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ **Common Queries**

### **Get All Transactions:**
```typescript
const { data } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .order('callback_date', { ascending: false });
```

### **Get Pending Transactions:**
```typescript
const { data } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .eq('status', 'Pending')
  .order('callback_date', { ascending: false });
```

### **Get Transactions by Employee:**
```typescript
const { data } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .eq('employee_id', 'EMP001')
  .order('callback_date', { ascending: false });
```

### **Get Successful Transactions:**
```typescript
const { data } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .eq('result_code', 0)
  .order('callback_date', { ascending: false });
```

### **Get Transactions by Date Range:**
```typescript
const { data } = await supabase
  .from('mpesa_callbacks')
  .select('*')
  .gte('callback_date', '2026-01-01')
  .lte('callback_date', '2026-01-31')
  .order('callback_date', { ascending: false });
```

---

## 🎯 **Key Takeaways**

1. ✅ **Data Source:** `mpesa_callbacks` table in Supabase
2. ✅ **Insertion:** Backend (mpesa.js) inserts data when M-Pesa sends callbacks
3. ✅ **Retrieval:** Frontend components query Supabase directly
4. ✅ **Enrichment:** Employee data is fetched separately and merged
5. ✅ **Real-time:** Auto-refresh and Supabase subscriptions keep data current
6. ✅ **Filtering:** Client-side filtering for search and status
7. ✅ **Security:** RLS policies control access

---

## 📚 **Related Files**

- **Backend:** `/mpesa.js` (lines 150-166, 261-268, 622-636, 680-719)
- **Frontend:** `/src/components/Settings/MpesaCallbacks.tsx` (lines 46-84)
- **Frontend:** `/src/components/Settings/SalaryAdmin.tsx` (lines 1740-1780)
- **Frontend:** `/src/components/Settings/MpesaZapPortal.tsx` (lines 45-80)
