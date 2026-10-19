import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Briefcase, CalendarDays, CheckCircle2, Loader2, MapPin } from 'lucide-react';
import {
  type CareersCompany,
  type CareersJob,
  EMBED_HEIGHT_MESSAGE,
  applyToJob,
  cvProblem,
  fetchCareersJob,
  fetchCareersJobs,
  uploadCv,
} from '../lib/careers';
import { LoaderBlock } from '../components/UI/FigbloomLoader';

// A company's hosted careers page (/careers/<slug>, FIG-838): its open jobs, each job, and an application form, in the
// company's logo and colours. No sign-in. Companies without developers link to it, or embed it on their own website
// (?embed=1 in a frame; the page tells the frame its height). It uses the same public API as everyone else.

const DEFAULT_BRAND = '#17402a';
const TURNSTILE_SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

const inFrame = () => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

/** In a frame: tell the parent page how tall this page is, whenever that changes. */
function useReportHeight() {
  useEffect(() => {
    if (!inFrame() || typeof ResizeObserver === 'undefined') return;
    const send = () => window.parent.postMessage({ type: EMBED_HEIGHT_MESSAGE, height: document.documentElement.scrollHeight }, '*');
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    send();
    return () => observer.disconnect();
  }, []);
}

function Shell({ company, children }: { company: CareersCompany | null; children: ReactNode }) {
  const brand = company?.primary_color || DEFAULT_BRAND;
  const embedded = inFrame();
  return (
    <div className={`${embedded ? '' : 'min-h-screen'} bg-page text-ink`} style={{ '--careers-brand': brand } as CSSProperties}>
      {company && !embedded && (
        <header className="border-b border-border bg-white">
          <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-4 sm:px-6">
            {company.logo_url && <img src={company.logo_url} alt="" className="h-10 w-10 shrink-0 rounded-tile object-contain" />}
            <div className="min-w-0">
              <p className="m-0 truncate text-[15px] font-bold">{company.name}</p>
              {company.tagline && <p className="m-0 truncate text-[12px] text-muted-foreground">{company.tagline}</p>}
            </div>
            {company.website && (
              <a href={company.website} className="ml-auto shrink-0 text-[12.5px] font-semibold" style={{ color: brand }} rel="noopener noreferrer">
                Our website
              </a>
            )}
          </div>
        </header>
      )}
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
    </div>
  );
}

const Loading = ({ label }: { label: string }) => (
  <LoaderBlock label={label} />
);

function Facts({ job }: { job: CareersJob }) {
  const items = [
    job.department && { icon: <Briefcase className="h-3.5 w-3.5" />, text: [job.department, job.employment_type].filter(Boolean).join(' · ') },
    !job.department && job.employment_type && { icon: <Briefcase className="h-3.5 w-3.5" />, text: job.employment_type },
    job.location && { icon: <MapPin className="h-3.5 w-3.5" />, text: job.location },
    job.closing_date && { icon: <CalendarDays className="h-3.5 w-3.5" />, text: `Closes ${day(job.closing_date)}` },
  ].filter(Boolean) as { icon: ReactNode; text: string }[];
  return (
    <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-[12.5px] text-muted-foreground">
      {items.map((i) => (
        <li key={i.text} className="flex items-center gap-1.5">
          {i.icon}
          {i.text}
        </li>
      ))}
    </ul>
  );
}

function JobList({ slug }: { slug: string }) {
  const [data, setData] = useState<{ company: CareersCompany; jobs: CareersJob[] } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCareersJobs(slug).then(
      (d) => live && setData(d),
      (err) => live && setProblem(err.status === 404 ? 'This careers page does not exist.' : err.message)
    );
    return () => {
      live = false;
    };
  }, [slug]);

  useEffect(() => {
    if (data) document.title = `Careers at ${data.company.name}`;
  }, [data]);

  if (problem) return <Shell company={null}><p className="text-[14px]" role="alert">{problem}</p></Shell>;
  if (!data) return <Shell company={null}><Loading label="Loading jobs" /></Shell>;
  const brand = data.company.primary_color || DEFAULT_BRAND;

  return (
    <Shell company={data.company}>
      <h1 className="m-0 text-[22px] font-bold">Careers at {data.company.name}</h1>
      {data.company.description && <p className="mt-2 max-w-2xl whitespace-pre-line text-[13.5px] text-muted-foreground">{data.company.description}</p>}
      <h2 className="mb-3 mt-6 text-[14px] font-bold">
        {data.jobs.length === 0 ? 'No open positions right now' : `${data.jobs.length} open position${data.jobs.length === 1 ? '' : 's'}`}
      </h2>
      {data.jobs.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">Please check back later.</p>
      ) : (
        <ul className="m-0 list-none space-y-3 p-0">
          {data.jobs.map((job) => (
            <li key={job.id}>
              <Link
                to={`/careers/${slug}/jobs/${job.id}${inFrame() ? '?embed=1' : ''}`}
                className="block rounded-card border border-border bg-white p-4 transition-shadow hover:shadow-md"
              >
                <span className="block text-[15px] font-semibold" style={{ color: brand }}>{job.title}</span>
                <span className="mt-1.5 block"><Facts job={job} /></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Shell>
  );
}

declare global {
  interface Window {
    turnstile?: { render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void }) => void };
  }
}

/** Cloudflare Turnstile, when VITE_TURNSTILE_SITE_KEY is set (the server checks it with TURNSTILE_SECRET). */
function Turnstile({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !box.current) return;
    const el = box.current;
    const render = () => window.turnstile?.render(el, { sitekey: TURNSTILE_SITE_KEY, callback: onToken });
    if (window.turnstile) return void render();
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.onload = render;
    document.head.appendChild(script);
  }, [onToken]);
  return TURNSTILE_SITE_KEY ? <div ref={box} className="mt-2" /> : null;
}

const field = 'w-full rounded-tile border border-border bg-white px-3 py-2 text-[13.5px] focus:outline-none focus:ring-2 focus:ring-[color:var(--careers-brand)]';

function ApplyForm({ slug, job, formToken, brand }: { slug: string; job: CareersJob; formToken: string; brand: string }) {
  const [values, setValues] = useState({ first_name: '', last_name: '', email: '', phone: '', cover_note: '', website: '' });
  const [cv, setCv] = useState<File | null>(null);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!cv) return setProblem('Please attach your CV');
    const cvIssue = cvProblem(cv);
    if (cvIssue) return setProblem(cvIssue);
    if (TURNSTILE_SITE_KEY && !turnstileToken) return setProblem('Please complete the check that you are not a robot');
    setBusy(true);
    try {
      const cvPath = await uploadCv(slug, job.id, cv);
      const res = await applyToJob(slug, job.id, {
        ...values,
        cv_path: cvPath,
        cv_name: cv.name,
        form_token: formToken,
        turnstile_token: turnstileToken || undefined,
      });
      setDone(res.message);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-border bg-white p-4" role="status">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" style={{ color: brand }} />
        <p className="m-0 text-[13.5px]">{done}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-border bg-white p-4 sm:p-5" noValidate>
      <h2 className="m-0 text-[16px] font-bold">Apply for this job</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block text-[12.5px] font-semibold">
          First name
          <input className={`${field} mt-1`} value={values.first_name} onChange={set('first_name')} required maxLength={80} autoComplete="given-name" />
        </label>
        <label className="block text-[12.5px] font-semibold">
          Last name
          <input className={`${field} mt-1`} value={values.last_name} onChange={set('last_name')} maxLength={80} autoComplete="family-name" />
        </label>
        <label className="block text-[12.5px] font-semibold">
          Email
          <input type="email" className={`${field} mt-1`} value={values.email} onChange={set('email')} required maxLength={254} autoComplete="email" />
        </label>
        <label className="block text-[12.5px] font-semibold">
          Phone
          <input type="tel" className={`${field} mt-1`} value={values.phone} onChange={set('phone')} maxLength={30} autoComplete="tel" />
        </label>
      </div>
      <label className="block text-[12.5px] font-semibold">
        Cover note
        <textarea className={`${field} mt-1 min-h-[120px]`} value={values.cover_note} onChange={set('cover_note')} maxLength={5000} />
      </label>
      <label className="block text-[12.5px] font-semibold">
        CV (PDF, DOC or DOCX, up to 5 MB)
        <input
          type="file"
          accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="mt-1 block w-full text-[13px]"
          onChange={(e) => setCv(e.target.files?.[0] ?? null)}
        />
      </label>
      {/* left empty by people; bots fill it in */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={values.website} onChange={set('website')} name="website" />
        </label>
      </div>
      <Turnstile onToken={setTurnstileToken} />
      {problem && (
        <p className="m-0 text-[12.5px] text-red-600" role="alert">
          {problem}
        </p>
      )}
      <button
        type="submit"
        disabled={busy}
        className="inline-flex items-center gap-2 rounded-tile px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-60"
        style={{ backgroundColor: brand }}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {busy ? 'Sending...' : 'Send application'}
      </button>
    </form>
  );
}

const Section = ({ title, body }: { title: string; body: string | null }) =>
  body ? (
    <section className="mt-5">
      <h2 className="m-0 text-[14px] font-bold">{title}</h2>
      <p className="mt-1.5 whitespace-pre-line text-[13.5px] leading-relaxed">{body}</p>
    </section>
  ) : null;

function JobDetail({ slug, jobId }: { slug: string; jobId: string }) {
  const [data, setData] = useState<{ company: CareersCompany; job: CareersJob; form_token: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetchCareersJob(slug, jobId).then(
      (d) => live && setData(d),
      (err) => live && setProblem(err.status === 404 ? 'This job is no longer open.' : err.message)
    );
    return () => {
      live = false;
    };
  }, [slug, jobId]);

  useEffect(() => {
    if (data) document.title = `${data.job.title} at ${data.company.name}`;
  }, [data]);

  const back = (
    <Link to={`/careers/${slug}${inFrame() ? '?embed=1' : ''}`} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
      <ArrowLeft className="h-3.5 w-3.5" /> All jobs
    </Link>
  );
  if (problem) return <Shell company={null}>{back}<p className="mt-4 text-[14px]" role="alert">{problem}</p></Shell>;
  if (!data) return <Shell company={null}><Loading label="Loading job" /></Shell>;
  const { company, job } = data;
  const brand = company.primary_color || DEFAULT_BRAND;

  return (
    <Shell company={company}>
      {back}
      <h1 className="mb-2 mt-3 text-[22px] font-bold">{job.title}</h1>
      <Facts job={job} />
      {job.salary && <p className="mt-2 text-[13px] font-semibold">Salary: {job.salary}</p>}
      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        <article>
          <Section title="About the role" body={job.description} />
          <Section title="Responsibilities" body={job.responsibilities} />
          <Section title="Requirements" body={job.requirements} />
          <Section title="Benefits" body={job.benefits} />
          {job.posted_at && <p className="mt-5 text-[12px] text-muted-foreground">Posted {day(job.posted_at)}</p>}
        </article>
        <aside>
          <ApplyForm slug={slug} job={job} formToken={data.form_token} brand={brand} />
        </aside>
      </div>
    </Shell>
  );
}

export default function CareersPage() {
  const { slug = '', jobId } = useParams();
  useReportHeight();
  const key = slug.toLowerCase();
  return jobId ? <JobDetail slug={key} jobId={jobId} /> : <JobList slug={key} />;
}
