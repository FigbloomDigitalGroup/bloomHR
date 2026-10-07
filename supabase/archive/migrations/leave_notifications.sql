-- Leave Notifications
-- Run this once in your Supabase SQL editor
--
-- Extends the existing hr_notifications system (until now only used for
-- contract/probation expiry reminders - see hr_notifications.sql) to cover
-- the two-level leave approval flow from FIG-573:
--   - department head recommends -> notify HR/Admin (via the existing
--     admin bell, Header.tsx - fetchAdminHRNotifications has no type
--     filter, so this needs no frontend wiring beyond the insert itself)
--   - HR approves/rejects -> notify the employee (via the Staff Portal's
--     notification panel, which is extended to also read hr_notifications
--     alongside disciplinary warnings)
--
-- "Leave submitted" deliberately has no new notification type: Header.tsx
-- already shows a generic "New Leave Application" item for any
-- leave_application row from the last 24h, so adding a second one here
-- would just duplicate it.

alter table public.hr_notifications drop constraint if exists hr_notifications_notification_type_check;
alter table public.hr_notifications add constraint hr_notifications_notification_type_check
  check (notification_type in ('contract_expiring', 'probation_expiring', 'leave_recommended', 'leave_approved', 'leave_rejected'));

-- end_date/days_remaining were NOT NULL, sized for contract/probation
-- reminders specifically. Leave notifications only have a natural fit for
-- end_date (the leave's end date); days_remaining doesn't mean anything
-- for a leave decision, so it's left null rather than repurposed.
alter table public.hr_notifications alter column end_date drop not null;
alter table public.hr_notifications alter column days_remaining drop not null;

-- REFRESH API
NOTIFY pgrst, 'reload schema';
