import { useEffect, useRef, useState } from 'react';
import { Loader, Scale, Sparkles } from 'lucide-react';
import {
  TAX_DISCLAIMER,
  explainRule,
  findTaxRule,
  treatmentLabel,
  type PayItemKind,
  type TaxTreatment,
} from '../../lib/kenyaTaxTreatment';
import type { Rates } from '../../lib/statutoryCalc';
import { askTaxTreatment, type AITaxSuggestion } from '../../services/ai';

/**
 * How a pay item is treated for Kenyan PAYE, shown while its name is typed: the app's own cited rule straight away
 * when one matches (src/lib/kenyaTaxTreatment.ts), or, only when the user clicks "Ask AI", the AI's suggestion,
 * labelled as one. It never applies anything itself: with onUse, a "Use this" button hands the treatment to the form.
 *
 * Works for any pay item form: <TaxTreatmentHint kind="earning" name={form.name} onUse={...} />
 */
export interface TaxTreatmentHintProps {
  kind: PayItemKind;
  /** the item's name as typed */
  name: string;
  /** optional extra detail, sent to the AI with the name */
  description?: string;
  /** the statutory rates in force, to show caps in KSh (without them the hint says "the monthly limit") */
  rates?: Rates | null;
  /** when the form has a tax-treatment field: fills it after the user presses "Use this" */
  onUse?: (treatment: TaxTreatment) => void;
  /** wait this long after the last keystroke before looking the name up */
  debounceMs?: number;
}

const BADGE: Record<TaxTreatment, string> = {
  taxable: 'bg-orange-tint text-orange-text',
  not_taxable: 'bg-secondary text-ink',
  reduces_taxable_pay: 'bg-green-tint text-status-success',
  relief: 'bg-status-info-tint text-status-info',
  depends: 'bg-status-purple-tint text-status-purple',
};

const smallButton =
  'inline-flex items-center gap-1 px-2 py-1 rounded-tile border border-border bg-white text-[11px] font-semibold text-ink hover:bg-secondary disabled:opacity-50';

function Badge({ treatment, kind }: { treatment: TaxTreatment; kind: PayItemKind }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded-pill text-[10.5px] font-bold ${BADGE[treatment]}`} data-testid="tax-badge">
      {treatmentLabel(treatment, kind)}
    </span>
  );
}

export default function TaxTreatmentHint({ kind, name, description, rates, onUse, debounceMs = 300 }: TaxTreatmentHintProps) {
  const [settled, setSettled] = useState(name.trim());
  const [ai, setAi] = useState<{ state: 'idle' } | { state: 'asking' } | { state: 'done'; answer: AITaxSuggestion } | { state: 'error'; message: string }>({
    state: 'idle',
  });
  // a newer name makes an older AI answer stale
  const request = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(name.trim()), debounceMs);
    return () => clearTimeout(timer);
  }, [name, debounceMs]);

  useEffect(() => {
    request.current += 1;
    setAi({ state: 'idle' });
  }, [settled, kind]);

  if (settled.length < 2) return null;
  const rule = findTaxRule(settled, kind);

  const askAi = async () => {
    const id = ++request.current;
    setAi({ state: 'asking' });
    try {
      const answer = await askTaxTreatment(kind, settled, description?.trim() || undefined);
      if (id === request.current) setAi({ state: 'done', answer });
    } catch (err) {
      if (id === request.current) setAi({ state: 'error', message: err instanceof Error ? err.message : 'The AI could not answer.' });
    }
  };

  const applyButton = (treatment: TaxTreatment) =>
    onUse && (
      <button type="button" className={smallButton} onClick={() => onUse(treatment)}>
        Use this
      </button>
    );

  const disclaimer = <p className="text-[10px] text-subtle">{TAX_DISCLAIMER}</p>;

  if (rule) {
    return (
      <div className="rounded-tile border border-border bg-white p-2.5 space-y-1.5 text-[11px] text-ink" aria-live="polite" data-testid="tax-hint">
        <div className="flex flex-wrap items-center gap-2">
          <Scale className="w-3.5 h-3.5 text-subtle" aria-hidden />
          <span className="font-semibold">{rule.title}</span>
          <Badge treatment={rule.treatment} kind={kind} />
          <span className="flex-1" />
          {applyButton(rule.treatment)}
        </div>
        <p>{explainRule(rule, rates)}</p>
        {kind === 'deduction' && rule.inThisApp && <p className="text-muted-foreground">{rule.inThisApp}</p>}
        {rule.caveats.length > 0 && (
          <ul className="list-disc pl-4 text-muted-foreground">
            {rule.caveats.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        )}
        <p className="text-[10px] text-subtle">Legal basis: {rule.legalBasis}</p>
        {disclaimer}
      </div>
    );
  }

  return (
    <div className="rounded-tile border border-dashed border-border bg-white p-2.5 space-y-1.5 text-[11px] text-ink" aria-live="polite" data-testid="tax-hint">
      {ai.state !== 'done' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">No built-in tax rule for “{settled}”.</span>
          <button type="button" className={smallButton} onClick={askAi} disabled={ai.state === 'asking'}>
            {ai.state === 'asking' ? <Loader className="w-3 h-3 animate-spin" aria-hidden /> : <Sparkles className="w-3 h-3" aria-hidden />}
            {ai.state === 'asking' ? 'Asking…' : 'Ask AI'}
          </button>
        </div>
      )}
      {ai.state === 'error' && <p className="text-status-danger">{ai.message}</p>}
      {ai.state === 'done' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Sparkles className="w-3.5 h-3.5 text-status-purple" aria-hidden />
            <span className="font-semibold">AI suggestion</span>
            <Badge treatment={ai.answer.treatment} kind={kind} />
            <span className="text-[10px] text-subtle">{ai.answer.confidence} confidence</span>
            <span className="flex-1" />
            {applyButton(ai.answer.treatment)}
          </div>
          <p>{ai.answer.explanation}</p>
          {ai.answer.caveats.length > 0 && (
            <ul className="list-disc pl-4 text-muted-foreground">
              {ai.answer.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
          <p className="text-[10px] text-subtle">Legal basis (as the AI gave it): {ai.answer.legal_basis}</p>
          <p className="text-[10px] text-subtle">Written by AI and may be wrong. Check it before relying on it.</p>
          {disclaimer}
        </>
      )}
    </div>
  );
}
