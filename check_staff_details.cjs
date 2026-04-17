const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hhuimwvbersrfwfozbyf.supabase.co', '***REMOVED***');

async function test() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .limit(1);
  console.log("Single employee:", JSON.stringify(data[0], null, 2));
}
test();
