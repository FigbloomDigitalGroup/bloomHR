import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { lastDayOf } from '../../lib/payrollExports';
import { type RateBand, type RateRow, isPercentCode, rateLabel, ratesInForce, setCompanyBands, setCompanyRate } from '../../lib/statutoryRates';
import FigbloomLoader from '../UI/FigbloomLoader';
import TableScroll from '../UI/TableScroll';

// The statutory rates payroll uses for a month (statutory_rates), and where each comes from. Payroll can give the
// company its own rate for a code from a date; the defaults change only with the law (by migration).

const formatValue = (r: RateRow) => {
  if (r.bands) {
    return r.bands
      .map((b, i) => `${b.upto === null ? `above ${r.bands?.[i - 1]?.upto?.toLocaleString() ?? 0}` : `to ${b.upto.toLocaleString()}`}: ${b.amount !== undefined ? Number(b.amount).toLocaleString() : `${(Number(b.rate ?? 0) * 100).toFixed(1)}%`}`)
      .join(' · ');
  }
  const v = Number(r.value);
  return isPercentCode(r.code) ? `${+(v * 100).toFixed(3)}%` : v.toLocaleString();
};

const DESCRIPTIONS: Record<string, string> = {
  Kenya: 'What payroll uses for PAYE, SHIF, NSSF and the housing levy this month, and from when.',
  Tanzania: 'What payroll uses for PAYE, NSSF, HESLB, SDL and WCF this month, and from when.',
  Uganda: 'What payroll uses for PAYE, NSSF and the local service tax this month, and from when.',
};

/** A band being edited: "up to" and the rate (as a percentage) or annual amount, as typed. */
interface BandDraft {
  upto: string;
  value: string;
}

const bandsToDraft = (bands: RateBand[]): BandDraft[] =>
  bands.map((b) => ({ upto: b.upto === null ? '' : String(b.upto), value: b.amount !== undefined ? String(b.amount) : String(+(Number(b.rate ?? 0) * 100).toFixed(4)) }));

export default function StatutoryRatesModal({ payPeriod, onClose, onChanged, country = 'Kenya' }: { payPeriod: string; onClose: () => void; onChanged: () => void; country?: string }) {
  const [rows, setRows] = useState<RateRow[] | null>(null);
  const [editing, setEditing] = useState<{ code: string; value: string; from: string; source: string } | null>(null);
  // bands being edited (PAYE bands, Uganda's LST bands); amounts: LST bands hold an annual amount, not a rate
  const [editingBands, setEditingBands] = useState<{ code: string; amounts: boolean; bands: BandDraft[]; from: string; source: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows(await ratesInForce(lastDayOf(payPeriod), country));
    } catch (err) {
      setRows([]);
      toast.error(err instanceof Error ? err.message : 'Could not load the statutory rates.');
    }
  }, [payPeriod, country]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      // percentages are typed as percentages and saved as fractions
      const typed = Number(editing.value);
      const value = isPercentCode(editing.code) ? typed / 100 : typed;
      await setCompanyRate(editing.code, value, editing.from, editing.source, country);
      toast.success('Rate saved. Recalculate draft months it affects.');
      setEditing(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The rate was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const saveBands = async () => {
    if (!editingBands) return;
    setBusy(true);
    try {
      const bands: RateBand[] = editingBands.bands.map((b, i) => {
        const upto = i === editingBands.bands.length - 1 && b.upto.trim() === '' ? null : Number(b.upto);
        const v = Number(b.value);
        return editingBands.amounts ? { upto, amount: v } : { upto, rate: v / 100 };
      });
      await setCompanyBands(editingBands.code, bands, editingBands.from, editingBands.source, country);
      toast.success('Bands saved. Recalculate draft months they affect.');
      setEditingBands(null);
      await load();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The bands were not saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto" role="dialog" aria-label="Statutory rates">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">{country} statutory rates for {payPeriod}</h2>
            <p className="text-xs text-muted-foreground">
              {DESCRIPTIONS[country] ?? DESCRIPTIONS.Kenya}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          {!rows && <FigbloomLoader label="Loading rates" size={48} />}
          {rows && (
            <TableScroll>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">Rate</th>
                  <th className="py-1 pr-3 font-medium">Value</th>
                  <th className="py-1 pr-3 font-medium">From</th>
                  <th className="py-1 pr-3 font-medium">Source</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border/60 align-top">
                    <td className="py-1.5 pr-3 text-ink">{rateLabel(r.code, country)}</td>
                    <td className="py-1.5 pr-3 text-ink">{formatValue(r)}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.effective_from}{r.effective_to ? ` to ${r.effective_to}` : ''}</td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.tenant_id ? 'Your company' : r.source ?? 'Default'}</td>
                    <td className="py-1.5 text-right">
                      {!r.bands && (
                        <button type="button" className="text-brand font-semibold"
                          onClick={() => { setEditingBands(null); setEditing({ code: r.code, value: String(isPercentCode(r.code) ? +(Number(r.value) * 100).toFixed(4) : r.value), from: `${payPeriod}-01`, source: '' }); }}>
                          Change
                        </button>
                      )}
                      {r.bands && (
                        <button type="button" className="text-brand font-semibold"
                          onClick={() => {
                            setEditing(null);
                            setEditingBands({ code: r.code, amounts: (r.bands ?? []).some((b) => b.amount !== undefined), bands: bandsToDraft(r.bands ?? []), from: `${payPeriod}-01`, source: '' });
                          }}>
                          Change
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </TableScroll>
          )}

          {editing && (
            <div className="mt-4 rounded-lg border border-border p-3 space-y-2">
              <p className="text-sm font-medium text-ink">{rateLabel(editing.code, country)} for your company</p>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs text-ink">
                  {isPercentCode(editing.code) ? 'Rate (%)' : 'Amount'}
                  <input type="number" min={0} step="any" value={editing.value} onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    className="block mt-1 w-36 rounded-lg border border-border px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-ink">
                  From
                  <input type="date" value={editing.from} onChange={(e) => setEditing({ ...editing, from: e.target.value })}
                    className="block mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-ink flex-1 min-w-[180px]">
                  Why (law or notice)
                  <input value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} placeholder="e.g. Finance Act 2027"
                    className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy || editing.value === ''} onClick={() => void save()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setEditing(null)} className="text-xs text-muted-foreground">Cancel</button>
              </div>
              <p className="text-xs text-muted-foreground">Applies from that date until changed again. Approved months keep their payslips; recalculate draft months.</p>
            </div>
          )}
          {editingBands && (
            <div className="mt-4 rounded-lg border border-border p-3 space-y-2">
              <p className="text-sm font-medium text-ink">{rateLabel(editingBands.code, country)} for your company</p>
              <table className="text-xs">
                <thead>
                  <tr className="text-left text-muted-foreground">
                    <th className="pr-3 font-medium">Up to (monthly)</th>
                    <th className="pr-3 font-medium">{editingBands.amounts ? 'Amount a year' : 'Rate (%)'}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {editingBands.bands.map((b, i) => (
                    <tr key={i}>
                      <td className="pr-3 py-0.5">
                        <input type="number" min={0} step="any" aria-label={`Band ${i + 1} up to`} value={b.upto}
                          placeholder={i === editingBands.bands.length - 1 ? 'everything above' : ''}
                          onChange={(e) => setEditingBands({ ...editingBands, bands: editingBands.bands.map((x, j) => (j === i ? { ...x, upto: e.target.value } : x)) })}
                          className="w-36 rounded-lg border border-border px-2 py-1 text-sm" />
                      </td>
                      <td className="pr-3 py-0.5">
                        <input type="number" min={0} step="any" aria-label={`Band ${i + 1} ${editingBands.amounts ? 'amount' : 'rate'}`} value={b.value}
                          onChange={(e) => setEditingBands({ ...editingBands, bands: editingBands.bands.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}
                          className="w-28 rounded-lg border border-border px-2 py-1 text-sm" />
                      </td>
                      <td>
                        {editingBands.bands.length > 1 && (
                          <button type="button" className="text-muted-foreground" onClick={() => setEditingBands({ ...editingBands, bands: editingBands.bands.filter((_, j) => j !== i) })}>
                            Remove
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <button type="button" className="text-xs text-brand font-semibold"
                onClick={() => setEditingBands({ ...editingBands, bands: [...editingBands.bands.slice(0, -1), { upto: '', value: '' }, ...editingBands.bands.slice(-1)] })}>
                Add a band
              </button>
              <div className="flex flex-wrap gap-3">
                <label className="text-xs text-ink">
                  From
                  <input type="date" value={editingBands.from} onChange={(e) => setEditingBands({ ...editingBands, from: e.target.value })}
                    className="block mt-1 rounded-lg border border-border px-2 py-1 text-sm" />
                </label>
                <label className="text-xs text-ink flex-1 min-w-[180px]">
                  Why (law or notice)
                  <input value={editingBands.source} onChange={(e) => setEditingBands({ ...editingBands, source: e.target.value })} placeholder="e.g. Finance Act 2027"
                    className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
                </label>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={busy} onClick={() => void saveBands()}
                  className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">{busy ? 'Saving…' : 'Save'}</button>
                <button type="button" onClick={() => setEditingBands(null)} className="text-xs text-muted-foreground">Cancel</button>
              </div>
              <p className="text-xs text-muted-foreground">Leave the last band&apos;s &quot;up to&quot; empty: it is for everything above. Applies from that date until changed again.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
