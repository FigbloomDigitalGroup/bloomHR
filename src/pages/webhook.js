// /api/webhooks/resend/route.js
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export async function POST(request) {
  try {
    const signature = request.headers.get('resend-signature');

    // Verify webhook signature (optional but recommended)
    if (!verifyResendSignature(request)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }

    const event = await request.json();

    console.log('Resend Webhook Received:', event);

    // Handle different event types
    switch (event.type) {
      case 'email.bounced':
        await handleBouncedEmail(event);
        break;
      case 'email.delivered':
        await handleDeliveredEmail(event);
        break;
      case 'email.sent':
        await handleSentEmail(event);
        break;
      default:
        console.log('Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

function verifyResendSignature(request) {
  // Implement Resend webhook signature verification
  // See: https://resend.com/docs/dashboard/webhooks#securing-webhooks
  return true; // For now, implement proper verification in production
}

async function handleBouncedEmail(event) {
  const { data: emailLog, error } = await supabase
    .from('email_logs')
    .update({
      status: 'bounced',
      bounce_reason: event.data.reason || 'Unknown reason',
      bounced_at: new Date().toISOString(),
      last_webhook_event: event.type,
      webhook_received_at: new Date().toISOString()
    })
    .eq('message_id', event.data.email_id || event.data.id)
    .select()
    .single();

  if (error) {
    console.error('Error updating bounced email:', error);
    return;
  }

  console.log(`Email ${event.data.to} marked as bounced:`, event.data.reason);

  // You could also send a notification to admins here
  await sendBounceNotification(emailLog, event.data.reason);
}

async function handleDeliveredEmail(event) {
  await supabase
    .from('email_logs')
    .update({
      status: 'delivered',
      delivered_at: new Date().toISOString(),
      last_webhook_event: event.type,
      webhook_received_at: new Date().toISOString()
    })
    .eq('message_id', event.data.email_id || event.data.id);
}

async function handleSentEmail(event) {
  await supabase
    .from('email_logs')
    .update({
      status: 'sent',
      last_webhook_event: event.type,
      webhook_received_at: new Date().toISOString()
    })
    .eq('resend_id', event.data.email_id);
}

async function sendBounceNotification(emailLog, bounceReason) {
  // Send internal notification about bounced email
  // This could be an email to admins, Slack message, etc.
  console.log(`BOUNCE NOTIFICATION: ${emailLog.email} - ${bounceReason}`);
}