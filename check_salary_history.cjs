const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://hhuimwvbersrfwfozbyf.supabase.co', '***REMOVED***');

async function test() {
  console.log("Checking salary_history count...");
  const { data: historyData, error: historyErr, count: historyCount } = await supabase
    .from('salary_history')
    .select('*', { count: 'exact', head: false })
    .limit(10);
  console.log("salary_history rows:", historyData?.length, "Total Count:", historyCount);
  if (historyData && historyData.length) {
    console.log("Sample pay_periods in salary_history:", [...new Set(historyData.map(r => r.pay_period))]);
  }

  console.log("\nChecking payroll_records count...");
  const { data: prData, count: prCount } = await supabase
    .from('payroll_records')
    .select('*', { count: 'exact', head: false })
    .limit(10);
  console.log("payroll_records rows:", prData?.length, "Total Count:", prCount);
  if (prData && prData.length) {
    console.log("Sample pay_periods in payroll_records:", [...new Set(prData.map(r => r["Pay Period"]))]);
  }

  console.log("\nChecking payroll_records_current count...");
  const { data: prcData, count: prcCount } = await supabase
    .from('payroll_records_current')
    .select('*', { count: 'exact', head: false })
    .limit(10);
  console.log("payroll_records_current rows:", prcData?.length, "Total Count:", prcCount);
  if (prcData && prcData.length) {
    console.log("Sample pay_periods in payroll_records_current:", [...new Set(prcData.map(r => r["Pay Period"]))]);
  }
}
test();
