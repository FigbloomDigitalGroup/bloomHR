import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env
dotenv.config({ path: resolve(__dirname, '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase URL or Service Role Key in .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function repairBranches() {
  console.log('🚀 Starting Branch Repair Script...');

  // 1. Fetch all applications where branch info is missing
  // We check for null, empty string, or 'N/A'
  const { data: applications, error: fetchError } = await supabase
    .from('salary_advance')
    .select('*');

  if (fetchError) {
    console.error('Error fetching applications:', fetchError);
    return;
  }

  const missingBranchApps = applications.filter(app => {
    const branch = app['Office Branch'] || app.Office_Branch || app.office_branch;
    return !branch || branch === 'N/A' || branch.trim() === '';
  });

  console.log(`🔍 Found ${missingBranchApps.length} applications with missing branch info.`);

  if (missingBranchApps.length === 0) {
    console.log('✅ No repairs needed.');
    return;
  }

  // 2. Map unique employee numbers to their current branch from employees table
  const employeeNumbers = [...new Set(missingBranchApps.map(app => app['Employee Number']))];
  
  console.log(`👤 Fetching branch info for ${employeeNumbers.length} unique employees...`);

  const { data: employees, error: employeeError } = await supabase
    .from('employees')
    .select('"Employee Number", Town')
    .in('Employee Number', employeeNumbers);

  if (employeeError) {
    console.error('Error fetching employees:', employeeError);
    return;
  }

  const employeeTreeMap = {};
  employees.forEach(emp => {
    employeeTreeMap[emp['Employee Number']] = emp.Town;
  });

  // 3. Update applications
  let successCount = 0;
  let failCount = 0;

  for (const app of missingBranchApps) {
    const correctBranch = employeeTreeMap[app['Employee Number']];
    
    if (correctBranch) {
      const { error: updateError } = await supabase
        .from('salary_advance')
        .update({ 'Office Branch': correctBranch })
        .eq('id', app.id);

      if (updateError) {
        console.error(`❌ Failed to update app ${app.id}:`, updateError);
        failCount++;
      } else {
        successCount++;
      }
    } else {
      console.warn(`⚠️ No branch info found in employees table for Employee Number: ${app['Employee Number']}`);
      failCount++;
    }
  }

  console.log('-----------------------------------');
  console.log(`✅ Completed! Success: ${successCount}, Failed/Skipped: ${failCount}`);
  console.log('-----------------------------------');
}

repairBranches().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
