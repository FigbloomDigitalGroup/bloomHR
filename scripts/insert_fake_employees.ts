import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

// Load env vars
dotenv.config();
dotenv.config({ path: '.env.tenant' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createFakeEmployees() {
    const fakeEmployees = [
        {
            "Employee Number": "EMP-9001",
            "First Name": "John",
            "Last Name": "Doe",
            "Work Email": "john.doe@fake.test",
            "Job Title": "Junior Developer",
            "Employee Type": "Engineering",
            "Branch": "HQ"
        },
        {
            "Employee Number": "EMP-9002",
            "First Name": "Jane",
            "Last Name": "Smith",
            "Work Email": "jane.smith@fake.test",
            "Job Title": "Product Manager",
            "Employee Type": "Product",
            "Branch": "HQ"
        }
    ];

    console.log("Inserting fake employees...");
    const { data, error } = await supabase.from('employees').upsert(fakeEmployees).select();

    if (error) {
        console.error("Error inserting employees:", error);
    } else {
        console.log("Successfully inserted fake employees:", data?.map(e => e['Employee Number']));
    }
}

createFakeEmployees();
