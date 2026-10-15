import { supabase } from './supabase';

// Each company's careers page and API (FIG-838): the public API is careers_routes.js, the settings and the
// "Show on careers page" switch are in supabase/migrations/20261016500000_careers_api.sql.

const API_URL =
  import.meta.env.VITE_API_URL || (import.meta.env.MODE === 'production' ? '/api' : 'http://localhost:3001/api');

export const MAX_CV_BYTES = 5 * 1024 * 1024;
export const CV_EXTENSIONS = ['pdf', 'doc', 'docx'];
/** The message the embedded careers page sends its parent page with its height. */
export const EMBED_HEIGHT_MESSAGE = 'figbloom-careers:height';

export interface CareersCompany {
  slug: string;
  name: string;
  tagline: string | null;
  logo_url: string | null;
  primary_color: string | null;
  secondary_color: string | null;
  website: string | null;
  description: string | null;
}

export interface CareersJob {
  id: string;
  title: string;
  department: string | null;
  location: string | null;
  employment_type: string | null;
  job_level: string | null;
  description: string | null;
  requirements: string | null;
  responsibilities: string | null;
  benefits: string | null;
  salary: string | null;
  closing_date: string | null;
  posted_at: string | null;
}

export class CareersError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}/careers${path}`, init);
  } catch {
    throw new CareersError('Could not reach the careers service. Check your connection and try again.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new CareersError(body?.error || 'Something went wrong. Please try again.', res.status);
  return body as T;
}
const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export const fetchCareersJobs = (slug: string) =>
  call<{ company: CareersCompany; jobs: CareersJob[] }>(`/${encodeURIComponent(slug)}/jobs`);

export const fetchCareersJob = (slug: string, id: string) =>
  call<{ company: CareersCompany; job: CareersJob; form_token: string }>(`/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(id)}`);

/** The CV's problem, or null when it is a PDF, DOC or DOCX of at most 5 MB. */
export function cvProblem(file: File): string | null {
  const extension = (file.name.split('.').pop() || '').toLowerCase();
  if (!file.name.includes('.') || !CV_EXTENSIONS.includes(extension)) return 'Your CV must be a PDF, DOC or DOCX file';
  if (file.size <= 0) return 'This file is empty';
  if (file.size > MAX_CV_BYTES) return 'Your CV must be at most 5 MB';
  return null;
}

/** Uploads the CV straight to private storage through a one-time address; returns its path for the application. */
export async function uploadCv(slug: string, jobId: string, file: File): Promise<string> {
  const problem = cvProblem(file);
  if (problem) throw new CareersError(problem, 400);
  const target = await post<{ upload_url: string; path: string; content_type: string }>(
    `/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/cv-upload`,
    { file_name: file.name, size: file.size }
  );
  const res = await fetch(target.upload_url, { method: 'PUT', headers: { 'Content-Type': target.content_type }, body: file }).catch(() => null);
  if (!res?.ok) throw new CareersError('Your CV could not be uploaded. Please try again.', res?.status ?? 0);
  return target.path;
}

export interface ApplicationInput {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  cover_note: string;
  cv_path: string;
  cv_name: string;
  form_token: string;
  website: string; // the hidden field people leave empty
  answers?: { question: string; answer: string }[];
  turnstile_token?: string;
}

export const applyToJob = (slug: string, jobId: string, input: ApplicationInput) =>
  post<{ ok: true; message: string }>(`/${encodeURIComponent(slug)}/jobs/${encodeURIComponent(jobId)}/apply`, {
    ...input,
    source: 'careers_page',
  });

// ---------------------------------------------------------------------------------------------
// Settings > Careers page
// ---------------------------------------------------------------------------------------------
export interface CareersSettings {
  slug: string;
  allowed_origins: string[];
  show_salary: boolean;
}

export interface CareersPosting {
  id: string;
  job_title: string;
  department: string | null;
  status: string | null;
  is_public: boolean;
  application_deadline: string | null;
}

export async function loadCareersSettings(): Promise<CareersSettings | null> {
  const { data, error } = await supabase.from('careers_settings').select('slug, allowed_origins, show_salary').maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CareersSettings | null) ?? null;
}

export async function saveCareersSettings(settings: CareersSettings): Promise<CareersSettings> {
  const { data, error } = await supabase
    .from('careers_settings')
    .update({ slug: settings.slug.trim().toLowerCase(), allowed_origins: settings.allowed_origins, show_salary: settings.show_salary })
    .not('slug', 'is', null)
    .select('slug, allowed_origins, show_salary')
    .maybeSingle();
  if (error) {
    if (error.code === '23505') throw new Error('That careers address is already taken. Try another.');
    throw new Error(error.message);
  }
  if (!data) throw new Error('Only people with Settings can change the careers page');
  return data as CareersSettings;
}

export async function loadCareersPostings(): Promise<CareersPosting[]> {
  const { data, error } = await supabase
    .from('job_postings')
    .select('id, job_title, department, status, is_public, application_deadline')
    .order('posted_at', { ascending: false });
  if (error) throw new Error(error.message);
  return (data || []) as CareersPosting[];
}

export async function setPostingPublic(id: string, isPublic: boolean): Promise<void> {
  const { data, error } = await supabase.from('job_postings').update({ is_public: isPublic }).eq('id', id).select('id');
  if (error) throw new Error(error.message);
  if (!data?.length) throw new Error('You cannot change this job posting');
}

/** Is the posting on the careers page right now (shown, open, not past its closing date)? */
export function isListed(p: Pick<CareersPosting, 'is_public' | 'status' | 'application_deadline'>, today = new Date()): boolean {
  if (!p.is_public || (p.status || '').toLowerCase() !== 'open') return false;
  if (!p.application_deadline) return true;
  return p.application_deadline >= today.toISOString().slice(0, 10);
}

/** What HR copies: the page, the API addresses with an example, and the embed snippets. */
export function careersLinks(slug: string, siteOrigin: string = window.location.origin) {
  const site = siteOrigin.replace(/\/+$/, '');
  const api = /^https?:\/\//.test(API_URL) ? API_URL.replace(/\/+$/, '') : `${site}${API_URL}`;
  const page = `${site}/careers/${slug}`;
  const jobs = `${api}/careers/${slug}/jobs`;
  const job = `${jobs}/{id}`;
  const apply = `${jobs}/{id}/apply`;
  const fetchExample = `// your open jobs (only from the websites listed under "Allowed websites")
const res = await fetch('${jobs}');
const { company, jobs } = await res.json();
jobs.forEach((job) => console.log(job.title, job.department, job.location, job.closing_date));

// one job, with the form_token its application needs
const { job, form_token } = await (await fetch('${jobs}/' + jobs[0].id)).json();`;
  const iframe = `<iframe id="figbloom-careers" src="${page}?embed=1" title="Careers" style="width:100%;border:0;min-height:600px"></iframe>
<script>
  // grows the frame to fit the careers page
  window.addEventListener('message', function (e) {
    if (e.origin === '${site}' && e.data && e.data.type === '${EMBED_HEIGHT_MESSAGE}') {
      document.getElementById('figbloom-careers').style.height = e.data.height + 'px';
    }
  });
</script>`;
  const script = `<div data-figbloom-careers="${slug}"></div>
<script src="${site}/careers-embed.js" async></script>`;
  return { page, api: { jobs, job, apply }, fetchExample, iframe, script };
}
