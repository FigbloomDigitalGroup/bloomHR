import { useState } from 'react';
import { Card, PageHeader, Button } from '../UI';
import { applyTheme, clearStoredTheme, currentChoice, resetTheme, saveStoredTheme } from '../../theme/applyTheme';
import {
  DEFAULT_PAGE,
  DEFAULT_PRESET,
  PAGE_PRESETS,
  PRESETS,
  ThemeChoice,
  ThemePreset,
  choiceFromPreset,
  derivePageVars,
  deriveVars,
  pagePresetFor,
  presetFor,
} from '../../theme/themes';
import { rgbToHex } from '../../theme/color';
import ProfilePicture from './ProfilePicture';
import { saveMyTheme } from '../../lib/preferences';
import AccessibilityPanel from '../Accessibility/AccessibilityPanel';

const toRgb = (triplet: string) => triplet.split(' ').map(Number) as [number, number, number];

/** The page, card and border colours a page colour gives (the built-in white when there is none). */
function pageColours(page: string | undefined) {
  const v = derivePageVars(page || DEFAULT_PAGE);
  if (!page || page.toUpperCase() === DEFAULT_PAGE.toUpperCase() || !v) {
    return { page: DEFAULT_PAGE, surface: '#FFFFFF', line: '#E5E7EB', ink: '#16201A' };
  }
  const hex = (name: keyof typeof v) => rgbToHex(toRgb(v[name]));
  return { page: hex('--page'), surface: hex('--surface'), line: hex('--line'), ink: hex('--ink') };
}

/** A tiny picture of the app in a theme: sidebar, an active menu item, a button, the highlight dot and the page. */
function Swatch({ choice }: { choice: ThemeChoice }) {
  const v = deriveVars(choice);
  if (!v) return null;
  const hex = (name: keyof typeof v) => rgbToHex(toRgb(v[name]));
  const page = pageColours(choice.page);
  return (
    <div className="flex h-[58px] rounded-tile overflow-hidden border border-border" aria-hidden>
      <div className="w-[38%] p-1.5 flex flex-col gap-1" style={{ background: hex('--shell') }}>
        <span className="h-1.5 w-3/4 rounded-full opacity-90" style={{ background: hex('--shell-fg') }} />
        <span className="h-2 w-full rounded" style={{ background: hex('--shell-active') }} />
        <span className="h-1.5 w-2/3 rounded-full opacity-50" style={{ background: hex('--shell-fg') }} />
      </div>
      <div className="flex-1 p-1.5 flex flex-col justify-between" style={{ background: page.page }}>
        <span className="h-1.5 w-1/2 rounded-full" style={{ background: page.line }} />
        <div className="flex items-center gap-1.5 rounded px-1 py-0.5" style={{ background: page.surface }}>
          <span className="h-3 w-9 rounded" style={{ background: hex('--brand') }} />
          <span className="h-3 w-3 rounded-full" style={{ background: hex('--highlight') }} />
        </div>
      </div>
    </div>
  );
}

/** A tiny picture of a page colour: the page, a card on it, and a line of text. */
function PageSwatch({ page }: { page: string }) {
  const c = pageColours(page);
  return (
    <div className="h-[58px] rounded-tile overflow-hidden border border-border p-2" style={{ background: c.page }} aria-hidden>
      <div className="h-full rounded p-1.5 flex flex-col gap-1.5" style={{ background: c.surface, border: `1px solid ${c.line}` }}>
        <span className="h-1.5 w-1/2 rounded-full opacity-80" style={{ background: c.ink }} />
        <span className="h-1.5 w-3/4 rounded-full" style={{ background: c.line }} />
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
  const selectedPage = pagePresetFor(choice.page);

  // a page colour of the built-in white is stored as "none", so the defaults in index.css apply exactly
  const withPage = (page: string | undefined): ThemeChoice => {
    const { page: _old, ...rest } = choice;
    return page && page.toUpperCase() !== DEFAULT_PAGE.toUpperCase() ? { ...rest, page } : rest;
  };

  const update = (next: ThemeChoice) => {
    if (!applyTheme(next)) return;
    saveStoredTheme(next);
    setChoice(next);
    void saveMyTheme(next); // also on the account, so it follows this person to other devices
  };

  const restoreDefault = () => {
    resetTheme();
    clearStoredTheme();
    void saveMyTheme(null);
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

      <ProfilePicture />

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
                onClick={() => update(choiceFromPreset(p, choice.page))}
                className={`text-left p-2.5 rounded-card border bg-white transition-colors hover:bg-secondary ${active ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <Swatch choice={choiceFromPreset(p, choice.page)} />
                <span className="mt-2 flex items-center justify-between text-[12.5px] font-semibold text-ink">
                  {p.name}
                  {active && <span className="text-[11px] font-bold text-brand">Selected</span>}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      <Card className="mb-4">
        <h2 className="m-0 text-[14px] font-bold text-ink">Page colours</h2>
        <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
          The colour of every page: backgrounds, cards and panels, light or dark. The text follows it. Works with any
          theme above.
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {PAGE_PRESETS.map((p) => {
            const active = selectedPage?.id === p.id;
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={active}
                onClick={() => update(withPage(p.page))}
                className={`text-left p-2.5 rounded-card border bg-white transition-colors hover:bg-secondary ${active ? 'border-brand ring-2 ring-brand/30' : 'border-border'}`}
              >
                <PageSwatch page={p.page} />
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
          Pick any colours. Text switches between light and dark to suit each colour (light text on a dark page), and
          buttons are darkened if needed, so everything stays readable.
        </p>
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3.5">
          <ColorField label="Sidebar colour" value={choice.sidebar} onChange={(sidebar) => update({ ...choice, sidebar })} />
          <ColorField label="Accent colour" value={choice.accent} onChange={(accent) => update({ ...choice, accent })} />
          <ColorField label="Highlight dot" value={choice.highlight} onChange={(highlight) => update({ ...choice, highlight })} />
          <ColorField label="Page colour" value={choice.page || DEFAULT_PAGE} onChange={(page) => update(withPage(page))} />
        </div>
        <div className="mt-4 max-w-[260px]">
          <Swatch choice={choice} />
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">
            {selectedPreset ? selectedPreset.name : 'Custom'}
            {' · '}
            {selectedPage ? selectedPage.name : 'custom page colour'}
          </p>
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
