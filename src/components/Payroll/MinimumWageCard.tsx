import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Scale, Trash2 } from 'lucide-react';
import { Button, Card } from '../UI';
import { confirmDialog } from '../../lib/confirmDialog';
import {
  COUNTRIES, DEFAULT_SETTINGS, currencyFor, historyByCountry, money, perDayMinimum, type MinimumWage, type MinimumWageSettings,
} from '../../lib/minimumWage';
import { addMinimumWage, deleteMinimumWage, loadCompanyMinimum, loadMinimumWages, saveMinimumWageSettings } from '../../lib/minimumWageApi';
import { LoaderBlock } from '../UI/FigbloomLoader';

// Payroll > Rates: the minimum wage (FIG-812 stage 6). One monthly amount per country, entered by the company with the
// date it takes effect; a new amount is added with a later date, so the history stays. Figbloom fills in no amounts.
// The check (on by default) warns on the Run tab, the Casual workers page and Piece rate > Workers; it never blocks.

const field = 'w-full px-2.5 py-1.5 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand';
const today = () => new Date().toISOString().slice(0, 10);

export default function MinimumWageCard({ canEdit }: { canEdit: boolean }) {
  const [rows, setRows] = useState<MinimumWage[] | null>(null);
  const [settings, setSettings] = useState<MinimumWageSettings>(DEFAULT_SETTINGS);
  const [companyCountry, setCompanyCountry] = useState('Kenya');
  const [country, setCountry] = useState('Kenya');
  const [amount, setAmount] = useState('');
  const [from, setFrom] = useState(today());
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, company] = await Promise.all([loadMinimumWages(), loadCompanyMinimum()]);
      setRows(list);
      setSettings({ enabled: company.enabled, daysPerMonth: company.daysPerMonth });
      setCompanyCountry(company.minimum.country);
    } catch (err) {
      setRows([]);
      toast.error((err as Error).message || 'Could not load the minimum wage.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setCountry(companyCountry);
  }, [companyCountry]);

  const saveSettings = async (patch: Partial<MinimumWageSettings>, done: string) => {
    const before = settings;
    setSettings({ ...settings, ...patch });
    try {
      await saveMinimumWageSettings(patch);
      toast.success(done);
    } catch (err) {
      setSettings(before);
      toast.error((err as Error).message || 'Could not save the setting.');
    }
  };

  const saveDays = (value: string) => {
    const days = Number(value);
    if (!Number.isInteger(days) || days < 1 || days > 31 || days === settings.daysPerMonth) return;
    void saveSettings({ daysPerMonth: days }, `The per-day minimum is now the monthly amount / ${days}`);
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const value = Number(amount.replace(/,/g, ''));
    if (!country.trim()) return setProblem('Choose a country.');
    if (!(value > 0)) return setProblem('Enter the monthly amount.');
    if (!from) return setProblem('Choose the date it takes effect.');
    setBusy(true);
    try {
      await addMinimumWage({ country, monthly_amount: value, effective_from: from, notes });
      toast.success(`${country.trim()}: ${money(value, currencyFor(country))} a month from ${from}`);
      setAmount('');
      setNotes('');
      await load();
    } catch (err) {
      setProblem((err as Error).message || 'Could not save the amount.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (r: MinimumWage) => {
    if (!(await confirmDialog({ title: `Remove ${r.country}'s amount from ${r.effective_from}?`, confirmLabel: 'Remove', tone: 'danger' }))) return;
    try {
      await deleteMinimumWage(r.id);
      await load();
    } catch (err) {
      toast.error((err as Error).message || 'Could not remove it.');
    }
  };

  const groups = historyByCountry(rows ?? []);
  const todayIso = today();

  return (
    <Card padding="sm" data-testid="minimum-wage-card">
      <div className="flex items-start gap-2 text-xs text-ink">
        <Scale className="w-4 h-4 mt-0.5 text-brand shrink-0" />
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <h3 className="m-0 text-sm font-bold text-ink">Minimum wage</h3>
            <p className="m-0 text-[11.5px] text-muted-foreground">
              One monthly amount per country. Payroll warns before you approve a month when someone is paid below it; it never
              stops a payroll. Enter the general monthly minimum from your country&apos;s latest wage order (Figbloom doesn&apos;t
              fill in amounts). For now everyone&apos;s country is the company&apos;s ({companyCountry}).
            </p>
          </div>

          <label className={`flex items-start gap-2 ${canEdit ? 'cursor-pointer' : 'opacity-80'}`}>
            <input type="checkbox" className="mt-0.5" checked={settings.enabled} disabled={!canEdit || rows === null}
              aria-label="Warn when pay is below the minimum wage"
              onChange={(e) => void saveSettings({ enabled: e.target.checked },
                e.target.checked ? 'Payroll will warn about pay below the minimum wage' : 'The minimum wage check is off')} />
            <span>
              <strong>Warn when pay is below the minimum wage</strong> (default). Only warns once an amount is set for the country.
            </span>
          </label>
          <label className="flex flex-wrap items-center gap-2">
            <span><strong>Working days in a month:</strong></span>
            <input key={settings.daysPerMonth} type="number" min={1} max={31} inputMode="numeric" disabled={!canEdit}
              aria-label="Working days in a month" defaultValue={settings.daysPerMonth}
              className="w-16 rounded-lg border border-border px-2 py-1 text-right" onBlur={(e) => saveDays(e.target.value)} />
            <span className="text-muted-foreground">
              For people paid by the day or by work: the monthly amount / {settings.daysPerMonth} x the days they worked.
            </span>
          </label>

          {rows === null ? (
            <LoaderBlock label="Loading" compact />
          ) : groups.length === 0 ? (
            <p className="m-0 rounded-tile bg-background px-3 py-2 text-muted-foreground" data-testid="minimum-wage-empty">
              No minimum wage set yet, so nothing is checked. Add your country’s monthly amount below.
            </p>
          ) : (
            <div className="space-y-2">
              {groups.map((g) => (
                <div key={g.country} className="rounded-tile border border-border">
                  <div className="px-3 py-1.5 border-b border-border bg-gray-50 text-[10.5px] font-bold uppercase text-subtle">{g.country}</div>
                  <ul className="divide-y divide-border">
                    {g.rows.map((r) => {
                      const current = r === g.rows.find((x) => x.effective_from <= todayIso);
                      const monthly = Number(r.monthly_amount);
                      return (
                        <li key={r.id} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                          <span className="font-semibold">{money(monthly, r.currency)} a month</span>
                          <span className="text-muted-foreground">
                            ({money(perDayMinimum(monthly, settings.daysPerMonth), r.currency)} a day) from {r.effective_from}
                          </span>
                          {current && <span className="rounded-full bg-green-tint text-brand-dark px-1.5 py-0.5 text-[9.5px] font-bold uppercase">In force</span>}
                          {r.effective_from > todayIso && <span className="rounded-full bg-status-info-tint text-status-info px-1.5 py-0.5 text-[9.5px] font-bold uppercase">Coming</span>}
                          {r.notes && <span className="text-subtle">{r.notes}</span>}
                          {canEdit && (
                            <button type="button" className="ml-auto text-subtle hover:text-status-danger" aria-label={`Remove ${g.country} from ${r.effective_from}`}
                              onClick={() => void remove(r)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {canEdit && (
            <form onSubmit={add} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end" aria-label="Add a minimum wage">
              <label className="block">
                <span className="block text-[11px] font-semibold mb-0.5">Country</span>
                <input className={field} list="minimum-wage-countries" value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" />
                <datalist id="minimum-wage-countries">
                  {COUNTRIES.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold mb-0.5">Monthly amount ({currencyFor(country)})</span>
                <input className={field} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Monthly amount"
                  placeholder="From the wage order" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold mb-0.5">Takes effect</span>
                <input type="date" className={field} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Takes effect" />
              </label>
              <label className="block">
                <span className="block text-[11px] font-semibold mb-0.5">Notes</span>
                <input className={field} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" placeholder="e.g. Wage order 2024" />
              </label>
              <Button type="submit" disabled={busy}>{busy ? 'Saving...' : 'Add amount'}</Button>
              {problem && <p role="alert" className="col-span-2 sm:col-span-5 m-0 text-status-danger">{problem}</p>}
            </form>
          )}
        </div>
      </div>
    </Card>
  );
}
