import { BarChart3, CalendarDays, Clock, LayoutDashboard, Plane, Users, Wallet } from 'lucide-react';
import StatCard from '../../UI/StatCard';
import BrandMark from '../BrandMark';
import { menuLabel } from './menu';
import { WaitingCard } from './More';
import { PreviewFrame, SampleTag } from './parts';

// The admin dashboard: the sidebar, the tiles (the first with its trend line), and what is waiting for the person. Drawn
// with the app's own components (StatCard) and menu text, filled with sample data.

const MENU = [
  { id: 'dashboard', icon: LayoutDashboard },
  { id: 'employees', icon: Users },
  { id: 'leaves', icon: CalendarDays },
  { id: 'attendance', icon: Clock },
  { id: 'payroll', icon: Wallet },
  { id: 'reports', icon: BarChart3 },
] as const;

// sample headcount for twelve months, drawn as a line under the first tile's figure (StatCard's `trend`)
const HEADCOUNT = [38, 39, 39, 41, 42, 42, 44, 45, 45, 46, 47, 48];
const spark = (() => {
  const w = 120;
  const h = 26;
  const lo = 37;
  const hi = 49;
  return HEADCOUNT.map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (HEADCOUNT.length - 1)) * w).toFixed(1)} ${(h - 3 - ((v - lo) / (hi - lo)) * (h - 6)).toFixed(1)}`).join(' ');
})();

function Sparkline() {
  return (
    <svg viewBox="0 0 120 26" className="h-6 w-full" preserveAspectRatio="none" aria-hidden="true">
      <path d={spark} fill="none" stroke="rgb(var(--brand))" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function DashboardPreview({ className = '' }: { className?: string }) {
  return (
    <PreviewFrame label="Sample dashboard: headcount with a twelve-month trend, people on leave, leave requests, and three requests waiting for approval." className={`lp-cq ${className}`}>
      <div className="overflow-hidden rounded-[18px] border border-border bg-page shadow-[0_2px_0_rgba(22,32,26,0.04),0_36px_80px_-32px_rgba(14,38,25,0.55)]">
        <div className="flex">
          {/* the menu and the two-up tiles need room: they follow the preview's own width (index.css, .lp-dash-*), not the screen's */}
          <aside className="lp-dash-aside w-[128px] shrink-0 flex-col bg-shell px-2.5 py-3 text-shell-fg">
            <div className="mb-3 flex items-center gap-1.5 px-1.5">
              <BrandMark className="h-5 w-5" />
              <span className="text-[13px] font-bold tracking-tight">
                Figbloom<span className="font-normal opacity-70">HR</span>
              </span>
            </div>
            <div className="mb-1 px-1.5 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-shell-fg/40">Menu</div>
            <ul className="m-0 list-none space-y-0.5 p-0">
              {MENU.map(({ id, icon: Icon }, i) => (
                <li
                  key={id}
                  className={`flex min-h-8 items-center gap-2 rounded-[9px] px-2 text-[11.5px] ${i === 0 ? 'bg-shell-active font-semibold text-shell-active-fg shadow-sm' : 'text-shell-fg/80'}`}
                >
                  <Icon size={14} strokeWidth={i === 0 ? 2.2 : 1.8} />
                  {menuLabel(id)}
                </li>
              ))}
            </ul>
            <div className="mt-auto rounded-xl border border-shell-fg/10 bg-shell-fg/5 p-2">
              <div className="text-[11px] font-semibold">Daniel Kiplagat</div>
              <div className="text-[10px] text-shell-fg/60">HR</div>
            </div>
          </aside>

          <div className="min-w-0 flex-1">
            <div className="flex h-11 items-center justify-between gap-2 border-b border-border bg-white px-3.5">
              <div className="min-w-0 truncate text-[13px] font-bold text-ink">{menuLabel('dashboard')}</div>
              <SampleTag />
            </div>
            <div className="space-y-2.5 p-3.5">
              <div className="lp-dash-stats">
                <StatCard label="Total employees" value="48" icon={<Users size={17} />} tint="green" trend={<Sparkline />} />
                <StatCard label="On leave today" value="3" icon={<Plane size={17} />} tint="info" />
              </div>
              <WaitingCard />
            </div>
          </div>
        </div>
      </div>
    </PreviewFrame>
  );
}
