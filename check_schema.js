const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '/Users/mac/Downloads/ZiraPro/.env' });

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function check() {
  const { data, error } = await supabase.from('company_logo').select('*').limit(5);
  console.log("data:", data, "error:", error);
}
check();
