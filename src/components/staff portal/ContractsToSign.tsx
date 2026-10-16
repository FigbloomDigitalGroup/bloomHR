import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileSignature, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import { Button, Card, StatusPill } from '../UI';
import { formatDay, parseDay } from '../../lib/contract';
import {
  MY_STATUS_LABEL,
  SIGNED_FILE_ACCEPT,
  STATUS_TONE,
  canUploadSigned,
  dueState,
  listMyContracts,
  openContractFile,
  uploadSignedCopy,
  type SigningContract,
} from '../../lib/contractSigning';

const day = (d: string | null | undefined) => formatDay(parseDay(d));
const errorText = (err: unknown, fallback: string) => (err instanceof Error && err.message ? err.message : fallback);

function ContractCard({ contract, onChanged }: { contract: SigningContract; onChanged: () => void }) {
  const c = contract;
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const due = dueState(c);

  const open = async (which: 'contract' | 'signed') => {
    try {
      await openContractFile(c, which, true);
      if (which === 'contract' && !c.viewed_at) onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Could not open the file'));
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      await uploadSignedCopy(c, file);
      toast.success(c.signed_path ? 'Signed copy replaced. HR will review it.' : 'Signed copy sent to HR');
      onChanged();
    } catch (err) {
      toast.error(errorText(err, 'Could not upload your signed copy'));
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13.5px] font-bold text-ink">{c.title}</div>
          <div className="text-[11.5px] text-muted-foreground">
            Sent {day(c.sent_at)}
            {c.sign_by && c.status !== 'accepted' && (
              <span className={due === 'overdue' ? 'text-status-danger font-semibold' : due === 'due-soon' ? 'text-orange-text-alt font-semibold' : ''}>
                {' '}· please sign by {day(c.sign_by)}{due === 'overdue' ? ' (overdue)' : ''}
              </span>
            )}
          </div>
        </div>
        <StatusPill label={MY_STATUS_LABEL[c.status]} tone={STATUS_TONE[c.status]} />
      </div>

      {c.message && <p className="m-0 mt-3 text-[12.5px] text-ink whitespace-pre-line">{c.message}</p>}
      {c.status === 'sent_back' && c.send_back_reason && (
        <p role="note" className="m-0 mt-3 rounded-lg bg-orange-tint px-3 py-2 text-[12.5px] text-orange-text">
          <span className="font-semibold">HR sent it back: </span>{c.send_back_reason} Please upload a corrected signed copy.
        </p>
      )}
      <p className="m-0 mt-3 text-[12px] text-muted-foreground">
        {c.status === 'accepted'
          ? `HR accepted your signed copy on ${day(c.reviewed_at)}.`
          : c.status === 'signed'
            ? 'HR has your signed copy and will review it. You can still replace it until they accept it.'
            : 'Download the contract, sign it, then upload the signed copy (PDF, Word, or a clear photo of each page).'}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => open('contract')} icon={<Download className="w-3.5 h-3.5" />}>Download contract</Button>
        {c.signed_path && (
          <Button variant="secondary" onClick={() => open('signed')} icon={<Download className="w-3.5 h-3.5" />}>My signed copy</Button>
        )}
        {canUploadSigned(c.status) && (
          <>
            <input
              ref={fileInput}
              id={`signed-${c.id}`}
              type="file"
              accept={SIGNED_FILE_ACCEPT}
              className="sr-only"
              aria-label={`Signed copy of ${c.title}`}
              onChange={(e) => upload(e.target.files?.[0])}
            />
            <Button disabled={busy} onClick={() => fileInput.current?.click()} icon={<Upload className="w-3.5 h-3.5" />}>
              {busy ? 'Uploading…' : c.signed_path ? 'Replace signed copy' : 'Upload signed copy'}
            </Button>
          </>
        )}
      </div>
    </Card>
  );
}

/** The contracts HR has sent the signed-in employee to sign (shown on My contract). Nothing shows when there are none. */
export default function ContractsToSign() {
  const [contracts, setContracts] = useState<SigningContract[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      setContracts(await listMyContracts());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (failed) return <p className="mb-4 text-[12px] text-status-danger">Could not load the contracts HR sent you. Please refresh the page.</p>;
  if (!contracts?.length) return null;
  const open = contracts.filter((c) => c.status !== 'accepted').length;

  return (
    <section className="mb-6" aria-labelledby="contracts-to-sign">
      <h2 id="contracts-to-sign" className="m-0 mb-3 flex items-center gap-2 text-[14px] font-bold text-ink">
        <FileSignature className="w-4 h-4" />
        Contracts to sign
        {open > 0 && <span className="text-[11.5px] font-semibold text-muted-foreground">({open} open)</span>}
      </h2>
      <div className="space-y-3">
        {contracts.map((c) => (
          <ContractCard key={c.id} contract={c} onChanged={load} />
        ))}
      </div>
    </section>
  );
}
