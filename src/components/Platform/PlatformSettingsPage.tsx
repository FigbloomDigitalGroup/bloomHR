import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card, Modal, PageHeader, StatusPill } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { myPlatformRole, roleCan, type PlatformRole } from '../../lib/platformRoles';
import {
  MAX_AUTO_APPROVE_REASON, autoApproveText, getAutoApprove, setProductAutoApprove,
  type AutoApproveSettings, type ProductAutoApprove,
} from '../../lib/platformAutoApprove';

// The Figbloom platform's settings: for now, whether a new organisation each product registers starts active or waits
// for approval (auto-approve, per product, else the platform default). Everyone in the console sees them; Owner and
// Admin change them (approve_companies, as HR's own switch on Organisations). Each change is recorded on the platform
// with the person's email and the reason. Staff can still suspend an organisation from the product's page either way.

type Load = AutoApproveSettings | { error: string } | null;

interface Change {
  product: ProductAutoApprove;
  /** true / false: the product's own switch; null: back to the platform default */
  enabled: boolean | null;
}

function changeTitle({ product, enabled }: Change) {
  if (enabled === null) return `${product.label}: follow the platform default?`;
  return `${enabled ? 'Approve' : 'Stop approving'} new ${product.label} organisations automatically?`;
}

function changeText({ product, enabled }: Change, platformDefault: boolean) {
  if (enabled === null) {
    return `${product.label} follows the platform default again: new organisations ${platformDefault ? 'start active' : 'wait for approval'}.`;
  }
  return enabled
    ? `A new organisation that ${product.label} registers starts active at once. You can still suspend it from its page.`
    : `A new organisation that ${product.label} registers waits for approval in the console.`;
}

export default function PlatformSettingsPage() {
  // undefined while loading; null when not a platform admin
  const [role, setRole] = useState<PlatformRole | null | undefined>(undefined);
  const allowed = role === undefined ? null : role !== null;
  const [load, setLoad] = useState<Load>(null);
  const [change, setChange] = useState<Change | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void myPlatformRole().then(setRole);
  }, []);

  const fetchSettings = useCallback(async () => {
    setLoad(null);
    try {
      setLoad(await getAutoApprove());
    } catch (err) {
      setLoad({ error: err instanceof Error ? err.message : 'Could not load the platform settings.' });
    }
  }, []);

  useEffect(() => {
    if (allowed) void fetchSettings();
  }, [allowed, fetchSettings]);

  const settings = load && 'products' in load ? load : null;
  const canChange = roleCan(role, 'approve_companies');

  const ask = (product: ProductAutoApprove, enabled: boolean | null) => {
    setReason('');
    setChange({ product, enabled });
  };

  const confirm = async () => {
    if (!change || !settings) return;
    setBusy(true);
    try {
      const next = await setProductAutoApprove(change.product.module, change.enabled, reason);
      setLoad({ ...next, can_change: settings.can_change });
      const now = next.products.find((p) => p.module === change.product.module);
      toast.success(`${change.product.label}: new organisations ${now?.effective ? 'start active' : 'wait for approval'}.`);
      setChange(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'The setting was not saved.');
    } finally {
      setBusy(false);
    }
  };

  const header = <PageHeader title="Platform settings" subtitle="How the Figbloom platform treats each product's new organisations" />;

  if (allowed === null) return <FigbloomLoader label="Loading" />;
  if (!allowed) {
    return (
      <div className="space-y-4">
        {header}
        <Card>
          <p className="text-sm text-ink">Only Figbloom platform admins can see the platform settings.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {header}
      <Card>
        <h2 className="text-sm font-semibold text-ink">Approving new organisations</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          On: a new organisation a product registers on the platform starts active. Off: it waits for approval on the product's page.
          A product with no switch of its own follows the platform default
          {settings ? ` (now ${settings.default ? 'on' : 'off'})` : ''}.
        </p>

        {!load ? (
          <FigbloomLoader label="Loading settings" size={48} />
        ) : 'error' in load ? (
          <div className="mt-3 space-y-2">
            <p className="text-sm text-ink" role="alert">{load.error}</p>
            <Button variant="secondary" onClick={() => void fetchSettings()}>Try again</Button>
          </div>
        ) : (
          <ul className="mt-3 divide-y divide-border/60" aria-label="Auto-approve per product">
            {load.products.map((p) => (
              <li key={p.module} className="flex flex-wrap items-start gap-3 py-3">
                <label className="flex flex-1 min-w-[14rem] items-start gap-2 text-xs text-ink cursor-pointer">
                  <input type="checkbox" className="mt-0.5" checked={p.effective} disabled={!canChange}
                    aria-label={`Approve new ${p.label} organisations automatically`} onChange={() => ask(p, !p.effective)} />
                  <span>
                    <span className="font-semibold">{p.label}</span>
                    <span className="block text-muted-foreground mt-0.5">{autoApproveText(p, load.default)}</span>
                  </span>
                </label>
                <StatusPill label={p.inherited ? 'Platform default' : 'Own setting'} tone={p.inherited ? 'neutral' : 'info'} />
                {canChange && !p.inherited && (
                  <Button variant="secondary" onClick={() => ask(p, null)}>Use platform default</Button>
                )}
              </li>
            ))}
          </ul>
        )}
        {!canChange && <p className="mt-2 text-[11.5px] text-muted-foreground">Only owners and admins change these.</p>}
      </Card>

      <Modal open={!!change} onClose={() => !busy && setChange(null)} title={change ? changeTitle(change) : ''} size="sm" closeOnBackdrop={!busy}>
        {change && settings && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{changeText(change, settings.default)}</p>
            <label className="block text-xs text-ink">
              Why? (optional; recorded on the platform with your email)
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={MAX_AUTO_APPROVE_REASON}
                className="block mt-1 w-full rounded-lg border border-border px-2 py-1 text-sm" />
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setChange(null)} disabled={busy}>Cancel</Button>
              <Button onClick={() => void confirm()} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
