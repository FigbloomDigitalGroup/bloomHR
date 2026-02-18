import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Missing credentials");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log("🔍 Inspecting table schema...");
    const { data, error } = await supabase
        .from('salary_advance')
        .select('*')
        .limit(1);

    if (error) {
        console.error(error);
        return;
    }

    if (data.length > 0) {
        console.log("Column names:", Object.keys(data[0]));
    } else {
        console.log("Table is empty, cannot inspect.");
    }
}

inspectSchema();
