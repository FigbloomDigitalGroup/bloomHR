import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Card, Button } from '../UI';
import { usePermissions } from '../../hooks/usePermissions';
import {
  EmployeeNumberMode,
  EmployeeNumbering as Numbering,
  formatEmployeeNumber,
  loadEmployeeNumbering,
  numberingError,
  saveEmployeeNumbering,
} from '../../lib/employeeNumbering';

const inputClass = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink outline-none focus:border-brand';

const MODES: { id: EmployeeNumberMode; label: string; hint: string }[] = [
  { id: 'system', label: 'Given by the system', hint: 'Each new employee gets the next number, in your format.' },
  { id: 'own', label: 'Our own numbers', hint: 'You type each new employee’s number, as you already use them.' },
];

/**
 * How the company's employee numbers are given: by the system (prefix, digits, next number) or the company's own.
 * ADMIN and people with Settings or Employees change it; others who may see it read it; anyone else sees nothing.
 */
export default function EmployeeNumberingCard({ className = 'mb-4' }: { className?: string }) {
  const { hasAnyPermission, loading: permissionsLoading } = usePermissions();
  const canEdit = !permissionsLoading && hasAnyPermission(['settings', 'employees']);
  const [saved, setSaved] = useState<Numbering | null>(null);
  const [mode, setMode] = useState<EmployeeNumberMode>('system');
  const [prefix, setPrefix] = useState('');
  const [digits, setDigits] = useState('6');
  const [next, setNext] = useState('1');
  const [busy, setBusy] = useState(false);

  const show = (n: Numbering) => {
    setSaved(n);
    setMode(n.mode);
    setPrefix(n.prefix);
    setDigits(String(n.digits));
    setNext(String(n.next_number));
  };

  useEffect(() => {
    let live = true;
    loadEmployeeNumbering().then((n) => {
      if (live && n) show(n);
    });
    return () => {
      live = false;
    };
  }, []);

  if (!saved) return null;

  const digitsN = Number(digits);
  const nextN = Number(next);
  const problem = mode === 'system' ? numberingError(prefix, digitsN, nextN) : null;
  const changed = mode !== saved.mode || prefix !== saved.prefix || digitsN !== saved.digits || nextN !== saved.next_number;
  // the server skips numbers already in use; until saved, show the number as typed
  const preview = !changed ? saved.preview : problem ? null : formatEmployeeNumber(prefix, digitsN, nextN);

  const save = async () => {
    setBusy(true);
    try {
      // the count moves only when the next number was changed here
      const moved = nextN !== saved.next_number;
      show(mode === 'system'
        ? await saveEmployeeNumbering(mode, prefix, digitsN, moved ? nextN : undefined)
        : await saveEmployeeNumbering(mode, saved.prefix, saved.digits));
      toast.success('Employee numbers saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <h2 className="m-0 text-[14px] font-bold text-ink">Employee numbers</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">How new employees get their number. Existing employees keep theirs.</p>

      {!canEdit ? (
        <p className="m-0 text-[12.5px] text-ink" role="status">
          {saved.mode === 'own' ? 'Your company uses its own employee numbers.' : `Given by the system. Next: ${saved.preview}`}
        </p>
      ) : (
        <>
          <div role="radiogroup" aria-label="How employee numbers are given" className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {MODES.map((m) => (
              <label
                key={m.id}
                className={`flex cursor-pointer items-start gap-2.5 rounded-card border bg-white p-3 transition-colors hover:bg-secondary ${mode === m.id ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <input type="radio" name="employee-number-mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} className="mt-0.5 accent-brand" />
                <span>
                  <span className="block text-[12.5px] font-semibold text-ink">{m.label}</span>
                  <span className="block text-[11.5px] text-muted-foreground">{m.hint}</span>
                </span>
              </label>
            ))}
          </div>

          {mode === 'system' ? (
            <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Prefix</span>
                <input className={inputClass} value={prefix} maxLength={12} onChange={(e) => setPrefix(e.target.value)} placeholder="e.g. MCL- (or none)" />
                <span className="block mt-1 text-[11px] text-muted-foreground">Include any separator: MCL-, EMP/, FIG</span>
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Digits</span>
                <input className={inputClass} type="number" inputMode="numeric" min={1} max={10} value={digits} onChange={(e) => setDigits(e.target.value)} />
                <span className="block mt-1 text-[11px] text-muted-foreground">Padded with zeros: 6 gives 000001</span>
              </label>
              <label className="block">
                <span className="block text-[12px] font-semibold text-ink mb-1">Next number</span>
                <input className={inputClass} type="number" inputMode="numeric" min={1} value={next} onChange={(e) => setNext(e.target.value)} />
                <span className="block mt-1 text-[11px] text-muted-foreground">Numbers already in use are skipped</span>
              </label>
            </div>
          ) : (
            <p className="mt-4 mb-0 text-[12px] text-muted-foreground">
              Type the number when you add an employee; the bulk-upload template gets an Employee Number column, needed
              for each new employee. Anyone added without one (for example by another route) still gets a system number.
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-[12.5px]" role="status" aria-live="polite">
              {mode === 'system' && (problem ? <span className="text-red-600">{problem}</span> : <span className="text-ink">Next: <span className="font-mono font-semibold">{preview}</span></span>)}
            </p>
            <Button onClick={() => void save()} disabled={busy || !changed || !!problem}>
              {busy ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </>
      )}
    </Card>
  );
}
