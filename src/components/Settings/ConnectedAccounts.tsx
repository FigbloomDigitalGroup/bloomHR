import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Button, Card } from '../UI';
import { handoffApi, loadMyExternalLogins, sourceLabel, type ExternalLogin } from '../../lib/platformHandoff';

const formatDate = (value: string) => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

/**
 * The signed-in person's accounts in other Figbloom products connected to this HR login, in the company they are
 * working in (a Figbloom Schools account, connected the first time they opened HR from Schools). They can remove one:
 * the next time they open HR from there, they sign in once again to connect it.
 */
export default function ConnectedAccounts() {
  const [links, setLinks] = useState<ExternalLogin[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadMyExternalLogins().then((l) => live && setLinks(l), () => live && setLinks([]));
    return () => {
      live = false;
    };
  }, []);

  if (!links || links.length === 0) return null;

  const remove = async (source: string) => {
    setBusy(source);
    try {
      await handoffApi.unlink(source);
      setLinks((l) => (l ?? []).filter((x) => x.source !== source));
      toast.success(`${sourceLabel(source)} is no longer connected`);
    } catch (e) {
      toast.error((e as Error).message || 'Not removed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-4">
      <h2 className="m-0 text-[14px] font-bold text-ink">Connected accounts</h2>
      <p className="mt-0.5 mb-3.5 text-[12px] text-muted-foreground">
        Other Figbloom products that open Figbloom HR for this company as you, without a password.
      </p>
      <ul className="m-0 p-0 list-none divide-y divide-border">
        {links.map((l) => (
          <li key={l.source} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
            <div className="text-[13px] text-ink">
              <span className="font-semibold">{sourceLabel(l.source)}</span>
              <span className="ml-2 text-[12px] text-muted-foreground">connected {formatDate(l.linked_at)}</span>
            </div>
            <Button variant="secondary" onClick={() => remove(l.source)} disabled={busy === l.source}>
              {busy === l.source ? 'Removing…' : 'Remove'}
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
