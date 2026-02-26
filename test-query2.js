import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://hhuimwvbersrfwfozbyf.supabase.co', '***REMOVED***');
async function run() {
  const { data: callbacks } = await supabase.from('mpesa_callbacks').select('*').limit(2000);
  console.log("Found callbacks:", callbacks ? callbacks.length : 0);
  
  const phoneNumbers = Array.from(new Set(callbacks.map(c => {
    let phone = c.phone_number;
    if (!phone && c.raw_response) {
      try {
        const raw = typeof c.raw_response === 'string' ? JSON.parse(c.raw_response) : c.raw_response;
        const resultObj = raw.Result || raw;
        const params = resultObj?.ResultParameters?.ResultParameter;
        if (Array.isArray(params)) {
          const p = params.find(p => p.Key === 'ReceiverPartyPublicName');
          if (p && p.Value) {
             const m = p.Value.match(/(?:254|0)[17]\d{8}/);
             phone = m ? m[0] : p.Value;
          }
        }
      } catch(e) {}
    }
    return phone ? phone.replace(/\D/g, '').slice(-9) : null;
  }))).filter(Boolean);
  
  console.log("Unique phones:", phoneNumbers.length);
  
  if (phoneNumbers.length > 0) {
    const { data: emp, error } = await supabase
        .from('employees')
        .select('"Employee Number", "Mobile Number"')
        .or(phoneNumbers.map(phone => `"Mobile Number".ilike.%${phone}%`).join(','));
    console.log("Employees query error:", error);
    console.log("Employees matched:", emp ? emp.length : 0);
  }
}
run();
