import { useEffect, useState } from 'react';
import { Bell, Info, Minus, UserCheck } from 'lucide-react';
import { Card } from '../UI';
import {
  MyApprovalChain as Chain,
  alsoToldSentence,
  chainSentence,
  loadMyApprovalChain,
  skipText,
  stepText,
} from '../../lib/staffCompany';

/**
 * Who the signed-in employee's leave goes to, before they apply: "Your leave goes to Max Manager (line manager),
 * then HR." Worked out by the database from the company's approval workflow (my_approval_chain), the same way a real
 * application would be routed. `compact` is the one-line note under the dates on the leave form; otherwise the full
 * card in Company > Who approves my leave.
 */
export default function MyApprovalChain({ compact = false }: { compact?: boolean }) {
  const [chain, setChain] = useState<Chain | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadMyApprovalChain('leave')
      .then((c) => !cancelled && setChain(c))
      .catch((e) => {
        console.error('Could not load your approval chain:', e);
        if (!cancelled) setFailed(true);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (compact) {
    if (loading || failed || !chain || !chain.steps.length) return null;
    const also = alsoToldSentence(chain);
    return (
      <div data-testid="leave-approval-chain" className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <UserCheck className="w-4 h-4 mt-0.5 shrink-0 text-brand" />
        <p className="m-0 text-xs text-gray-700">
          {chainSentence(chain)}
          {also && <span className="text-gray-500"> {also}</span>}
        </p>
      </div>
    );
  }

  return (
    <Card>
      <h2 className="m-0 text-[15px] font-bold text-ink">Who approves my leave</h2>
      <p className="m-0 mt-1 text-[12px] text-muted-foreground">
        Where a leave application from you goes, in order, under your company’s approval workflow today.
      </p>

      {loading ? (
        <div className="mt-4 space-y-2" aria-label="Loading">
          {[0, 1].map((i) => <div key={i} className="h-10 rounded-lg bg-secondary animate-pulse" />)}
        </div>
      ) : failed || !chain ? (
        <p className="m-0 mt-4 text-[12.5px] text-status-danger" role="alert">Could not load who approves your leave. Try again later.</p>
      ) : (
        <>
          {!chain.has_employee_record && (
            <p className="m-0 mt-4 text-[12px] text-orange-text-alt">
              Your account isn’t linked to an employee record yet, so this is the company’s general chain. Ask HR to link it.
            </p>
          )}
          <p className="m-0 mt-4 text-[13px] font-semibold text-ink">{chainSentence(chain)}</p>
          <ol className="m-0 mt-3 p-0 list-none space-y-2.5">
            {chain.steps.map((s, i) => (
              <li key={`${s.position}-${s.label}`} className="flex items-start gap-2.5">
                <span className="mt-0.5 w-6 h-6 shrink-0 rounded-full bg-green-tint text-brand text-[11px] font-bold flex items-center justify-center">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <p className="m-0 text-[12.5px] font-semibold text-ink break-words">{stepText(s)}</p>
                  <p className="m-0 text-[11.5px] text-muted-foreground">
                    {i === 0 ? 'Decides first' : 'Decides once the step before has approved'}
                  </p>
                </div>
              </li>
            ))}
          </ol>

          {chain.admin_fallback && (
            <p className="m-0 mt-3 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              Nobody in your company’s workflow can decide it for you, so an admin does.
            </p>
          )}

          {chain.skipped.length > 0 && (
            <ul className="m-0 mt-3 p-0 list-none space-y-1">
              {chain.skipped.map((s) => (
                <li key={`skip-${s.position}`} className="flex items-start gap-1.5 text-[11.5px] text-subtle">
                  <Minus className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  {skipText(s)}
                </li>
              ))}
            </ul>
          )}

          {chain.also_told.length > 0 && (
            <p className="m-0 mt-3 flex items-start gap-1.5 text-[11.5px] text-muted-foreground">
              <Bell className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              {alsoToldSentence(chain)}
            </p>
          )}

          <p className="m-0 mt-4 text-[11px] text-subtle">
            Each application keeps the chain it started with, even if HR changes the workflow later. Track yours in Leave History.
          </p>
        </>
      )}
    </Card>
  );
}
