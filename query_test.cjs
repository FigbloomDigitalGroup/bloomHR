const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hhuimwvbersrfwfozbyf.supabase.co', '***REMOVED***');

async function test() {
  const { data, error } = await supabase.from('employees').select('*').limit(1);
  console.log('Error:', error);
  if (data && data.length) {
    console.log('Columns:', Object.keys(data[0]).filter(k => k.includes('ermin') || k.includes('nterview')));
  }
}
test();
