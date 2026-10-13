import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { X } from 'lucide-react';
import { type DocumentSection, type DocumentTypeSetting, SECTION_TITLES, loadCompanyDocumentSettings, setCompanyDocumentRequired } from '../../lib/employeeDocuments';
import FigbloomLoader from '../UI/FigbloomLoader';

// Which documents every employee of the company must provide. Role-specific ones can also be asked of one employee
// in their review panel; tax-claim documents are required whenever the employee makes the claim.

const SECTIONS: DocumentSection[] = ['core', 'qualifications', 'role'];

export default function RequiredDocumentsModal({ onClose }: { onClose: () => void }) {
  const [types, setTypes] = useState<DocumentTypeSetting[] | null>(null);

  useEffect(() => {
    loadCompanyDocumentSettings().then(setTypes, (err) => {
      setTypes([]);
      toast.error(err instanceof Error ? err.message : 'Could not load the settings.');
    });
  }, []);

  const toggle = async (t: DocumentTypeSetting, required: boolean) => {
    setTypes((ts) => ts?.map((x) => (x.code === t.code ? { ...x, required } : x)) ?? ts);
    try {
      await setCompanyDocumentRequired(t.code, required);
    } catch (err) {
      setTypes((ts) => ts?.map((x) => (x.code === t.code ? t : x)) ?? ts);
      toast.error(err instanceof Error ? err.message : 'The setting was not saved.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-label="Required documents">
      <div className="bg-white rounded-[10px] border border-border shadow-lg w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">Required documents</h2>
            <p className="text-xs text-muted-foreground">What every employee must upload before you can approve them.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 text-muted-foreground hover:text-ink"><X className="h-4 w-4" /></button>
        </div>
        <div className="overflow-y-auto px-5 py-4 space-y-4">
          {!types && <FigbloomLoader label="Loading" size={48} />}
          {types && SECTIONS.map((section) => (
            <section key={section}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">{SECTION_TITLES[section]}</h3>
              <ul>
                {types.filter((t) => t.section === section).map((t) => (
                  <li key={t.code}>
                    <label className="flex items-center gap-2 py-1 text-sm text-ink">
                      <input type="checkbox" checked={t.required ?? t.required_by_default} onChange={(e) => void toggle(t, e.target.checked)} />
                      {t.label}
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          <p className="text-xs text-muted-foreground">
            The KRA PWD exemption certificate, mortgage interest statement and insurance policy are asked for automatically when
            an employee claims them.
          </p>
        </div>
      </div>
    </div>
  );
}
