import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import fs from "fs";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkStuck() {
    console.log("🔍 Fetching salary advances stuck in 'processing' state...");

    const { data, error } = await supabase
        .from('salary_advance')
        .select('id, "Employee Number", "Full Name", "Amount Requested", "time_added"')
        .eq('status', 'processing');

    if (error) {
        console.error("❌ Error fetching records:", error);
        return;
    }

    console.log(`✅ Found ${data.length} records stuck in 'processing'.`);

    if (data.length > 0) {
        const list = data.map(d => `${d["Full Name"]} (${d["Employee Number"]}) - KSh ${d["Amount Requested"]}`).join('\n');
        fs.writeFileSync('stuck_payments.txt', list);
        console.log("📄 List saved to stuck_payments.txt");
    }
}

checkStuck();
