import { useState } from 'react';
import { DEFAULT_A11Y, TEXT_SCALES, isDefaultA11y, loadA11y, saveA11y, type A11yPrefs } from '../../lib/a11y';

/** Every change applies the moment it is made, so the person sees exactly what they are choosing. */
export default function AccessibilityPanel() {
  const [prefs, setPrefs] = useState<A11yPrefs>(loadA11y);

  const update = (patch: Partial<A11yPrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveA11y(next);
  };

  return (
    <div className="grid gap-5">
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold text-ink">Text size</legend>
        <div role="radiogroup" aria-label="Text size" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {TEXT_SCALES.map((s) => {
            const on = prefs.textScale === s.value;
            return (
              <button
                key={s.value}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => update({ textScale: s.value })}
                className={`flex min-h-[44px] flex-col items-center justify-center rounded-lg border px-2 py-2 transition-colors ${
                  on ? 'border-brand bg-brand text-white' : 'border-border bg-white text-ink hover:bg-secondary'
                }`}
              >
                <span className="font-semibold leading-none" style={{ fontSize: 13 * s.value }}>
                  Aa
                </span>
                <span className="mt-1 text-[11.5px]">{s.label}</span>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[12px] text-muted-foreground">Makes everything bigger: text, buttons and spacing together.</p>
      </fieldset>

      <div className="grid gap-1 border-t border-border pt-3">
        <Toggle label="Bolder text" hint="Thicker letters that are easier to read at a glance." checked={prefs.bold} onChange={(bold) => update({ bold })} />
        <Toggle label="Higher contrast" hint="Darkens grey text and borders, and underlines links." checked={prefs.contrast} onChange={(contrast) => update({ contrast })} />
        <Toggle label="Reduce motion" hint="Turns off slide and fade animations." checked={prefs.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} />
      </div>

      <div>
        <button
          type="button"
          onClick={() => {
            setPrefs(DEFAULT_A11Y);
            saveA11y(DEFAULT_A11Y);
          }}
          disabled={isDefaultA11y(prefs)}
          className="rounded-tile border border-border bg-white px-3.5 py-2 text-[12.5px] font-semibold text-ink hover:bg-secondary disabled:cursor-not-allowed disabled:opacity-50"
        >
          Reset accessibility
        </button>
      </div>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        <span className="block text-[12px] text-muted-foreground">{hint}</span>
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span
        aria-hidden
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-orange ${
          checked ? 'bg-brand' : 'bg-gray-300'
        }`}
      >
        <span className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-[left]" style={{ left: checked ? 22 : 2 }} />
      </span>
    </label>
  );
}
