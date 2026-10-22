import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, EmployeePicker, Modal, StatusPill, TableScroll } from '../UI';
import { LoaderBlock } from '../UI/FigbloomLoader';
import { inputClass, labelClass, tdClass, thClass } from '../Perfomance/kpis/shared';
import { useEmployeeDirectory } from '../../hooks/useEmployeeDirectory';
import {
  checkSerialTried,
  loadScanners,
  loadScannerUsers,
  loadUnmatched,
  normaliseSerial,
  removeScannerUser,
  saveScanner,
  saveScannerUser,
  scannerServers,
  seenLabel,
  serialLooksRight,
  setScannerActive,
  suggestMatches,
  type Scanner,
  type ScannerInput,
  type ScannerUser,
  type SerialCheck,
  type UnmatchedScannerUser,
} from '../../lib/attendanceScanners';

/**
 * The Scanners tab (HR): the company's door scanners (ZKTeco fingerprint terminals that send punches by themselves),
 * how to set one up, and which employee each scanner user ID is. Punches from a scanner user ID nobody is matched to
 * wait until HR matches it; then they count.
 */
export default function Scanners() {
  const [scanners, setScanners] = useState<Scanner[] | null>(null);
  const [editing, setEditing] = useState<Scanner | 'new' | null>(null);

  const reload = useCallback(async () => {
    try {
      setScanners(await loadScanners());
    } catch (e) {
      toast.error((e as Error).message);
      setScanners((x) => x ?? []);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  if (!scanners) return <LoaderBlock label="Loading" compact />;

  const toggle = async (s: Scanner) => {
    try {
      await setScannerActive(s.id, !s.active);
      toast.success(s.active ? `${s.name} switched off: its punches are ignored` : `${s.name} switched on`);
      await reload();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div className="space-y-4">
      <Card padding="sm" className="space-y-3" aria-label="Scanners">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-[13px] font-semibold text-ink">Scanners</div>
            <div className="text-[11.5px] text-muted-foreground">Fingerprint scanners at your doors send each punch here by themselves.</div>
          </div>
          <Button onClick={() => setEditing('new')}>Add a scanner</Button>
        </div>
        {scanners.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">No scanners yet. Add yours with its serial number, then set it up as shown below.</p>
        ) : (
          <TableScroll>
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className={thClass}>Name</th>
                  <th className={thClass}>Serial number</th>
                  <th className={thClass}>Last seen</th>
                  <th className={thClass}>From</th>
                  <th className={thClass}>Office IP lock</th>
                  <th className={thClass}>Status</th>
                  <th className={thClass}><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {scanners.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0">
                    <td className={tdClass}>
                      <div className="font-semibold">{s.name}</div>
                      {s.lastError && <div className="text-[11px] text-status-danger">{s.lastError} ({seenLabel(s.lastErrorAt, '')})</div>}
                      {s.clockWarning && (
                        <div role="alert" className="text-[11px] text-orange-text-alt">{s.clockWarning} ({seenLabel(s.clockWarningAt, '')})</div>
                      )}
                    </td>
                    <td className={`${tdClass} font-mono`}>{s.serialNumber}</td>
                    <td className={tdClass}>{seenLabel(s.lastSeenAt)}</td>
                    <td className={tdClass}>{s.lastIp ?? '—'}</td>
                    <td className={tdClass}>{s.allowedIp ?? 'Any'}</td>
                    <td className={tdClass}>
                      <StatusPill label={s.active ? 'On' : 'Off'} tone={s.active ? 'success' : 'neutral'} />
                    </td>
                    <td className={`${tdClass} whitespace-nowrap text-right`}>
                      <Button variant="secondary" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>Edit</Button>{' '}
                      <Button variant="ghost" aria-label={`${s.active ? 'Switch off' : 'Switch on'} ${s.name}`} onClick={() => void toggle(s)}>
                        {s.active ? 'Switch off' : 'Switch on'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Card>

      <SetupSteps />
      <ScannerUsers />

      {editing && (
        <ScannerForm
          scanner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await reload();
          }}
        />
      )}
    </div>
  );
}

/** Add or change a scanner. Typing a serial number shows whether a scanner with it has tried to connect. */
export function ScannerForm({ scanner, onClose, onSaved }: { scanner: Scanner | null; onClose: () => void; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState<ScannerInput>({
    name: scanner?.name ?? '',
    serialNumber: scanner?.serialNumber ?? '',
    allowedIp: scanner?.allowedIp ?? '',
    active: scanner?.active ?? true,
  });
  const [check, setCheck] = useState<SerialCheck | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const serial = normaliseSerial(form.serialNumber);
  const serialChanged = serial !== (scanner?.serialNumber ?? '');

  // has a scanner with this serial number called in? (asked once the typing stops)
  useEffect(() => {
    setCheck(null);
    if (!serialChanged || !serialLooksRight(serial)) return;
    let live = true;
    const t = setTimeout(() => {
      checkSerialTried(serial)
        .then((c) => live && setCheck(c))
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [serial, serialChanged]);

  const save = async () => {
    if (!form.name.trim()) return setProblem('Give the scanner a name, like "Front door"');
    if (!serialLooksRight(form.serialNumber)) return setProblem('Enter the serial number as it shows on the scanner (letters and digits)');
    setBusy(true);
    setProblem(null);
    try {
      await saveScanner(scanner?.id ?? null, form);
      toast.success(scanner ? 'Scanner saved' : 'Scanner added');
      await onSaved();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<ScannerInput>) => setForm((f) => ({ ...f, ...patch }));

  return (
    <Modal open onClose={onClose} title={scanner ? `Edit ${scanner.name}` : 'Add a scanner'} size="md" closeOnBackdrop={!busy}>
      <div className="space-y-3">
        <div>
          <label htmlFor="scanner-name" className={labelClass}>Name</label>
          <input id="scanner-name" className={inputClass} placeholder="Front door" value={form.name} onChange={(e) => set({ name: e.target.value })} />
        </div>
        <div>
          <label htmlFor="scanner-serial" className={labelClass}>Serial number</label>
          <input
            id="scanner-serial"
            className={`${inputClass} font-mono`}
            placeholder="BRAV260421021"
            value={form.serialNumber}
            onChange={(e) => set({ serialNumber: e.target.value })}
          />
          <p className="text-[11.5px] text-muted-foreground mt-1">
            On the scanner: Menu → System Info → Device Info (or the label on the back).
          </p>
          {check && (
            <p role="status" className={`text-[11.5px] mt-1 ${check.tried ? 'text-status-success' : 'text-muted-foreground'}`}>
              {check.tried
                ? `This scanner tried to connect (last ${seenLabel(check.lastSeenAt)}). Save it to start receiving its punches.`
                : 'This scanner hasn’t tried to connect yet.'}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="scanner-ip" className={labelClass}>Office IP lock (optional)</label>
          <input id="scanner-ip" className={inputClass} placeholder="41.90.12.34" value={form.allowedIp} onChange={(e) => set({ allowedIp: e.target.value })} />
          <p className="text-[11.5px] text-muted-foreground mt-1">
            Your office internet’s public address. When set, punches from anywhere else are refused. Leave it empty if your
            address changes.{scanner?.lastIp ? ` This scanner last called from ${scanner.lastIp}.` : ''}
          </p>
        </div>
        <label className="flex items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" checked={form.active} onChange={(e) => set({ active: e.target.checked })} />
          On (punches from it count)
        </label>
        {problem && <p role="alert" className="text-[12px] text-status-danger">{problem}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={() => void save()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}

/** How to point a ZKTeco scanner at this app, in plain steps. */
export function SetupSteps() {
  const { relay, app } = scannerServers();
  return (
    <Card padding="sm" aria-label="Setting up a scanner">
      <details>
        <summary className="cursor-pointer text-[13px] font-semibold text-ink">How to set up a ZKTeco scanner</summary>
        <ol className="list-decimal pl-5 mt-3 space-y-2 text-[12.5px] text-ink">
          <li>Add the scanner here first, with the serial number shown on it.</li>
          <li>
            On the scanner, open <b>Menu → COMM → Ethernet</b> and set:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><b>IP address</b>: a free address on your office network, e.g. 192.168.100.50</li>
              <li><b>Subnet mask</b>: usually 255.255.255.0</li>
              <li><b>Gateway</b>: your office router, e.g. 192.168.100.1</li>
              <li><b>DNS</b>: 8.8.8.8</li>
            </ul>
          </li>
          <li>
            Open <b>Menu → COMM → Cloud Server Setting</b> and set:
            <ul className="list-disc pl-5 mt-1 space-y-0.5">
              <li><b>Server mode</b>: ADMS</li>
              <li><b>Enable domain name</b>: ON</li>
              <li>
                <b>Server address</b>: {relay ? <code className="font-mono">{relay}</code> : 'ask your administrator for the scanner address'}, with{' '}
                <b>Server port</b> 80
              </li>
              <li>
                Newer scanners that support HTTPS can use <code className="font-mono">{app || 'this app’s address'}</code> with port 443 and
                HTTPS turned on instead.
              </li>
              <li><b>Enable proxy server</b>: OFF</li>
            </ul>
          </li>
          <li>Save and restart the scanner. Within a minute or two, “Last seen” above shows the time it connected.</li>
          <li>
            The first time it connects, the scanner may send all the punches it has stored. Only punches from the “Count
            attendance from” day (on the Work schedule tab) are kept. If it connected before you added it here, restart it so it sends
            them again.
          </li>
          <li>Then match each scanner user ID to an employee below.</li>
        </ol>
      </details>
    </Card>
  );
}

/** Which employee each scanner user ID is: the IDs waiting for a match, and the matches made. */
export function ScannerUsers() {
  const { employees } = useEmployeeDirectory();
  const [matched, setMatched] = useState<ScannerUser[] | null>(null);
  const [waiting, setWaiting] = useState<UnmatchedScannerUser[]>([]);
  // what HR has picked but not saved yet, by scanner user ID
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
  const [noSuggestions, setNoSuggestions] = useState(false);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [m, w] = await Promise.all([loadScannerUsers(), loadUnmatched()]);
      setMatched(m);
      setWaiting(w);
    } catch (e) {
      toast.error((e as Error).message);
      setMatched((x) => x ?? []);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);

  const nameOf = useMemo(() => {
    const byNumber = new Map(employees.map((e) => [e.employeeNumber, e.fullName]));
    return (n: string) => byNumber.get(n) ?? n;
  }, [employees]);

  if (!matched) return <LoaderBlock label="Loading" compact />;

  const pick = (scannerUserId: string, employeeNumber: string | null) => {
    setDrafts((d) => {
      const next = { ...d };
      if (employeeNumber) next[scannerUserId] = employeeNumber;
      else delete next[scannerUserId];
      return next;
    });
    setSuggested((s) => {
      const next = new Set(s);
      next.delete(scannerUserId);
      return next;
    });
  };

  const matchAutomatically = () => {
    const open = waiting.map((w) => w.scannerUserId).filter((id) => !drafts[id]);
    const taken = [...matched.map((m) => m.employeeNumber), ...Object.values(drafts)];
    const found = suggestMatches(open, employees, taken);
    setNoSuggestions(found.size === 0);
    setDrafts((d) => ({ ...d, ...Object.fromEntries(found) }));
    setSuggested((s) => new Set([...s, ...found.keys()]));
  };

  const save = async (rows: { id: string | null; scannerUserId: string; employeeNumber: string }[]) => {
    setBusy(true);
    let saved = 0;
    try {
      for (const r of rows) {
        await saveScannerUser(r.id, r.scannerUserId, r.employeeNumber);
        saved += 1;
      }
      toast.success(saved === 1 ? 'Match saved' : `${saved} matches saved`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      // the ones saved are no longer drafts
      const done = new Set(rows.slice(0, saved).map((r) => r.scannerUserId));
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !done.has(k))));
      setSuggested((s) => new Set([...s].filter((k) => !done.has(k))));
      setBusy(false);
      await reload();
    }
  };

  const remove = async (m: ScannerUser) => {
    setBusy(true);
    try {
      await removeScannerUser(m.id);
      toast.success(`Scanner user ${m.scannerUserId} is no longer matched. Attendance already recorded stays.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
      await reload();
    }
  };

  const waitingDrafts = waiting.filter((w) => drafts[w.scannerUserId]);

  return (
    <Card padding="sm" className="space-y-4" aria-label="Scanner users">
      <div>
        <div className="text-[13px] font-semibold text-ink">Scanner users</div>
        <div className="text-[11.5px] text-muted-foreground">
          Each person is a number on the scanner (their user ID). Match each number to the employee, and their punches count as
          clocking in and out.
        </div>
      </div>

      <section className="space-y-2" aria-label="Waiting for a match">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[12.5px] font-semibold text-ink">Waiting for a match</div>
          {waiting.length > 0 && (
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy} onClick={matchAutomatically}>Match automatically</Button>
              <Button
                disabled={busy || waitingDrafts.length === 0}
                onClick={() => void save(waitingDrafts.map((w) => ({ id: null, scannerUserId: w.scannerUserId, employeeNumber: drafts[w.scannerUserId] })))}
              >
                Save all
              </Button>
            </div>
          )}
        </div>
        {noSuggestions && suggested.size === 0 && (
          <p role="status" className="text-[11.5px] text-muted-foreground">No employee numbers match the scanner user IDs waiting. Pick each person instead.</p>
        )}
        {suggested.size > 0 && (
          <p role="status" className="text-[11.5px] text-muted-foreground">
            {suggested.size === 1 ? '1 suggestion' : `${suggested.size} suggestions`} by employee number. Check them, then save.
          </p>
        )}
        {waiting.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">Nobody is waiting. New scanner users show here after their first punch.</p>
        ) : (
          <ul className="divide-y divide-border">
            {waiting.map((w) => (
              <li key={w.scannerUserId} className="py-2 grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2 items-center">
                <div>
                  <div className="text-[12.5px] font-semibold text-ink">Scanner user {w.scannerUserId}</div>
                  <div className="text-[11px] text-muted-foreground">
                    {w.punches === 1 ? '1 punch' : `${w.punches} punches`}, last {seenLabel(w.lastAt)}
                    {suggested.has(w.scannerUserId) && <span className="ml-1 font-semibold text-status-info">· Suggested</span>}
                  </div>
                </div>
                <EmployeePicker
                  label={`Employee for scanner user ${w.scannerUserId}`}
                  value={drafts[w.scannerUserId] ?? ''}
                  onChange={(e) => pick(w.scannerUserId, e?.employeeNumber ?? null)}
                />
                <Button
                  variant="secondary"
                  disabled={busy || !drafts[w.scannerUserId]}
                  aria-label={`Save scanner user ${w.scannerUserId}`}
                  onClick={() => void save([{ id: null, scannerUserId: w.scannerUserId, employeeNumber: drafts[w.scannerUserId] }])}
                >
                  Save
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2" aria-label="Matched">
        <div className="text-[12.5px] font-semibold text-ink">Matched</div>
        {matched.length === 0 ? (
          <p className="text-[12px] text-muted-foreground">No matches yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {matched.map((m) => {
              const draft = drafts[m.scannerUserId];
              const changed = !!draft && draft !== m.employeeNumber;
              return (
                <li key={m.id} className="py-2 grid grid-cols-1 sm:grid-cols-[10rem_1fr_auto] gap-2 items-center">
                  <div className="text-[12.5px] font-semibold text-ink">Scanner user {m.scannerUserId}</div>
                  <EmployeePicker
                    label={`Employee for scanner user ${m.scannerUserId}`}
                    value={draft ?? m.employeeNumber}
                    fallbackLabel={nameOf(m.employeeNumber)}
                    clearable={false}
                    onChange={(e) => pick(m.scannerUserId, e?.employeeNumber ?? null)}
                  />
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      disabled={busy || !changed}
                      aria-label={`Save scanner user ${m.scannerUserId}`}
                      onClick={() => void save([{ id: m.id, scannerUserId: m.scannerUserId, employeeNumber: draft }])}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" disabled={busy} aria-label={`Remove scanner user ${m.scannerUserId}`} onClick={() => void remove(m)}>
                      Remove
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}
