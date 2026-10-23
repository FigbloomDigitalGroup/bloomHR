import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Clock, LogIn, LogOut, MapPin } from 'lucide-react';
import StatusPill from '../UI/StatusPill';
import Modal from '../UI/Modal';
import {
  STATUS_LABEL,
  STATUS_TONE,
  formatHours,
  formatTime,
  hoursBetween,
  isLastScan,
  lateLabel,
  nairobiToday,
  scheduleLine,
  type AttendanceToday,
} from '../../lib/attendance';
import { clockIn, clockOut, currentLocation, loadClockRules, loadToday, type ClockRules } from '../../lib/attendanceApi';
import MyMissedScans from './MyMissedScans';

/**
 * The staff portal's Clock in / Clock out card (migration 20261023300000): today's schedule, when I clocked in (and
 * whether that was late), hours so far, and the button. The browser is asked where the person is; clocking in goes
 * ahead without it when they say no or it can't tell.
 *
 * The company's clock-in policy and the person's work arrangement (migration 20261024100000): at a scanner-only company
 * the card says to use the scanner instead of offering Clock in; a refusal ("Clock in from the office, or ask HR")
 * stays on the card. A scanner's last scan today before the end of the day shows as "Last scan", with hours so far.
 *
 * Web clock-ins require a reason (migration 20261025000000): attendance is normally recorded at the door scanner.
 * When someone uses the web app, a reason dialog collects why before the clock action is sent. Clock-out via web skips
 * the dialog when the clock-in was already via the app (reason recorded then).
 */
export default function ClockCard() {
  const [today, setToday] = useState<AttendanceToday | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [rules, setRules] = useState<ClockRules | null>(null);
  const [busy, setBusy] = useState<null | 'locating' | 'saving'>(null);
  const [now, setNow] = useState(() => new Date());

  // reason dialog
  const [pendingKind, setPendingKind] = useState<'in' | 'out' | null>(null);
  const [reasonText, setReasonText] = useState('');
  const reasonInputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const [t, r] = await Promise.all([loadToday(), loadClockRules().catch(() => null)]);
      setToday(t);
      setRules(r);
      setProblem(null);
    } catch (e) {
      setProblem((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  // a scanner's last scan before the end of the day: not a clock-out yet
  const lastScan = !!today && isLastScan(
    { day: today.date, clockIn: today.clockIn, clockOut: today.clockOut, clockOutVia: today.clockOutVia, endTime: today.endTime },
    nairobiToday(now),
    now
  );
  // hours so far tick on while clocked in
  const working = !!today?.clockIn && (!today.clockOut || lastScan);
  useEffect(() => {
    if (!working) return;
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, [working]);

  const act = async (kind: 'in' | 'out', reason: string) => {
    setBusy('locating');
    setRefusal(null);
    try {
      const location = await currentLocation();
      setBusy('saving');
      const t = kind === 'in' ? await clockIn(location, reason) : await clockOut(location, reason);
      setToday(t);
      setNow(new Date());
      toast.success(kind === 'in' ? `Clocked in at ${formatTime(t.clockIn)}` : `Clocked out at ${formatTime(t.clockOut)}`);
    } catch (e) {
      setRefusal((e as Error).message);
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  // does this action need a reason dialog? clock-in always does; clock-out only when the clock-in was not via app
  const needsReason = (kind: 'in' | 'out') => kind === 'in' || today?.source !== 'app';

  const handleClockButton = (kind: 'in' | 'out') => {
    if (needsReason(kind)) {
      setReasonText('');
      setPendingKind(kind);
    } else {
      void act(kind, '');
    }
  };

  const confirmReason = () => {
    if (!pendingKind || !reasonText.trim()) return;
    const kind = pendingKind;
    const reason = reasonText.trim();
    setPendingKind(null);
    setReasonText('');
    void act(kind, reason);
  };

  const cancelReason = () => {
    setPendingKind(null);
    setReasonText('');
  };

  // scanner only (and not away today): the scanner, not the app; a day clocked in in the app can still clock out
  const scannerOnly = rules?.mode === 'scanner';
  const canClockOut = !scannerOnly || today?.source === 'app';

  const late = today?.status === 'late';
  const hours = today ? hoursBetween(today.clockIn, lastScan ? null : today.clockOut, now) : null;
  const dayNote = today && (today.status === 'holiday' || today.status === 'leave' || today.status === 'off')
    ? (today.status === 'off' ? 'Not a working day for you' : `Today: ${STATUS_LABEL[today.status]}`)
    : null;

  return (
    <>
      <section className="bg-white border border-gray-200 rounded-2xl p-4 md:p-5 shadow-sm min-w-0" aria-label="Attendance">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base md:text-lg font-bold text-gray-900 flex items-center gap-2">
              <Clock className="w-4 h-4 text-brand" /> Attendance
            </h3>
            {today && (
              <p className="text-[11px] md:text-xs text-gray-500 font-medium">
                {dayNote ?? scheduleLine(today)}
              </p>
            )}
          </div>
          {today && (
            <div className="flex items-center gap-2">
              {working && canClockOut && (
                <Button busy={busy} onClick={() => handleClockButton('out')} icon={<LogOut className="w-4 h-4" />} label="Clock out" />
              )}
              {!scannerOnly && !today.clockIn && <Button busy={busy} onClick={() => handleClockButton('in')} icon={<LogIn className="w-4 h-4" />} label="Clock in" primary />}
              {!scannerOnly && today.clockIn && today.clockOut && !lastScan && (
                <Button busy={busy} onClick={() => handleClockButton('in')} icon={<LogIn className="w-4 h-4" />} label="Clock in again" />
              )}
            </div>
          )}
        </div>

        {problem && <p className="mt-2 text-xs text-gray-600">{problem}</p>}
        {today && scannerOnly && !(working && canClockOut) && (
          <p className="mt-2 text-xs text-gray-600">{today.clockIn ? 'Clock out at the office scanner.' : 'Clock in at the office scanner.'}</p>
        )}
        {refusal && <p role="alert" className="mt-2 text-xs font-semibold text-status-danger">{refusal}</p>}
        {!today && !problem && <p className="mt-2 text-xs text-gray-400">Loading…</p>}

        {today && (
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            {today.clockIn ? (
              <>
                <div>
                  <div className="text-[11px] text-gray-500">Clocked in</div>
                  <div className="font-semibold text-gray-900 flex items-center gap-2">
                    {formatTime(today.clockIn)}
                    {late && <StatusPill label="Late" tone={STATUS_TONE.late} />}
                  </div>
                  {late && <div className="text-[11px] text-orange-text-alt">{lateLabel(today.lateMinutes)}</div>}
                </div>
                {today.clockOut && (
                  <div>
                    <div className="text-[11px] text-gray-500">{lastScan ? 'Last scan' : 'Clocked out'}</div>
                    <div className="font-semibold text-gray-900">{formatTime(today.clockOut)}</div>
                  </div>
                )}
                <div>
                  <div className="text-[11px] text-gray-500">{today.clockOut && !lastScan ? 'Hours' : 'Hours so far'}</div>
                  <div className="font-semibold text-gray-900 tabular-nums">{formatHours(hours)}</div>
                </div>
              </>
            ) : (
              <p className="text-xs text-gray-500">You haven't clocked in today.</p>
            )}
          </div>
        )}

        {today && <MyMissedScans />}

        {busy === 'locating' && (
          <p className="mt-2 text-[11px] text-gray-500 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Checking your location (you can say no; it's only kept with your clock-in)…
          </p>
        )}
      </section>

      {/* reason dialog */}
      <Modal
        open={pendingKind !== null}
        onClose={cancelReason}
        title={pendingKind === 'in' ? 'Why are you clocking in via the web?' : 'Why are you clocking out via the web?'}
        size="sm"
        closeOnBackdrop={false}
      >
        <p className="text-sm text-gray-600 mb-3">
          Attendance is normally recorded at the office scanner. Enter a reason for using the web app instead.
        </p>
        <div className="flex flex-wrap gap-2 mb-3">
          {REASON_PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => {
                setReasonText(preset);
                reasonInputRef.current?.focus();
              }}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                reasonText === preset
                  ? 'bg-brand text-white border-brand'
                  : 'bg-gray-100 text-gray-700 border-gray-200 hover:bg-gray-200'
              }`}
            >
              {preset}
            </button>
          ))}
        </div>
        <textarea
          ref={reasonInputRef}
          value={reasonText}
          onChange={(e) => setReasonText(e.target.value)}
          placeholder="e.g. Working remotely today"
          rows={2}
          maxLength={300}
          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={cancelReason}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-100 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirmReason}
            disabled={!reasonText.trim()}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-brand text-white shadow-sm hover:bg-brand-dark transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {pendingKind === 'in' ? 'Clock in' : 'Clock out'}
          </button>
        </div>
      </Modal>
    </>
  );
}

const REASON_PRESETS = ['Working remotely today', 'Field work', 'Scanner unavailable'];

function Button({ busy, onClick, icon, label, primary = false }: {
  busy: null | 'locating' | 'saving';
  onClick: () => void;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!!busy}
      className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
        primary ? 'bg-brand text-white hover:bg-brand-dark' : 'bg-gray-900 text-white hover:bg-gray-800'
      }`}
    >
      {icon}
      {busy ? 'Saving…' : label}
    </button>
  );
}
