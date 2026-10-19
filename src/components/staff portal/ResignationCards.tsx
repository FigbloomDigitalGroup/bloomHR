import { DoorOpen } from 'lucide-react';
import { Button, StatusPill, type StatusTone } from '../UI';
import { formatDay, parseDay } from '../../lib/contract';
import { STATUS_LABEL, type ExitRecord, type ExitStatus } from '../../lib/exits';
import { confirmDialog } from '../../lib/confirmDialog';

/** The colour of each exit status's pill (the Resignation page uses it too). */
export const EXIT_TONE: Record<ExitStatus, StatusTone> = {
  requested: 'warning',
  approved: 'success',
  clearance: 'info',
  completed: 'neutral',
  declined: 'danger',
  cancelled: 'neutral',
};

/** What HR has said so far: their note, or where it stands. */
const hrResponse = (exit: ExitRecord) =>
  exit.decision_note || (exit.status === 'requested' ? 'Waiting for HR to review it' : 'HR accepted your resignation');

/** At the top of Profile while a resignation is under way: where it stands, the last day and HR's response. */
export function ResignationStatusCard({ exit, onView }: { exit: ExitRecord; onView: () => void }) {
  return (
    <section aria-label="Your resignation" className="bg-white rounded-lg p-5 border border-gray-200 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Your resignation</h3>
        <StatusPill label={STATUS_LABEL[exit.status]} tone={EXIT_TONE[exit.status]} />
      </div>
      <dl className="mt-3 grid grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2 text-xs">
        <div>
          <dt className="text-gray-500">Last working day</dt>
          <dd className="mt-0.5 text-gray-900 font-medium">{formatDay(parseDay(exit.last_working_day))}</dd>
        </div>
        <div>
          <dt className="text-gray-500">HR’s response</dt>
          <dd className="mt-0.5 text-gray-900 whitespace-pre-wrap">{hrResponse(exit)}</dd>
        </div>
      </dl>
      <div className="mt-4">
        <Button variant="secondary" onClick={onView}>
          View my resignation
        </Button>
      </div>
    </section>
  );
}

/** A small line on the staff Home while a resignation is under way, so it is not lost. */
export function ResignationHomeLine({ exit, onView }: { exit: ExitRecord; onView: () => void }) {
  return (
    <button
      type="button"
      onClick={onView}
      className="w-full flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left text-xs text-gray-700 shadow-sm hover:bg-gray-50 transition-colors"
    >
      <DoorOpen className="w-4 h-4 text-gray-500 flex-shrink-0" />
      <span className="font-semibold text-gray-900">Your resignation</span>
      <StatusPill label={STATUS_LABEL[exit.status]} tone={EXIT_TONE[exit.status]} className="!px-2 !py-0.5 !text-[10px]" />
      <span className="text-gray-500">Last working day {formatDay(parseDay(exit.last_working_day))}</span>
      <span className="ml-auto font-semibold text-brand whitespace-nowrap">View →</span>
    </button>
  );
}

/** The quiet section at the bottom of Profile: resigning starts here, after a confirmation. */
export function LeavingTheCompany({ onStart }: { onStart: () => void }) {
  const start = async () => {
    const ok = await confirmDialog({
      title: 'Start a resignation?',
      message: 'This begins your notice period once HR receives it.',
      confirmLabel: 'Start a resignation',
    });
    if (ok) onStart();
  };
  return (
    <section aria-label="Leaving the company" className="mt-6 rounded-lg border border-gray-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-gray-900">Leaving the company</h3>
      <p className="mt-1 text-xs text-gray-500">Thinking of resigning? Start here; HR will guide you through notice and clearance.</p>
      <div className="mt-3">
        <Button variant="secondary" icon={<DoorOpen className="w-4 h-4" />} onClick={start}>
          Start a resignation
        </Button>
      </div>
    </section>
  );
}
