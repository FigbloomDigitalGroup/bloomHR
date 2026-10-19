import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, PageHeader, TableScroll } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { supportedCountries } from '../../lib/payroll/countries';
import { currencySymbol } from '../../lib/payroll/currency';
import {
  SAMPLE_SALARIES, type RateChange, type RateVersion, lineAmount, periodEnd, previewChange, previewLabels, rateChangeProblems, ratesOn, withVersion,
} from '../../lib/payroll/rateVersions';
import { addPlatformRate, isPlatformAdmin, latestApprovedMonth, longDate, platformRows } from '../../lib/platformRates';
import { isPercentCode, rateLabel } from '../../lib/statutoryRates';

// New platform rates from a date (FIG-813): a Figbloom platform admin enters a change in the law the day it is known,
// as a new dated version of a default rate or band set for a country. Old months keep their rates; companies' own
// rates stay on top. Before saving, the preview shows old vs new net pay, PAYE and each deduction for sample salaries.
// The database checks it again (add_platform_rate) and records who made it. Runbook: docs/FINANCE_BILL_RUNBOOK.md.

const CURRENCY: Record<string, string> = { Kenya: 'KES', Tanzania: 'TZS', Uganda: 'UGX' };

interface BandDraft {
  upto: string;
  value: string;
}

interface Draft {
  code: string;
  value: string;
  bands: BandDraft[] | null;
  /** LST bands hold an annual amount, not a rate */
  amounts: boolean;
  from: string;
  source: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const shown = (code: string, v: number) => (isPercentCode(code) ? `${+(v * 100).toFixed(4)}%` : v.toLocaleString('en-KE'));
const versionText = (r: RateVersion) =>
  r.bands
    ? r.bands
        .map((b) => `${b.upto === null || b.upto === undefined ? 'above' : `to ${Number(b.upto).toLocaleString('en-KE')}`}: ${b.amount !== undefined ? Number(b.amount).toLocaleString('en-KE') : `${+(Number(b.rate) * 100).toFixed(3)}%`}`)
        .join(' · ')
    : r.value === null
      ? '—'
      : shown(r.code, r.value);

/** The draft as a change the database takes (percentages typed as percentages, saved as shares). */
function draftToChange(country: string, d: Draft): RateChange {
  const percent = isPercentCode(d.code);
  return {
    country,
    code: d.code.trim(),
    value: d.bands ? null : d.value.trim() === '' ? NaN : percent ? Number(d.value) / 100 : Number(d.value),
    bands: d.bands
      ? d.bands.map((b, i) => {
          const last = i === (d.bands?.length ?? 0) - 1;
          const upto = last && b.upto.trim() === '' ? null : b.upto.trim() === '' ? NaN : Number(b.upto);
          const v = b.value.trim() === '' ? NaN : Number(b.value);
          return d.amounts ? { upto, amount: v } : { upto, rate: v / 100 };
        })
      : null,
    from: d.from,
    source: d.source,
  };
}

/** A draft starting from the version in force on a day (or empty for a new code). */
function draftFrom(rows: RateVersion[], country: string, code: string, from: string): Draft {
  const current = ratesOn(rows, from, country)[code];
  if (Array.isArray(current)) {
    const bands = current as { upto: number | null; rate?: number; amount?: number }[];
    const amounts = bands.some((b) => b.amount !== undefined);
    return {
      code, from, source: '', value: '', amounts,
      bands: bands.map((b) => ({ upto: b.upto === null ? '' : String(b.upto), value: String(amounts ? b.amount ?? '' : +(Number(b.rate ?? 0) * 100).toFixed(4)) })),
    };
  }
  const v = typeof current === 'number' ? current : null;
  return { code, from, source: '', bands: null, amounts: false, value: v === null ? '' : String(isPercentCode(code) ? +(v * 100).toFixed(4) : v) };
}

export default function PlatformRatesPage() {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [country, setCountry] = useState('Kenya');
  const [rows, setRows] = useState<RateVersion[] | null>(null);
  const [latest, setLatest] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [custom, setCustom] = useState('');
  const [confirmBackdate, setConfirmBackdate] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void isPlatformAdmin().then(setAllowed);
  }, []);

  const load = useCallback(async () => {
    setRows(null);
    try {
      const [r, l] = await Promise.all([platformRows(country), latestApprovedMonth(country)]);
      setRows(r);
      setLatest(l);
    } catch (err) {
      setRows([]);
      toast.error(err instanceof Error ? err.message : 'Could not load the platform rates.');
    }
  }, [country]);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const codes = useMemo(() => [...new Set((rows ?? []).map((r) => r.code))], [rows]);
  const change = useMemo(() => (draft ? draftToChange(country, draft) : null), [draft, country]);
  const problems = useMemo(() => (change ? rateChangeProblems(change, { latestApproved: latest, confirmBackdate }) : []), [change, latest, confirmBackdate]);
  const reachesBack = !!(change && latest && /^\d{4}-\d{2}-\d{2}$/.test(change.from) && change.from <= periodEnd(latest));

  // old vs new for the month the change starts, on the platform defaults
  const preview = useMemo(() => {
    if (!rows || !change || !/^\d{4}-\d{2}-\d{2}$/.test(change.from) || rateChangeProblems(change, { confirmBackdate: true }).length) return null;
    const month = change.from.slice(0, 7);
    const day = periodEnd(month);
    const salaries = [...(SAMPLE_SALARIES[country] ?? []), Number(custom)].filter((s) => Number.isFinite(s) && s > 0);
    try {
      return previewChange(country, salaries, month, ratesOn(rows, day, country), ratesOn(withVersion(rows, change), day, country));
    } catch {
      return null;
    }
  }, [rows, change, country, custom]);

  const save = async () => {
    if (!change || problems.length) return;
    setBusy(true);
    try {
      await addPlatformRate(change, confirmBackdate);
      toast.success(`${rateLabel(change.code, country)} from ${longDate(change.from)} saved for every company in ${country}. Draft payrolls it reaches are flagged for recalculation.`);
      setDraft(null);
      setConfirmBackdate(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The rate was not saved.');
    } finally {
      setBusy(false);
    }
  };

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        <PageHeader title="Platform rates" subtitle="The statutory rates every company starts from" />
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can change the platform rates.</p>
          <p className="text-xs text-muted-foreground mt-1">
            A company changes its own rates on the payroll page&apos;s Rates tab. How a platform admin is added: docs/FINANCE_BILL_RUNBOOK.md.
          </p>
        </Card>
      </div>
    );
  }

  const sym = currencySymbol(CURRENCY[country] ?? 'KES');
  const money = (n: number) => `${sym} ${n.toLocaleString('en-KE', { maximumFractionDigits: 2 })}`;
  const diff = (a: number, b: number) => (Math.abs(b - a) < 0.005 ? money(b) : `${money(a)} → ${money(b)}`);
  const labels = preview ? previewLabels(preview) : [];
  const employerLabels = preview ? previewLabels(preview, 'employerCosts') : [];
  const setBand = (i: number, part: Partial<BandDraft>) =>
    draft?.bands && setDraft({ ...draft, bands: draft.bands.map((b, j) => (j === i ? { ...b, ...part } : b)) });

  return (
    <div className="space-y-4">
      <PageHeader title="Platform rates" subtitle="New statutory rates from a date, for every company (companies' own rates stay on top)" />

      <div className="flex gap-1" role="tablist" aria-label="Country">
        {supportedCountries().map((c) => (
          <button key={c} type="button" role="tab" aria-selected={country === c}
            onClick={() => { setCountry(c); setDraft(null); setConfirmBackdate(false); }}
            className={`px-3 py-1.5 rounded-tile border text-[11.5px] font-semibold ${country === c ? 'border-brand bg-brand/10 text-brand' : 'border-border bg-white text-ink hover:bg-secondary'}`}>
            {c}
          </button>
        ))}
      </div>

      <Card>
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="text-sm font-semibold text-ink">{country}: every version</h2>
          {latest && <p className="text-xs text-muted-foreground">Latest month approved by a company: {latest}</p>}
        </div>
        {!rows ? (
          <FigbloomLoader label="Loading rates" size={48} />
        ) : (
          <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Rate</th>
                  <th className="py-1 pr-3 font-medium">Value</th>
                  <th className="py-1 pr-3 font-medium">From</th>
                  <th className="py-1 pr-3 font-medium">To</th>
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.code}-${r.effective_from}`} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 text-ink">{rateLabel(r.code, country)}</td>
                    <td className="py-1.5 pr-3 text-ink">{versionText(r)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.effective_from}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.effective_to ?? 'in force'}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.source ?? ''}</td>
                    <td className="py-1.5 text-right">
                      {r.effective_to === null && (
                        <button type="button" className="text-brand font-semibold" onClick={() => { setConfirmBackdate(false); setDraft(draftFrom(rows, country, r.code, today())); }}>
                          New version
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
        <button type="button" className="mt-3 text-xs text-brand font-semibold" onClick={() => setDraft({ code: '', value: '', bands: null, amounts: false, from: today(), source: '' })}>
          A rate {country} doesn&apos;t have yet
        </button>
      </Card>

      {draft && (
        <Card>
          <h2 className="text-sm font-semibold text-ink mb-2">
            New version{draft.code ? `: ${rateLabel(draft.code, country)}` : ''} ({country})
          </h2>
          <div className="flex flex-wrap gap-3">
            <label className="text-xs text-ink">
              Rate code
              <input list="platform-rate-codes" value={draft.code} onChange={(e) => setDraft(rows ? { ...draftFrom(rows, country, e.target.value.trim(), draft.from), source: draft.source } : draft)}
                placeholder="e.g. shif_rate" className="block mt-1 w-48 rounded-lg border border-border px-2 py-1 text-sm" />
              <datalist id="platform-rate-codes">{codes.map((c) => <option key={c} value={c}>{rateLabel(c, country)}</option>)}</datalist>
            </label>
            <label className="text-xs text-ink">
              From
              <input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className="block mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
            {!draft.bands && (
              <label className="text-xs text-ink">
                {isPercentCode(draft.code) ? 'Rate (%)' : 'Value'}
                <input type="number" step="any" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} className="block mt-1 w-36 rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
            )}
            <label className="text-xs text-ink flex-1 min-w-[220px]">
              Source (the Act, notice or circular)
              <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} placeholder="e.g. Finance Act 2027, s.12"
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
          </div>

          {draft.bands && (
            <div className="mt-3">
              <table className="text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-3 font-medium">Up to (monthly)</th>
                    <th className="pr-3 font-medium">{draft.amounts ? 'Amount a year' : 'Rate (%)'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {draft.bands.map((b, i) => (
                    <tr key={i}>
                      <td className="pr-3 py-0.5">
                        <input type="number" step="any" aria-label={`Band ${i + 1} up to`} value={b.upto} placeholder={i === (draft.bands?.length ?? 0) - 1 ? 'everything above' : ''}
                          onChange={(e) => setBand(i, { upto: e.target.value })} className="w-36 rounded-lg border border-border px-2 py-1 text-sm" />
                      </td>
                      <td className="pr-3 py-0.5">
                        <input type="number" step="any" aria-label={`Band ${i + 1} ${draft.amounts ? 'amount' : 'rate'}`} value={b.value}
                          onChange={(e) => setBand(i, { value: e.target.value })} className="w-28 rounded-lg border border-border px-2 py-1 text-sm" />
                      </td>
                      <td>
                        {(draft.bands?.length ?? 0) > 1 && (
                          <button type="button" className="text-muted-foreground" onClick={() => setDraft({ ...draft, bands: (draft.bands ?? []).filter((_, j) => j !== i) })}>Remove</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="text-xs text-brand font-semibold"
                onClick={() => setDraft({ ...draft, bands: [...(draft.bands ?? []).slice(0, -1), { upto: '', value: '' }, ...(draft.bands ?? []).slice(-1)] })}>
                Add a band
              </button>
            </div>
          )}
          {!draft.bands && !codes.includes(draft.code) && draft.code && (
            <button type="button" className="mt-2 text-xs text-brand font-semibold" onClick={() => setDraft({ ...draft, bands: [{ upto: '', value: '' }], value: '' })}>
              It is a band set
            </button>
          )}

          {reachesBack && (
            <label className="mt-3 flex items-start gap-2 text-xs text-ink">
              <input type="checkbox" checked={confirmBackdate} onChange={(e) => setConfirmBackdate(e.target.checked)} className="mt-0.5" />
              <span>
                Payroll for {latest} is already approved by at least one company. I confirm this rate reaches back into approved months: their payslips
                stay as approved (they need amended returns), and draft months are flagged for recalculation.
              </span>
            </label>
          )}

          {problems.length > 0 && (
            <ul className="mt-3 list-disc pl-5 text-xs text-status-danger" aria-label="Problems">
              {problems.map((p) => <li key={p}>{p}</li>)}
            </ul>
          )}

          <div className="mt-4">
            <div className="flex items-center justify-between gap-3 mb-1">
              <h3 className="text-xs font-semibold text-ink">Preview: {change && /^\d{4}-\d{2}/.test(change.from) ? change.from.slice(0, 7) : 'the month it starts'}, old → new</h3>
              <label className="text-xs text-ink">
                Another salary
                <input type="number" min={0} step="any" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Another salary"
                  className="ml-2 w-32 rounded-lg border border-border px-2 py-1 text-sm" />
              </label>
            </div>
            {!preview ? (
              <p className="text-xs text-muted-foreground">Fix the problems above to see the preview.</p>
            ) : (
              <TableScroll>
                <table className="w-full text-xs" aria-label="Preview">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Basic salary</th>
                      <th className="py-1 pr-3 font-medium">Net pay</th>
                      {labels.map((l) => <th key={l} className="py-1 pr-3 font-medium">{l}</th>)}
                      {employerLabels.map((l) => <th key={`e-${l}`} className="py-1 pr-3 font-medium">{l}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((p) => (
                      <tr key={p.salary} className="border-t border-border/60">
                        <td className="py-1.5 pr-3 text-ink">{money(p.salary)}</td>
                        <td className="py-1.5 pr-3 text-ink font-semibold">{diff(p.before.net, p.after.net)}</td>
                        {labels.map((l) => <td key={l} className="py-1.5 pr-3 text-ink">{diff(lineAmount(p.before.deductions, l), lineAmount(p.after.deductions, l))}</td>)}
                        {employerLabels.map((l) => (
                          <td key={`e-${l}`} className="py-1.5 pr-3 text-muted-foreground">{diff(lineAmount(p.before.employerCosts, l), lineAmount(p.after.employerCosts, l))}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">
              A full-time employee on basic salary only, with every tax and statutory number, on the platform defaults. A company with its own rate for this code keeps it.
            </p>
          </div>

          <div className="mt-4 flex gap-2">
            <button type="button" disabled={busy || problems.length > 0} onClick={() => void save()}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
              {busy ? 'Saving…' : `Save for every company in ${country}`}
            </button>
            <button type="button" className="text-xs text-muted-foreground" onClick={() => setDraft(null)}>Cancel</button>
          </div>
        </Card>
      )}
    </div>
  );
}
