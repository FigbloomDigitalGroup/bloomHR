import { supabase } from './supabase';

// Video call rooms (VideoConf). The meeting code people see and type ("quick-red-team-12", or their own) is only a
// label: the Jitsi room it opens is a hash of the code AND the company's own random secret (company_meeting_secret(),
// migration 20261022400000). So the same code opens a different room in every company, and nobody outside the
// company can work out a room's name from the code or the date. Transcripts keep the code people see
// (meeting_transcripts.meeting_code, per company), so the recruitment "Link VideoConf meeting" flow still finds them.

/** The suggested code changes every this many days. */
export const MEETING_PERIOD_DAYS = 5;
const START = Date.UTC(2024, 0, 1);
const DAY = 1000 * 60 * 60 * 24;

const daysSinceStart = (now: Date) => Math.floor((now.getTime() - START) / DAY);

/** Which 5-day period a date falls in. */
export const meetingPeriod = (now: Date = new Date()) => Math.floor(daysSinceStart(now) / MEETING_PERIOD_DAYS);

/** Days until the suggested code changes (1..5). */
export const daysUntilNextCode = (now: Date = new Date()) =>
  MEETING_PERIOD_DAYS - (((daysSinceStart(now) % MEETING_PERIOD_DAYS) + MEETING_PERIOD_DAYS) % MEETING_PERIOD_DAYS);

const ADJECTIVES = ['quick', 'bright', 'clear', 'happy', 'smart', 'brave', 'calm', 'eager', 'gentle', 'jolly', 'kind', 'lively', 'nice', 'proud', 'silly', 'witty'];
const NOUNS = ['team', 'meeting', 'session', 'call', 'huddle', 'chat', 'talk', 'brief', 'review', 'sync', 'standup', 'planning', 'brainstorm', 'workshop'];
const COLORS = ['red', 'blue', 'green', 'gold', 'silver', 'navy', 'teal', 'ruby', 'pearl', 'amber', 'ivory', 'ebony'];

/**
 * This period's company meeting code: an easy label to say out loud. The same label in every company, on purpose: it
 * is not the room (see companyRoomName), so it gives nothing away.
 */
export function periodMeetingCode(now: Date = new Date()): string {
  const p = meetingPeriod(now);
  return `${ADJECTIVES[(p * 3) % ADJECTIVES.length]}-${COLORS[(p * 11) % COLORS.length]}-${NOUNS[(p * 7) % NOUNS.length]}-${(p % 99)
    .toString()
    .padStart(2, '0')}`;
}

/** How a typed code is compared: case and spaces do not matter ("Weekly Sync" is "weeklysync"). */
export const normalizeMeetingCode = (code: string) => code.trim().toLowerCase().replace(/\s+/g, '');

/**
 * The Jitsi room for a meeting code in a company: "bloomhr-" and 32 hex characters of SHA-256(secret, code). Without
 * the secret the room cannot be found; with another company's secret it is another room.
 */
export async function companyRoomName(secret: string, code: string): Promise<string> {
  if (!secret) throw new Error('No company meeting secret');
  const normalized = normalizeMeetingCode(code);
  if (!normalized) throw new Error('No meeting code');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${secret}:${normalized}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `bloomhr-${hex.slice(0, 32)}`;
}

/** The signed-in person's company secret (made on first use). Throws when there is none: never fall back to a public room. */
export async function fetchCompanyMeetingSecret(): Promise<string> {
  const { data, error } = await supabase.rpc('company_meeting_secret');
  if (error) throw error;
  if (typeof data !== 'string' || data.length < 32) throw new Error('No company meeting secret');
  return data;
}
