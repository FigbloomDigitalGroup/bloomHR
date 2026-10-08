import { useEffect, useState } from 'react';
import { Cake, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import { chatService } from '../chat/services/chatServices';
import { supabase } from '../../lib/supabase';
import { upcomingBirthdays, type UpcomingItem } from '../../lib/celebrations';

export interface Me {
  id: string;
  email: string;
}

const firstName = (item: UpcomingItem) => item.title.split(' ')[0];

/**
 * Today's birthdays: a "Happy birthday" for the person whose birthday it is, and for everyone else a prompt to send
 * them a wish, which arrives as a direct message in Chat. Used on the staff portal card and the admin dashboard.
 */
export function BirthdayWishes({ birthdays, me }: { birthdays: UpcomingItem[]; me: Me | null }) {
  const [writingTo, setWritingTo] = useState<string | null>(null);
  const [wish, setWish] = useState('');
  const [sending, setSending] = useState(false);
  const [wished, setWished] = useState<Set<string>>(new Set());

  const isMe = (item: UpcomingItem) => !!me && !!item.email && item.email.trim().toLowerCase() === me.email;
  const todays = birthdays.filter((b) => b.daysAway === 0);
  const mine = todays.find(isMe);
  const others = todays.filter((b) => !isMe(b));
  if (!mine && others.length === 0) return null;

  const startWish = (item: UpcomingItem) => {
    setWritingTo(item.email || null);
    setWish(`Happy birthday, ${firstName(item)}! 🎉 Wishing you a wonderful year ahead.`);
  };

  const sendWish = async (item: UpcomingItem) => {
    if (!me || !item.email || !wish.trim() || sending) return;
    setSending(true);
    try {
      const conversation = await chatService.startDirectMessage(item.email);
      await chatService.sendMessage(conversation, me.id, wish.trim());
      setWished((prev) => new Set(prev).add(item.email!));
      setWritingTo(null);
      toast.success(`Sent to ${firstName(item)} in Chat`);
    } catch (err) {
      toast.error((err as Error).message || 'The wish could not be sent');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-2">
      {mine && (
        <div className="rounded-xl bg-brand text-white px-4 py-3 flex items-center gap-3">
          <Cake className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">Happy birthday, {firstName(mine)}! 🎉 Have a wonderful day.</p>
        </div>
      )}

      {others.map((b) => (
        <div key={b.email || b.title} className="rounded-xl border border-brand/30 bg-green-tint px-4 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Cake className="w-5 h-5 text-brand flex-shrink-0" />
            <p className="text-sm text-gray-900 flex-1 min-w-[180px]">
              It's <span className="font-semibold">{b.title}</span>'s birthday today!
            </p>
            {b.email && wished.has(b.email) ? (
              <span className="text-xs font-semibold text-brand">Wish sent ✓</span>
            ) : b.email && writingTo !== b.email ? (
              <button
                type="button"
                onClick={() => startWish(b)}
                className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-dark transition-colors"
              >
                Send wishes
              </button>
            ) : null}
          </div>
          {b.email && writingTo === b.email && (
            <div className="mt-3 space-y-2">
              <textarea
                value={wish}
                onChange={(e) => setWish(e.target.value)}
                rows={2}
                maxLength={500}
                aria-label={`Your birthday message to ${b.title}`}
                className="w-full rounded-lg border border-gray-200 bg-white text-sm text-gray-900 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand/40"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setWritingTo(null)} className="px-3 py-1.5 rounded-lg text-xs font-semibold text-gray-600 hover:bg-gray-100">
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => sendWish(b)}
                  disabled={sending || !wish.trim()}
                  className="px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-semibold hover:bg-brand-dark disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send'}
                </button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/** The birthday prompts on their own (they load today's birthdays themselves), for the admin dashboard. */
export function TodaysBirthdayWishes({ className = '' }: { className?: string }) {
  const [birthdays, setBirthdays] = useState<UpcomingItem[]>([]);
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      supabase.from('employee_directory').select('"First Name", "Last Name", "Date of Birth", "Work Email"'),
      supabase.auth.getSession(),
    ])
      .then(([people, session]) => {
        if (cancelled) return;
        const user = session.data.session?.user;
        if (user) setMe({ id: user.id, email: (user.email || '').toLowerCase() });
        setBirthdays(
          upcomingBirthdays(
            ((people.data || []) as Record<string, string | null>[]).map((p) => ({
              name: `${p['First Name'] || ''} ${p['Last Name'] || ''}`,
              dateOfBirth: p['Date of Birth'],
              email: p['Work Email'],
            })),
            new Date(),
            0
          )
        );
      })
      .catch(() => {
        /* no prompt rather than an error on the dashboard */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (birthdays.length === 0) return null;
  return (
    <div className={className}>
      <BirthdayWishes birthdays={birthdays} me={me} />
    </div>
  );
}
