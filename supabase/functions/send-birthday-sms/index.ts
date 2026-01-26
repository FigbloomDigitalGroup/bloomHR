import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const CELCOM_API_KEY = '***REMOVED***';
const CELCOM_PARTNER_ID = '928';
const CELCOM_SHORTCODE = 'MularCredit';

serve(async (req) => {
    try {
        // Initialize Supabase client
        const supabaseClient = createClient(
            Deno.env.get('SUPABASE_URL') ?? '',
            Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        )

        // Get today's date
        const today = new Date();
        const currentMonth = today.getMonth() + 1;
        const currentDay = today.getDate();
        const todayDate = today.toISOString().split('T')[0];

        console.log(`🎂 Checking birthdays for ${todayDate}`);

        // Fetch employees with birthdays today
        const { data: employees, error: fetchError } = await supabaseClient
            .from('employees')
            .select('"Employee Number", "First Name", "Last Name", "Mobile Number", "Personal Mobile", "Work Mobile", "Date of Birth"')
            .not('Date of Birth', 'is', null);

        if (fetchError) {
            throw new Error(`Failed to fetch employees: ${fetchError.message}`);
        }

        // Filter for today's birthdays
        const birthdayEmployees = employees?.filter(emp => {
            if (!emp['Date of Birth']) return false;
            try {
                const birthDate = new Date(emp['Date of Birth']);
                return birthDate.getMonth() + 1 === currentMonth &&
                    birthDate.getDate() === currentDay;
            } catch (e) {
                return false;
            }
        }) || [];

        console.log(`Found ${birthdayEmployees.length} birthdays today`);

        if (birthdayEmployees.length === 0) {
            return new Response(
                JSON.stringify({
                    success: true,
                    message: 'No birthdays today',
                    count: 0
                }),
                { headers: { "Content-Type": "application/json" } }
            );
        }

        let successCount = 0;
        let failCount = 0;
        const results = [];

        // Send SMS to each birthday person
        for (const emp of birthdayEmployees) {
            const employeeId = emp['Employee Number'];
            const firstName = emp['First Name'] || '';
            const lastName = emp['Last Name'] || '';
            const fullName = `${firstName} ${lastName}`.trim();

            // Get phone number
            let rawPhone = emp['Mobile Number'] || emp['Personal Mobile'] || emp['Work Mobile'] || '';
            const phone = formatPhoneNumber(rawPhone);

            if (!phone || phone.length !== 12) {
                console.log(`❌ Invalid phone for ${fullName}: ${rawPhone}`);
                failCount++;
                continue;
            }

            // Check if already sent today
            const { data: existingLog } = await supabaseClient
                .from('birthday_sms_log')
                .select('id')
                .eq('employee_id', employeeId)
                .eq('birthday_date', todayDate)
                .single();

            if (existingLog) {
                console.log(`⏭️  Already sent to ${fullName} today`);
                continue;
            }

            // Send SMS
            try {
                const message = `Happy Birthday ${firstName}! 🎉 Wishing you a fantastic year ahead from Mular Credit Team`;
                const encodedMessage = encodeURIComponent(message);
                const url = `https://isms.celcomafrica.com/api/services/sendsms/?apikey=${CELCOM_API_KEY}&partnerID=${CELCOM_PARTNER_ID}&message=${encodedMessage}&shortcode=${CELCOM_SHORTCODE}&mobile=${phone}`;

                const response = await fetch(url, { method: 'GET' });

                // Log to sms_logs
                await supabaseClient.from('sms_logs').insert({
                    recipient_phone: phone,
                    message: message,
                    status: 'sent',
                    sender_id: CELCOM_SHORTCODE
                });

                // Log to birthday_sms_log
                await supabaseClient.from('birthday_sms_log').insert({
                    employee_id: employeeId,
                    employee_name: fullName,
                    phone_number: phone,
                    birthday_date: todayDate,
                    status: 'sent'
                });

                console.log(`✅ Sent to ${fullName} (${phone})`);
                successCount++;
                results.push({ name: fullName, status: 'sent' });

                // Wait 1 second between sends
                await new Promise(resolve => setTimeout(resolve, 1000));

            } catch (error) {
                console.error(`❌ Failed to send to ${fullName}:`, error);

                // Log failure
                await supabaseClient.from('birthday_sms_log').insert({
                    employee_id: employeeId,
                    employee_name: fullName,
                    phone_number: phone,
                    birthday_date: todayDate,
                    status: 'failed',
                    error_message: error.message
                });

                failCount++;
                results.push({ name: fullName, status: 'failed', error: error.message });
            }
        }

        return new Response(
            JSON.stringify({
                success: true,
                message: `Birthday SMS automation completed`,
                totalBirthdays: birthdayEmployees.length,
                sent: successCount,
                failed: failCount,
                results: results
            }),
            { headers: { "Content-Type": "application/json" } }
        );

    } catch (error) {
        console.error('Error in birthday SMS automation:', error);
        return new Response(
            JSON.stringify({
                success: false,
                error: error.message
            }),
            {
                status: 500,
                headers: { "Content-Type": "application/json" }
            }
        );
    }
})

function formatPhoneNumber(phone: string): string {
    if (!phone) return '';

    let cleaned = phone.replace(/\D/g, '');

    if (cleaned.startsWith('0') && cleaned.length === 10) {
        cleaned = '254' + cleaned.substring(1);
    } else if (cleaned.startsWith('7') && cleaned.length === 9) {
        cleaned = '254' + cleaned;
    } else if (cleaned.startsWith('+254')) {
        cleaned = cleaned.substring(1);
    }

    return cleaned.length === 12 && cleaned.startsWith('254') ? cleaned : '';
}
