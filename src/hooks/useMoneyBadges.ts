import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { loadMoneyAwaitingMe, type MoneyAwaitingMe } from '../lib/approvals';

// The counts on the money items of the sidebar: what is waiting on the signed-in person.
//
//   * Salary Advance, Loans, Expenses: requests whose approval step the person may decide now (my_money_approvals,
//     the same list as their staff portal home), so a chain step waiting on someone else is not counted.
//   * Payments to make: approved items still to pay, for finance (the 'payments' module), plus requisitions waiting
//     on the person's approval.
//
// Refreshed when an approval or a payment changes (realtime, where the person may see the rows) and every 2 minutes
// while the tab is visible.

export const MONEY_BADGE_POLL_MS = 2 * 60 * 1000;

export type MoneyBadges = Partial<Record<'advanced' | 'loans' | 'expense' | 'payments', number>>;

/** The badge per sidebar item, from the requests waiting on the person and the payments still to make. */
export const moneyBadgeCounts = (awaiting: Pick<MoneyAwaitingMe, 'kind'>[], toPay: number): MoneyBadges => {
  const of = (kind: string) => awaiting.filter((a) => a.kind === kind).length;
  return { advanced: of('salary_advance'), loans: of('loan'), expense: of('expense'), payments: toPay + of('requisition') };
};

async function countToPay() {
  const { count, error } = await supabase.from('payment_requests').select('id', { count: 'exact', head: true }).eq('status', 'to_pay');
  return error ? 0 : count || 0;
}

export function useMoneyBadges(who: string | undefined, paysOut: boolean): MoneyBadges {
  const [badges, setBadges] = useState<MoneyBadges>({});

  useEffect(() => {
    if (!who) {
      setBadges({});
      return;
    }
    let live = true;
    const refresh = async () => {
      try {
        const [awaiting, toPay] = await Promise.all([loadMoneyAwaitingMe().catch(() => []), paysOut ? countToPay() : Promise.resolve(0)]);
        if (live) setBadges(moneyBadgeCounts(awaiting, toPay));
      } catch (err) {
        console.error('Error counting money waiting on me:', err);
      }
    };
    refresh();

    const channel = supabase
      .channel('sidebar_money_badges')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_requests' }, () => void refresh())
      .subscribe();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, MONEY_BADGE_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      live = false;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      supabase.removeChannel(channel);
    };
  }, [who, paysOut]);

  return badges;
}
