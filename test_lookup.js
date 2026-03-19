import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .ilike('Employee Number', '%001%');

  if (error) console.error(error);
  console.log('Matching Employees:', data);
  
  const { data: appData, error: appError } = await supabase
    .from('salary_advance')
    .select('*')
    .ilike('Employee Number', '%001%');
    
  if (appError) console.error(appError);
  console.log('Application Data:', appData);
}

test();
