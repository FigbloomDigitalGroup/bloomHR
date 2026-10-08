/**
 * The app's shape (sidebar, top bar, page) in placeholder blocks, in the person's theme colours. Shown while the
 * workspace loads and while switching company, so the screen never goes blank. index.html has a plain-HTML copy
 * for the moment before the app's code has loaded.
 */
export default function AppSkeleton({ label = 'Loading your workspace…' }: { label?: string }) {
  const block = 'bg-gray-100 rounded-tile animate-pulse';
  return (
    <div className="fixed inset-0 z-[200] flex bg-page" role="status" aria-live="polite" aria-label={label}>
      {/* sidebar */}
      <div className="hidden md:flex flex-col w-[280px] flex-shrink-0 p-4 gap-3" style={{ background: 'rgb(var(--shell))' }}>
        <div className="h-9 w-36 rounded-tile bg-white/15 animate-pulse mb-4" />
        <div className="h-9 rounded-tile bg-white/10 animate-pulse mb-3" />
        {Array.from({ length: 11 }, (_, i) => (
          <div key={i} className="h-5 rounded bg-white/10 animate-pulse" style={{ width: `${55 + ((i * 17) % 35)}%` }} />
        ))}
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* top bar */}
        <div className="h-[60px] flex-shrink-0 bg-white border-b border-border flex items-center gap-4 px-3 sm:px-5">
          <div className={`${block} h-[26px] w-[26px] flex-shrink-0`} />
          <div className={`${block} h-4 w-24 hidden sm:block`} />
          <div className="flex-1 hidden sm:flex justify-center">
            <div className={`${block} h-8 w-full max-w-[460px]`} />
          </div>
          <div className="flex gap-2 ml-auto">
            {[0, 1, 2].map(i => <div key={i} className={`${block} h-[30px] w-[30px] rounded-full`} />)}
          </div>
        </div>

        {/* page */}
        <div className="flex-1 p-4 sm:p-8 space-y-6 overflow-hidden">
          <div className="space-y-2">
            <div className={`${block} h-7 w-64 max-w-full`} />
            <div className={`${block} h-4 w-40`} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[0, 1, 2].map(i => <div key={i} className={`${block} h-28 rounded-card`} />)}
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className={`${block} h-64 rounded-card`} />
            <div className={`${block} h-64 rounded-card`} />
          </div>
        </div>
      </div>
      <span className="sr-only">{label}</span>
    </div>
  );
}
