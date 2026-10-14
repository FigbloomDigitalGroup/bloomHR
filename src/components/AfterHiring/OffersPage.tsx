import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Ban, Download, FileSignature, FileText, Loader2, Pencil, Plus, Send, Trash2, UserPlus } from 'lucide-react';
import { Button, Card, EmptyState, Modal, PageHeader, SearchInput, StatusPill, TabBar } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import OfferEditor, { Field, inputClass } from './OfferEditor';
import OfferLetter from './OfferLetter';
import OfferTemplatesModal from './OfferTemplatesModal';
import { loadCompanyProfile } from '../../lib/companyProfile';
import { formatKsh } from '../../lib/jobGroups';
import {
  OFFER_STATUSES,
  OFFER_STATUS_LABELS,
  OFFER_STATUS_TONES,
  type LetterBranding,
  type Offer,
  type OfferFields,
  type OfferJobGroup,
  type OfferTemplate,
  addOfferAsEmployee,
  deleteOffer,
  downloadLetterPdf,
  effectiveStatus,
  fillPlaceholders,
  letterDate,
  letterFileName,
  loadOfferJobGroups,
  loadOfferTemplates,
  loadOffers,
  offerValues,
  saveOffer,
  sendOffer,
  withdrawOffer,
  type SendOutcome,
} from '../../lib/offers';

import { confirmDialog } from '../../lib/confirmDialog';
// Offers (FIG-831): HR (Employees or Recruitment) writes offers to candidates, sends them by email with a private
// link, and sees each answer. An accepted offer becomes an employee with "Add as employee". Opened from the sidebar,
// the Onboarding page, or with ?application=<id>&name=&email=&job= to start an offer from a job application.

export async function loadBranding(): Promise<LetterBranding> {
  const p = await loadCompanyProfile().catch(() => null);
  if (!p) return { name: 'Your company' };
  return {
    name: p.company_name, logo_url: p.logo_url, tagline: p.tagline, primary_color: p.primary_color, secondary_color: p.secondary_color,
    address_line1: p.address_line1, address_line2: p.address_line2, city: p.city, postal_code: p.postal_code, country: p.country,
    phone: p.official_phone, email: p.official_email, website: p.website,
  };
}

export const tellSendOutcome = (outcome: SendOutcome) => {
  if (outcome.status === 'sent') toast.success(`Offer sent to ${outcome.email}`);
  else toast.error(`The offer is sent but the email did not go out (${outcome.reason}). Send them this link: ${outcome.link}`, { duration: 20000 });
};

function AddEmployeeModal({ offer, onClose, onAdded }: { offer: Offer; onClose: () => void; onAdded: () => void }) {
  const [workEmail, setWorkEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const add = async () => {
    setBusy(true);
    try {
      const added = await addOfferAsEmployee(offer.id, workEmail);
      if (added.invited) toast.success(`${offer.candidate_first_name} is added (${added.employeeNumber}); their invitation to ${added.workEmail} is on its way`);
      else toast.error(`${offer.candidate_first_name} is added (${added.employeeNumber}) but was not invited: ${added.inviteProblem}. Invite them from Onboarding.`, { duration: 12000 });
      onAdded();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };
  return (
    <Modal open onClose={onClose} title="Add as employee" size="md">
      <div className="space-y-3 mt-3 text-sm text-ink">
        <p>
          {offer.candidate_first_name} {offer.candidate_last_name ?? ''} is added as an employee ({offer.job_title}, starting {letterDate(offer.start_date) || 'on the agreed date'})
          and invited to the staff portal to fill in their details for onboarding.
        </p>
        <Field label="Work email" hint={`Leave empty to use ${offer.candidate_email ?? 'the email the offer went to'}`}>
          <input type="email" className={inputClass} value={workEmail} onChange={(e) => setWorkEmail(e.target.value)} placeholder={offer.candidate_email ?? ''} />
        </Field>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void add()} disabled={busy} icon={busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}>
            Add and invite
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function OfferDetails({ offer, branding, groups, onClose, onEdit, onChanged }: {
  offer: Offer;
  branding: LetterBranding;
  groups: OfferJobGroup[];
  onClose: () => void;
  onEdit: () => void;
  onChanged: () => void;
}) {
  const letterRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const status = effectiveStatus(offer);
  const group = groups.find((g) => g.id === offer.job_group_id);
  const values = offerValues(offer, { companyName: branding.name, jobGroup: group?.name ?? null, offerDate: offer.sent_at });

  const act = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    try {
      await fn();
      onChanged();
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pdf = async () => {
    if (!letterRef.current) return;
    setBusy('pdf');
    try {
      await downloadLetterPdf(letterRef.current, letterFileName(offer.candidate_first_name, offer.candidate_last_name));
    } catch (err) {
      toast.error((err as Error).message || 'The PDF was not made');
    } finally {
      setBusy(null);
    }
  };

  const spin = (what: string, icon: JSX.Element) => (busy === what ? <Loader2 className="h-4 w-4 animate-spin" /> : icon);
  return (
    <Modal open onClose={onClose} title={`${offer.candidate_first_name} ${offer.candidate_last_name ?? ''} · ${offer.job_title}`} size="5xl">
      <div className="flex flex-wrap items-center gap-2 mt-2 text-xs text-muted-foreground">
        <StatusPill label={OFFER_STATUS_LABELS[status]} tone={OFFER_STATUS_TONES[status]} />
        {offer.candidate_email && <span>{offer.candidate_email}</span>}
        {offer.sent_at && <span>· sent {letterDate(offer.sent_at)}</span>}
        {offer.viewed_at && <span>· opened {letterDate(offer.viewed_at)}</span>}
        {offer.responded_at && <span>· answered {letterDate(offer.responded_at)}</span>}
        {offer.expiry_date && status === 'sent' && <span>· reply by {letterDate(offer.expiry_date)}</span>}
      </div>
      {status === 'declined' && offer.decline_reason && (
        <p className="mt-2 rounded-lg bg-orange-tint px-3 py-2 text-sm text-ink">Reason given: “{offer.decline_reason}”</p>
      )}
      {offer.employee_id && (
        <p className="mt-2 rounded-lg bg-green-tint px-3 py-2 text-sm text-ink">Added as an employee. Follow their onboarding on the Onboarding page.</p>
      )}
      <div className="bg-secondary rounded-xl p-2 sm:p-4 mt-3 overflow-x-auto">
        <OfferLetter ref={letterRef} branding={branding} title={fillPlaceholders(offer.title, values)} text={fillPlaceholders(offer.body, values)} date={offer.sent_at} />
      </div>
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => void pdf()} disabled={busy !== null} icon={spin('pdf', <Download className="h-4 w-4" />)}>Download PDF</Button>
        {offer.status === 'draft' && (
          <Button variant="secondary" onClick={onEdit} icon={<Pencil className="h-4 w-4" />}>Edit</Button>
        )}
        {(offer.status === 'draft' || status === 'sent') && (
          <Button variant="secondary" disabled={busy !== null} icon={spin('withdraw', <Ban className="h-4 w-4" />)}
            onClick={async () => (await confirmDialog({ title: 'Withdraw this offer?', message: 'Its link stops working.', confirmLabel: 'Withdraw', tone: 'danger' })) && void act('withdraw', () => withdrawOffer(offer.id))}>
            Withdraw
          </Button>
        )}
        {['draft', 'withdrawn', 'declined', 'expired'].includes(offer.status) && (
          <Button variant="ghost" disabled={busy !== null} icon={spin('delete', <Trash2 className="h-4 w-4" />)}
            onClick={async () => (await confirmDialog({ title: 'Delete this offer?', confirmLabel: 'Delete', tone: 'danger' })) && void act('delete', async () => { await deleteOffer(offer.id); onClose(); })}>
            Delete
          </Button>
        )}
        {(offer.status === 'draft' || status === 'sent') && (
          <Button disabled={busy !== null} icon={spin('send', <Send className="h-4 w-4" />)}
            onClick={() => void act('send', async () => tellSendOutcome(await sendOffer(offer, branding)))}>
            {offer.status === 'draft' ? 'Send' : 'Send again'}
          </Button>
        )}
        {offer.status === 'accepted' && !offer.employee_id && (
          <Button onClick={() => setAdding(true)} icon={<UserPlus className="h-4 w-4" />}>Add as employee</Button>
        )}
        {offer.employee_id && (
          <Button variant="secondary" onClick={() => navigate('/onboarding')}>Open Onboarding</Button>
        )}
      </div>
      {adding && <AddEmployeeModal offer={offer} onClose={() => setAdding(false)} onAdded={() => { setAdding(false); onChanged(); }} />}
    </Modal>
  );
}

type Filter = 'all' | (typeof OFFER_STATUSES)[number];

export default function OffersPage() {
  const [params, setParams] = useSearchParams();
  const [offers, setOffers] = useState<Offer[] | null>(null);
  const [templates, setTemplates] = useState<OfferTemplate[]>([]);
  const [groups, setGroups] = useState<OfferJobGroup[]>([]);
  const [branding, setBranding] = useState<LetterBranding>({ name: 'Your company' });
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<{ offer: Offer | null; initial?: Partial<OfferFields> } | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [settingTemplates, setSettingTemplates] = useState(false);

  const load = useCallback(() => {
    loadOffers().then(setOffers, (err) => {
      setOffers([]);
      toast.error((err as Error).message);
    });
  }, []);

  useEffect(() => {
    load();
    loadOfferTemplates().then(setTemplates, () => setTemplates([]));
    loadOfferJobGroups().then(setGroups);
    loadBranding().then(setBranding);
  }, [load]);

  // started from a job application
  useEffect(() => {
    const application = params.get('application');
    if (!application) return;
    setEditing({
      offer: null,
      initial: {
        application_id: application,
        candidate_first_name: params.get('first') ?? params.get('name') ?? '',
        candidate_last_name: params.get('last') || null,
        candidate_email: params.get('email') || null,
        job_title: params.get('job') ?? '',
      },
    });
    setParams({}, { replace: true });
  }, [params, setParams]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: offers?.length ?? 0 };
    for (const o of offers ?? []) c[effectiveStatus(o)] = (c[effectiveStatus(o)] ?? 0) + 1;
    return c;
  }, [offers]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (offers ?? []).filter(
      (o) =>
        (filter === 'all' || effectiveStatus(o) === filter) &&
        (!q || [o.candidate_first_name, o.candidate_last_name, o.candidate_email, o.job_title].some((v) => (v ?? '').toLowerCase().includes(q)))
    );
  }, [offers, filter, search]);

  const save = async (fields: OfferFields, send: boolean) => {
    const saved = await saveOffer(editing?.offer?.id ?? null, fields);
    if (send) tellSendOutcome(await sendOffer(saved, branding));
    else toast.success('Draft saved');
    setEditing(null);
    setViewing(saved.id);
    load();
  };

  const viewed = offers?.find((o) => o.id === viewing) ?? null;
  const tabs = [{ id: 'all', label: `All (${counts.all})` }, ...OFFER_STATUSES.map((s) => ({ id: s, label: `${OFFER_STATUS_LABELS[s]} (${counts[s] ?? 0})` }))];

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <PageHeader
        title="Offers"
        subtitle="Offer letters to the candidates you are hiring. They open the letter from the email and accept or decline it."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" icon={<FileText className="h-4 w-4" />} onClick={() => setSettingTemplates(true)}>Letter templates</Button>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ offer: null })}>New offer</Button>
          </div>
        }
      />
      <TabBar variant="pill" items={tabs} activeId={filter} onChange={(id) => setFilter(id as Filter)} />
      <div className="max-w-sm">
        <SearchInput placeholder="Search by name, email or job" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {offers === null ? (
        <div className="flex justify-center py-8"><FigbloomLoader label="Loading offers" /></div>
      ) : shown.length === 0 ? (
        <EmptyState icon={<FileSignature className="h-6 w-6" />} title="No offers here" description="Write an offer with “New offer”." />
      ) : (
        <div className="space-y-2">
          {shown.map((o) => {
            const status = effectiveStatus(o);
            return (
              <Card key={o.id} padding="sm" className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[200px]">
                  <p className="text-sm font-medium text-ink">{o.candidate_first_name} {o.candidate_last_name ?? ''}</p>
                  <p className="text-xs text-muted-foreground">
                    {o.job_title} · {formatKsh(o.basic_salary)} basic
                    {o.start_date ? ` · starts ${letterDate(o.start_date)}` : ''}
                    {status === 'sent' && o.expiry_date ? ` · reply by ${letterDate(o.expiry_date)}` : ''}
                  </p>
                  {o.employee_id && <p className="text-xs text-status-success mt-0.5">Added as an employee</p>}
                </div>
                <StatusPill label={OFFER_STATUS_LABELS[status]} tone={OFFER_STATUS_TONES[status]} />
                <Button variant={status === 'accepted' && !o.employee_id ? 'primary' : 'secondary'} onClick={() => setViewing(o.id)}>
                  {status === 'accepted' && !o.employee_id ? 'Add as employee' : 'Open'}
                </Button>
              </Card>
            );
          })}
        </div>
      )}

      {editing && (
        <OfferEditor offer={editing.offer} initial={editing.initial} templates={templates} groups={groups} branding={branding}
          onClose={() => setEditing(null)} onSave={save} />
      )}
      {viewed && !editing && (
        <OfferDetails offer={viewed} branding={branding} groups={groups} onClose={() => setViewing(null)}
          onEdit={() => setEditing({ offer: viewed })} onChanged={load} />
      )}
      {settingTemplates && (
        <OfferTemplatesModal onClose={() => { setSettingTemplates(false); loadOfferTemplates().then(setTemplates, () => undefined); }} />
      )}
    </div>
  );
}
