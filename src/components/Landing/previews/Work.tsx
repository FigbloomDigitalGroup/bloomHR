import StatusPill from '../../UI/StatusPill';
import { Initials, PreviewFrame, SampleTag } from './parts';

// Sample screens for people who are not paid a monthly salary: casual workers paid by the day (the week grid and a pay
// run) and workers paid for the work they record (a day's entries waiting for approval). Made-up people and amounts.

type Day = 'full' | 'half' | 'none';

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const CASUALS: { name: string; days: Day[]; paid: string }[] = [
  { name: 'Peter Kamau', days: ['full', 'full', 'full', 'full', 'full', 'half', 'none'], paid: 'KES 4,950' },
  { name: 'Mary Atieno', days: ['full', 'full', 'none', 'full', 'full', 'none', 'none'], paid: 'KES 3,600' },
  { name: 'John Mwangi', days: ['full', 'half', 'full', 'full', 'none', 'full', 'none'], paid: 'KES 4,050' },
];

const WORK = [
  { name: 'Ruth Wambui', what: 'Tea picked · 42.5 kg', amount: 'KES 510', state: 'Waiting', tone: 'warning' as const },
  { name: 'David Otieno', what: 'Crates packed · 30 crates', amount: 'KES 600', state: 'Approved', tone: 'success' as const },
  { name: 'Lucy Njoroge', what: 'Tea picked · 38 kg', amount: 'KES 456', state: 'Waiting', tone: 'warning' as const },
];

/** A day's cell in the week grid: the shape and the letter say what it is, not colour alone. */
function DayCell({ day }: { day: Day }) {
  const look = {
    full: 'bg-brand text-white',
    half: 'border border-brand/40 bg-green-tint text-brand',
    none: 'bg-secondary text-muted-foreground',
  }[day];
  const letter = { full: 'F', half: 'H', none: '–' }[day];
  return <span className={`grid h-6 w-6 place-items-center rounded-md font-mono text-[10px] font-semibold ${look}`}>{letter}</span>;
}

export function WorkPayPreview({ className = '' }: { className?: string }) {
  return (
    <PreviewFrame
      label="Sample casual workers' week showing full, half and no days for three workers with what each is owed, and piece-rate work waiting for approval."
      className={className}
    >
      <div className="rounded-card border border-border bg-white p-3.5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[13px] font-bold text-ink">Casual workers · this week</div>
          <SampleTag />
        </div>
        {/* the day letters sit over the cells: 49px = the row's padding and border, the avatar and the gap after it */}
        <div className="mt-3 flex gap-1 pl-[49px] font-mono text-[9.5px] text-muted-foreground">
          {WEEK.map((letter, index) => (
            <span key={index} className="w-6 text-center">
              {letter}
            </span>
          ))}
        </div>
        <ul className="m-0 mt-1.5 list-none space-y-2 p-0">
          {CASUALS.map((worker) => (
            <li key={worker.name} className="flex items-center gap-2.5 rounded-tile border border-border px-2.5 py-2">
              <Initials name={worker.name} tone="tint" size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11.5px] font-semibold text-ink">{worker.name}</div>
                <div className="mt-1 flex gap-1">
                  {worker.days.map((day, index) => (
                    <DayCell key={index} day={day} />
                  ))}
                </div>
              </div>
              <span className="shrink-0 whitespace-nowrap font-mono text-[11px] text-ink">{worker.paid}</span>
            </li>
          ))}
        </ul>

        <div className="mt-4 border-t border-border pt-3.5">
          <div className="text-[13px] font-bold text-ink">Piece rate · waiting for approval</div>
          <ul className="m-0 mt-2.5 list-none space-y-2 p-0">
            {WORK.map((row) => (
              <li key={row.name} className="flex items-center gap-2.5">
                <Initials name={row.name} tone="tint" size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-semibold text-ink">{row.name}</div>
                  <div className="truncate text-[10.5px] text-muted-foreground">{row.what}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="whitespace-nowrap font-mono text-[11px] text-ink">{row.amount}</span>
                  <StatusPill label={row.state} tone={row.tone} />
                </div>
              </li>
            ))}
          </ul>
        </div>
        <div className="mt-3 text-[11.5px] leading-snug text-muted-foreground">F full day · H half day. Finance uploads the M-Pesa or bank file, then marks the run paid.</div>
      </div>
    </PreviewFrame>
  );
}
