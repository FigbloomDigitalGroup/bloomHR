import { useState } from 'react';
import { Card, PageHeader, Button } from '../UI';
import { applyTheme, clearStoredTheme, currentChoice, resetTheme, saveStoredTheme } from '../../theme/applyTheme';
import { DEFAULT_PRESET, PRESETS, ThemeChoice, ThemePreset, choiceFromPreset, deriveVars, presetFor } from '../../theme/themes';
import { rgbToHex } from '../../theme/color';
import AccessibilityPanel from '../Accessibility/AccessibilityPanel';

const toRgb = (triplet: string) => triplet.split(' ').map(Number) as [number, number, number];

/** A tiny picture of the app in a theme: sidebar, an active menu item, a button and the highlight dot. */
function Swatch({ choice }: { choice: ThemeChoice }) {
  const v = deriveVars(choice);
  if (!v) return null;
  const hex = (name: keyof typeof v) => rgbToHex(toRgb(v[name]));
  return (
    <div className="flex h-[58px] rounded-tile overflow-hidden border border-border" aria-hidden>
      <div className="w-[38%] p-1.5 flex flex-col gap-1" style={{ background: hex('--shell') }}>
        <span className="h-1.5 w-3/4 rounded-full opacity-90" style={{ background: hex('--shell-fg') }} />
        <span className="h-2 w-full rounded" style={{ background: hex('--shell-active') }} />
        <span className="h-1.5 w-2/3 rounded-full opacity-50" style={{ background: hex('--shell-fg') }} />
      </div>
      <div className="flex-1 bg-white p-1.5 flex flex-col justify-between">
        <span className="h-1.5 w-1/2 rounded-full bg-gray-200" />
        <div className="flex items-center gap-1.5">
          <span className="h-3 w-9 rounded" style={{ background: hex('--brand') }} />
          <span className="h-3 w-3 rounded-full" style={{ background: hex('--highlight') }} />
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  return (
    <label className="flex items-center gap-3">
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase())}
        aria-label={label}
        className="h-9 w-12 rounded-tile border border-border bg-white p-0.5 cursor-pointer"
      />
      <span>
        <span className="block text-[12.5px] font-semibold text-ink">{label}</span>
        <span className="block text-[11.5px] text-muted-foreground">{value}</span>
      </span>
    </label>
  );
}

/** Choose how the app looks for you: a ready-made palette, or your own sidebar and accent colours. */
export default function Appearance() {
  const [choice, setChoice] = useState<ThemeChoice>(() => currentChoice());
  const selectedPreset = presetFor(choice);

  const update = (next: ThemeChoice) => {
    if (!applyTheme(next)) return;
    saveStoredTheme(next);
    setChoice(next);
  };

  const restoreDefault = () => {
    resetTheme();
    clearStoredTheme();
    setChoice(choiceFromPreset(DEFAULT_PRESET));
  };

  return (
    <div>
      <PageHeader
        title="Appearance"
        subtitle="Choose how Figbloom HR looks for you. This only changes your own view, not anyone else's."
        actions={
          <Button variant="secondary" onClick={restoreDefault}>
            Reset to default
          </Button>
        }
      />

      <Card className="mb-4">
        <h2 className="m-0 text-[14px] font-bold text-ink">Themes</h2>
        <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">Each one pairs a sidebar colour with an accent colour for buttons and highlights.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {PRESETS.map((p: ThemePreset) => {
            const active = selectedPreset?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => update(choiceFromPreset(p))}
                className={`text-left p-2.5 rounded-card border bg-white transition-colors hover:bg-secondary ${active ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <Swatch choice={choiceFromPreset(p)} />
                <span className="mt-2 flex items-center justify-between text-[12.5px] font-semibold text-ink">
                  {p.name}
                  {active && <span className="text-[11px] font-bold text-brand">Selected</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card>
        <h2 className="m-0 text-[14px] font-bold text-ink">Your own colours</h2>
        <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
          Pick any two colours. Text is switched between light and dark automatically, and buttons are darkened if needed, so everything stays readable.
        </p>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
          <ColorField label="Sidebar colour" value={choice.sidebar} onChange={(sidebar) => update({ ...choice, sidebar })} />
          <ColorField label="Accent colour" value={choice.accent} onChange={(accent) => update({ ...choice, accent })} />
          <ColorField label="Highlight dot" value={choice.highlight} onChange={(highlight) => update({ ...choice, highlight })} />
        </div>
        <div className="mt-4 max-w-[260px]">
          <Swatch choice={choice} />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">{selectedPreset ? selectedPreset.name : 'Custom'}</p>
        </div>
      </Card>

      <Card className="mt-4">
        <h2 className="m-0 text-[14px] font-bold text-ink">Accessibility</h2>
        <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">Text size, bolder text, higher contrast and less motion. Saved on this device only.</p>
        <AccessibilityPanel />
      </Card>
    </div>
  );
}
