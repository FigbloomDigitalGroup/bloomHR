import { useMemo, useState } from 'react';
import { Check, ChevronDown, EyeOff, MonitorSmartphone } from 'lucide-react';
import { Card } from '../UI';
import type { CompanyRole } from '../../lib/roles';
import { previewRole, type PreviewEntry } from '../../lib/rolePreview';

const Shown = ({ entry }: { entry: PreviewEntry }) => (
    <li className="flex items-start gap-1.5 text-xs text-ink">
        <Check className="w-3 h-3 mt-0.5 shrink-0 text-brand" strokeWidth={3} aria-hidden="true" />
        <span>
            {entry.label}
            {entry.when && <span className="block text-[10.5px] text-subtle">{entry.when}</span>}
        </span>
    </li>
);

const Hidden = ({ entry }: { entry: PreviewEntry }) => (
    <li className="flex items-start gap-1.5 text-xs text-subtle">
        <EyeOff className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
        <span>
            <span className="line-through">{entry.label}</span>
            {entry.needs && <span className="block text-[10.5px]">{entry.needs}</span>}
        </span>
    </li>
);

/**
 * "Preview as this role": the menu someone holding the role would get, area by area, and what they would not see,
 * worked out from the ticked modules with the app's own rules (src/lib/rolePreview.ts). It follows the ticks as they
 * change, before they are saved. Nobody is signed in as anyone.
 */
export default function RolePreviewPanel({ role, modules }: { role: CompanyRole; modules: string[] }) {
    const [open, setOpen] = useState(false);
    const preview = useMemo(() => previewRole(role.base_role, modules), [role.base_role, modules]);
    const shown = preview.areas.reduce((n, a) => n + a.shown.length, 0);
    const hidden = preview.areas.reduce((n, a) => n + a.hidden.length, 0);

    return (
        <Card className="mb-3.5" aria-label="Preview as this role">
            <button
                type="button"
                aria-expanded={open}
                aria-controls="role-preview"
                onClick={() => setOpen((v) => !v)}
                className="w-full flex flex-wrap items-center justify-between gap-2 text-left"
            >
                <span className="flex items-center gap-2">
                    <MonitorSmartphone className="w-[15px] h-[15px] text-muted-foreground" strokeWidth={1.8} />
                    <span className="text-[13px] font-bold text-ink">Preview as this role</span>
                    <span className="text-[11px] text-muted-foreground">
                        {preview.workspace === 'portal' ? 'Staff portal' : 'Admin app'} · {shown} shown{hidden > 0 ? `, ${hidden} hidden` : ''}
                    </span>
                </span>
                <ChevronDown className={`w-3.5 h-3.5 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
            </button>

            {open && (
                <div id="role-preview" className="mt-3">
                    <p className="m-0 mb-3 text-[11.5px] text-muted-foreground">
                        <span className="font-semibold text-ink">{role.name}. </span>
                        {preview.workspace === 'portal'
                            ? 'People with this role sign in to the staff portal and never see the admin app. This is their menu.'
                            : 'People with this role sign in to the admin app. This is their menu, with what they would not see crossed out.'}
                        {' '}It follows your ticks as you change them, before you save. The data on each screen is still limited to what the role may see.
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        {preview.areas.map((area) => (
                            <section key={area.title} aria-label={area.title} className="rounded-[10px] border border-border p-3">
                                <h4 className="m-0 mb-1.5 text-[10px] font-bold uppercase text-subtle">{area.title}</h4>
                                {area.shown.length > 0 && (
                                    <ul className="m-0 p-0 list-none space-y-1" aria-label={`${area.title}: shown`}>
                                        {area.shown.map((e) => <Shown key={e.label} entry={e} />)}
                                    </ul>
                                )}
                                {area.hidden.length > 0 && (
                                    <ul className={`m-0 p-0 list-none space-y-1 ${area.shown.length > 0 ? 'mt-2' : ''}`} aria-label={`${area.title}: not shown`}>
                                        {area.hidden.map((e) => <Hidden key={e.label} entry={e} />)}
                                    </ul>
                                )}
                            </section>
                        ))}
                    </div>
                    {preview.alsoOpens.length > 0 && (
                        <div className="mt-3">
                            <h4 className="m-0 mb-1.5 text-[10px] font-bold uppercase text-subtle">Not in their menu, but they can open it (search, links)</h4>
                            <ul className="m-0 flex flex-wrap gap-1.5 p-0 list-none" aria-label="Also opens">
                                {preview.alsoOpens.map((e) => (
                                    <li key={e.label} className="rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-ink">{e.label}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
