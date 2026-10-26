import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, Download, Loader2, XCircle } from 'lucide-react';
import OfferLetter from '../components/AfterHiring/OfferLetter';
import SignaturePad from '../components/Signature/SignaturePad';
import {
  type OfferStatus,
  type PublicOffer,
  downloadLetterPdf,
  fillPlaceholders,
  letterDate,
  letterFileName,
  loadOfferByToken,
  offerValues,
  respondToOffer,
} from '../lib/offers';
import FigbloomLoader from '../components/UI/FigbloomLoader';

// The page an offer email links to (/offer?token=...). Anyone with the link sees that one offer, and nothing else:
// the letter on the company's letterhead, a PDF of it, and (while it is open) Accept, signed with a drawn signature, or
// Decline with an optional reason. No sign-in: the link itself, sent to the candidate, is the proof.

const DONE: Partial<Record<OfferStatus, string>> = {
  accepted: 'You accepted this offer. The company will be in touch about your first day.',
  declined: 'You declined this offer.',
  expired: 'This offer has expired. Contact the company if you still want to discuss it.',
  withdrawn: 'This offer has been withdrawn.',
};

export default function OfferPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [offer, setOffer] = useState<PublicOffer | null | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [signing, setSigning] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState<'accept' | 'decline' | 'pdf' | null>(null);
  const letterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadOfferByToken(token).then(
      (o) => !cancelled && setOffer(o),
      (err) => {
        if (cancelled) return;
        setOffer(null);
        setProblem((err as Error).message);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (offer === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page">
        <FigbloomLoader label="Loading your offer" />
      </div>
    );
  }

  if (offer === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-page px-4">
        <div className="max-w-md text-center space-y-2">
          <h1 className="text-lg font-semibold text-ink">This offer link is not valid</h1>
          <p className="text-sm text-muted-foreground">
            {problem ?? 'It may have been replaced by a newer email, or the offer was withdrawn. Ask the company to send it again.'}
          </p>
        </div>
      </div>
    );
  }

  const values = offerValues(offer, { companyName: offer.company.name, jobGroup: offer.job_group, offerDate: offer.sent_at });
  const open = offer.status === 'sent';

  const blobToDataUrl = (blob: Blob) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Your signature could not be read. Draw it again.'));
      reader.readAsDataURL(blob);
    });

  // accepting needs their drawn signature (from the pad); declining doesn't
  const answer = async (accept: boolean, signaturePng?: Blob) => {
    setBusy(accept ? 'accept' : 'decline');
    setProblem(null);
    try {
      const signature = accept && signaturePng ? await blobToDataUrl(signaturePng) : null;
      const status = await respondToOffer(token, accept, accept ? undefined : reason, signature);
      setOffer({ ...offer, status, responded_at: new Date().toISOString(), candidate_signature: signature });
      setDeclining(false);
      setSigning(false);
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const pdf = async () => {
    if (!letterRef.current) return;
    setBusy('pdf');
    try {
      await downloadLetterPdf(letterRef.current, letterFileName(offer.candidate_first_name, offer.candidate_last_name));
    } catch {
      setProblem('The PDF could not be made. Try again, or print this page.');
    } finally {
      setBusy(null);
    }
  };

  const color = offer.company.primary_color && /^#[0-9A-Fa-f]{6}$/.test(offer.company.primary_color) ? offer.company.primary_color : '#17402A';
  return (
    <div className="min-h-screen bg-page py-6 px-3 sm:px-6">
      <div className="max-w-[760px] mx-auto space-y-4">
        <OfferLetter ref={letterRef} branding={offer.company} title={fillPlaceholders(offer.title, values)}
          text={fillPlaceholders(offer.body, values)} date={offer.sent_at} signature={offer.signature}
          acceptance={offer.status === 'accepted'
            ? { name: values.candidate_name, signature: offer.candidate_signature ?? null, date: offer.responded_at }
            : null} />

        <div className="bg-white border border-border rounded-xl p-4 space-y-3">
          {DONE[offer.status] && (
            <p className={`text-sm font-medium flex items-center gap-2 ${offer.status === 'accepted' ? 'text-status-success' : 'text-ink'}`} role="status">
              {offer.status === 'accepted' ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
              {DONE[offer.status]}
            </p>
          )}
          {open && !declining && !signing && (
            <p className="text-sm text-ink">Please reply by <strong>{letterDate(offer.expiry_date)}</strong>.</p>
          )}
          {open && signing && (
            <div>
              <p className="text-sm text-ink mb-2">Sign below to accept the offer. Your signature goes on the letter.</p>
              <SignaturePad
                busy={busy === 'accept'}
                saveLabel="Sign and accept"
                onCancel={() => setSigning(false)}
                onSave={(png) => answer(true, png)}
              />
            </div>
          )}
          {open && declining && (
            <label className="block">
              <span className="block text-xs font-medium text-ink mb-1">Would you tell us why? (optional)</span>
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
                className="w-full rounded-lg border border-border px-3 py-2 text-sm" />
            </label>
          )}
          {problem && <p role="alert" className="text-sm text-status-danger">{problem}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={() => void pdf()} disabled={busy !== null}
              className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-ink disabled:opacity-50">
              {busy === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
            </button>
            {open && !declining && !signing && (
              <>
                <button type="button" onClick={() => setDeclining(true)} disabled={busy !== null}
                  className="px-3.5 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-ink disabled:opacity-50">
                  Decline
                </button>
                <button type="button" onClick={() => setSigning(true)} disabled={busy !== null} style={{ background: color }}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50">
                  Accept offer
                </button>
              </>
            )}
            {open && declining && (
              <>
                <button type="button" onClick={() => setDeclining(false)} disabled={busy !== null}
                  className="px-3.5 py-2 rounded-lg border border-border bg-white text-sm font-semibold text-ink">
                  Back
                </button>
                <button type="button" onClick={() => void answer(false)} disabled={busy !== null}
                  className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-status-danger text-sm font-semibold text-white disabled:opacity-50">
                  {busy === 'decline' && <Loader2 className="h-4 w-4 animate-spin" />} Decline offer
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
