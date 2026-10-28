import { Briefcase, CalendarDays, ClipboardCheck, Clock, HardHat, Smartphone, Target, Users, Wallet, type LucideIcon } from 'lucide-react';
import type { PreviewKey } from '../../lib/landing';

// One icon for each part of the platform, shared by the header's Features list and the showcase's tabs.
export const FEATURE_ICONS: Record<PreviewKey, LucideIcon> = {
  people: Users,
  leave: CalendarDays,
  attendance: Clock,
  payroll: Wallet,
  work: HardHat,
  approvals: ClipboardCheck,
  hiring: Briefcase,
  performance: Target,
  portal: Smartphone,
};
