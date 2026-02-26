import { createClient } from '@supabase/supabase-js';
const supabase = createClient('https://hhuimwvbersrfwfozbyf.supabase.co', '***REMOVED***');
async function run() {
  const { data, error } = await supabase
    .from('mpesa_callbacks')
    .select('*, employees!inner("First Name", "Last Name", "Employee Number")')
    .limit(5);
  console.log("Error:", error);
  console.log("Data size:", data ? data.length : 0);
}
run();
