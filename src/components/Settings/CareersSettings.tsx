import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Copy, ExternalLink, Globe } from 'lucide-react';
import { Card, Button } from '../UI';
import {
  type CareersPosting,
  type CareersSettings,
  careersLinks,
  isListed,
  loadCareersPostings,
  loadCareersSettings,
  saveCareersSettings,
  setPostingPublic,
} from '../../lib/careers';

const copy = (value: string, what: string) =>
  navigator.clipboard?.writeText(value).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Could not copy; select the text and copy it yourself')
  );

function Snippet({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12px] font-semibold text-ink">{label}</span>
        <button type="button" onClick={() => void copy(value, label)} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand" aria-label={`Copy ${label}`}>
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>
      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-tile border border-border bg-secondary p-2.5 text-[11.5px] leading-relaxed">{value}</pre>
    </div>
  );
}

/** A switch for "Show on careers page"; used here and on the recruitment pipeline. */
export function CareersToggle({ posting, onChange }: { posting: Pick<CareersPosting, 'id' | 'job_title' | 'is_public'>; onChange: (isPublic: boolean) => void }) {
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await setPostingPublic(posting.id, !posting.is_public);
      onChange(!posting.is_public);
      toast.success(posting.is_public ? `${posting.job_title} is off the careers page` : `${posting.job_title} is on the careers page`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-[12px] font-semibold text-ink">
      <input type="checkbox" role="switch" checked={posting.is_public} disabled={busy} onChange={() => void toggle()} className="accent-brand" aria-label={`Show ${posting.job_title} on careers page`} />
      Show on careers page
    </label>
  );
}

/**
 * Settings > Careers page (FIG-838): the company's careers address, its public page, the API with an example, the
 * embed snippets, the websites allowed to call the API, and which job postings are shown.
 */
export default function CareersSettingsCard({ className = '' }: { className?: string }) {
  const [saved, setSaved] = useState<CareersSettings | null>(null);
  const [slug, setSlug] = useState('');
  const [origins, setOrigins] = useState('');
  const [showSalary, setShowSalary] = useState(false);
  const [postings, setPostings] = useState<CareersPosting[]>([]);
  const [busy, setBusy] = useState(false);

  const show = (s: CareersSettings) => {
    setSaved(s);
    setSlug(s.slug);
    setOrigins(s.allowed_origins.join('\n'));
    setShowSalary(s.show_salary);
  };

  useEffect(() => {
    let live = true;
    loadCareersSettings()
      .then((s) => live && s && show(s))
      .catch((e) => toast.error(e.message));
    loadCareersPostings()
      .then((p) => live && setPostings(p))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  const originList = useMemo(() => origins.split(/[\n,]+/).map((o) => o.trim()).filter(Boolean), [origins]);
  if (!saved) return null;

  const links = careersLinks(saved.slug);
  const changed = slug.trim().toLowerCase() !== saved.slug || showSalary !== saved.show_salary || originList.join('\n') !== saved.allowed_origins.join('\n');
  const listed = postings.filter((p) => isListed(p)).length;

  const save = async () => {
    setBusy(true);
    try {
      show(await saveCareersSettings({ slug, allowed_origins: originList, show_salary: showSalary }));
      toast.success('Careers page saved');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={className}>
      <div className="flex items-start gap-3">
        <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-tile bg-green-tint text-brand">
          <Globe className="h-[17px] w-[17px]" strokeWidth={1.8} />
        </div>
        <div className="min-w-0">
          <h2 className="m-0 text-[13.5px] font-bold text-ink">Careers page</h2>
          <p className="m-0 max-w-[620px] text-[11.5px] text-muted-foreground">
            Your open jobs and an application form on your own website: link to your careers page, embed it, or have your developers use the API.
            Applications go straight into your recruitment pipeline.
          </p>
          <p className="m-0 mt-1 text-[11px] font-semibold text-brand" role="status">
            {listed === 0 ? 'No jobs on the careers page yet' : `${listed} job${listed === 1 ? '' : 's'} on the careers page`}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-semibold text-ink">Public page:</span>
        <a href={links.page} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 break-all font-semibold text-brand">
          {links.page} <ExternalLink className="h-3 w-3" />
        </a>
        <button type="button" onClick={() => void copy(links.page, 'Link')} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground" aria-label="Copy link">
          <Copy className="h-3 w-3" /> Copy
        </button>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
        <label className="block text-[12px] font-semibold text-ink">
          Careers address
          <span className="mt-1 flex items-center rounded-tile border border-border bg-white text-[12.5px]">
            <span className="pl-2.5 text-muted-foreground">/careers/</span>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} maxLength={50} className="w-full rounded-tile bg-transparent px-1 py-2 outline-none" aria-label="Careers address" />
          </span>
          <span className="mt-1 block text-[11px] font-normal text-muted-foreground">Letters, numbers and dashes. Changing it breaks links to the old address.</span>
        </label>
        <label className="block text-[12px] font-semibold text-ink">
          Allowed websites (for the API)
          <textarea
            value={origins}
            onChange={(e) => setOrigins(e.target.value)}
            placeholder="https://www.yourcompany.com"
            className="mt-1 min-h-[68px] w-full rounded-tile border border-border bg-white px-2.5 py-2 text-[12.5px]"
            aria-label="Allowed websites"
          />
          <span className="mt-1 block text-[11px] font-normal text-muted-foreground">One per line. Only these sites can call the API from a browser; the embed needs none.</span>
        </label>
      </div>
      <label className="mt-3 flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" checked={showSalary} onChange={(e) => setShowSalary(e.target.checked)} className="accent-brand" />
        Show the salary range on the careers page
      </label>
      <div className="mt-3 flex justify-end">
        <Button onClick={() => void save()} disabled={busy || !changed}>
          {busy ? 'Saving...' : 'Save'}
        </Button>
      </div>

      <h3 className="mb-0 mt-5 text-[12.5px] font-bold text-ink">Jobs on the careers page</h3>
      {postings.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">No job postings yet.</p>
      ) : (
        <ul className="mt-2 list-none divide-y divide-border rounded-tile border border-border p-0">
          {postings.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
              <span className="min-w-0 text-[12.5px]">
                <span className="font-semibold text-ink">{p.job_title}</span>
                {p.department && <span className="text-muted-foreground"> · {p.department}</span>}
                {p.is_public && !isListed(p) && <span className="ml-2 text-[11px] text-subtle">(not listed: {(p.status || '').toLowerCase() !== 'open' ? 'closed' : 'past its closing date'})</span>}
              </span>
              <CareersToggle posting={p} onChange={(isPublic) => setPostings((list) => list.map((x) => (x.id === p.id ? { ...x, is_public: isPublic } : x)))} />
            </li>
          ))}
        </ul>
      )}

      <h3 className="mb-0 mt-5 text-[12.5px] font-bold text-ink">Embed on your website</h3>
      <p className="m-0 mt-0.5 text-[11.5px] text-muted-foreground">Paste one of these where the jobs should appear. It fits its height to the page.</p>
      <Snippet label="Embed script" value={links.script} />
      <Snippet label="Embed frame" value={links.iframe} />

      <h3 className="mb-0 mt-5 text-[12.5px] font-bold text-ink">API for developers</h3>
      <ul className="m-0 mt-1 list-none space-y-0.5 p-0 text-[11.5px] text-muted-foreground">
        <li><code className="text-ink">GET {links.api.jobs}</code> open jobs</li>
        <li><code className="text-ink">GET {links.api.job}</code> one job, with its form_token</li>
        <li><code className="text-ink">POST {links.api.job}/cv-upload</code> then PUT the CV to the upload_url it returns</li>
        <li><code className="text-ink">POST {links.api.apply}</code> first_name, last_name, email, phone, cover_note, answers, cv_path, cv_name, form_token, and an empty website field</li>
      </ul>
      <Snippet label="Example" value={links.fetchExample} />
    </Card>
  );
}
