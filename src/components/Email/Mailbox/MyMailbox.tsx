import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, Archive, FileText, Folder, Inbox, Loader2, Mail, Paperclip, RefreshCw, Send, ShieldAlert, Star, Trash2, Unplug } from 'lucide-react';
import { Button, Card, EmptyState } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import {
  disconnectMailbox,
  getMailbox,
  getMessage,
  listFolders,
  listMessages,
  type MailFolder,
  type MailListItem,
  type MailMessage,
  type MailboxAccount,
  type MailboxDefaults,
} from '../../../lib/mailboxApi';
import MailboxConnect from './MailboxConnect';
import MailReader from './MailReader';

const FOLDER_ICONS: Record<string, typeof Inbox> = { inbox: Inbox, sent: Send, drafts: FileText, trash: Trash2, junk: ShieldAlert, archive: Archive };

/** Today: the time; this year: the day and month; before: the date. */
function listDate(iso: string | null, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString();
}

/**
 * "My mailbox": the signed-in person's own mailbox, read through the server (nothing is kept in the app). Not connected
 * yet: the Connect form. Connected: folders, the message list and the reading pane; on a phone, the list and then the
 * email, with a back button.
 */
export default function MyMailbox() {
  const [state, setState] = useState<{ account: MailboxAccount | null; defaults: MailboxDefaults } | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let live = true;
    getMailbox()
      .then((s) => live && setState(s))
      .catch((e) => live && setLoadError((e as Error).message));
    return () => {
      live = false;
    };
  }, []);

  if (loadError) return <EmptyState icon={<AlertTriangle className="w-5 h-5" />} title="Your mailbox could not be loaded" description={loadError} />;
  if (!state) return <EmptyState icon={<Loader2 className="w-5 h-5 animate-spin" />} title="Loading your mailbox…" />;
  if (!state.account) return <MailboxConnect defaults={state.defaults} onConnected={(account) => setState({ ...state, account })} />;
  return <MailboxView account={state.account} onDisconnected={() => setState({ ...state, account: null })} />;
}

function MailboxView({ account, onDisconnected }: { account: MailboxAccount; onDisconnected: () => void }) {
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [folder, setFolder] = useState('INBOX');
  const [items, setItems] = useState<MailListItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [listLoading, setListLoading] = useState(true);
  const [error, setError] = useState('');
  const [open, setOpen] = useState<MailMessage | null>(null);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [opening, setOpening] = useState(false);

  const loadFolders = useCallback(async () => {
    try {
      setFolders((await listFolders()).folders);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadMessages = useCallback(async (path: string, p: number) => {
    setListLoading(true);
    setError('');
    try {
      const res = await listMessages(path, p);
      setItems((prev) => (p === 1 ? res.messages : [...prev, ...res.messages]));
      setHasMore(res.has_more);
      setPage(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);
  useEffect(() => {
    setOpen(null);
    setOpenUid(null);
    loadMessages(folder, 1);
  }, [folder, loadMessages]);

  const refresh = () => {
    loadFolders();
    loadMessages(folder, 1);
  };

  const openMessage = async (item: MailListItem) => {
    setOpenUid(item.uid);
    setOpening(true);
    try {
      const { message } = await getMessage(folder, item.uid);
      setOpen(message);
      // opening an email marks it read: show that in the list and the folder's count
      if (!item.seen && message.seen) {
        setItems((prev) => prev.map((m) => (m.uid === item.uid ? { ...m, seen: true } : m)));
        setFolders((prev) => prev.map((f) => (f.path === folder ? { ...f, unread: Math.max(0, f.unread - 1) } : f)));
      }
    } catch (e) {
      toast.error((e as Error).message);
      setOpenUid(null);
    } finally {
      setOpening(false);
    }
  };

  const disconnect = async () => {
    const ok = await confirmDialog({
      title: 'Disconnect your mailbox?',
      message: 'Your saved password is deleted. Your email stays on your mail server; you can connect again any time.',
      confirmLabel: 'Disconnect',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await disconnectMailbox();
      onDisconnected();
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const current = folders.find((f) => f.path === folder);
  const reading = openUid !== null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-ink truncate">{account.email}</div>
          <div className="text-[11.5px] text-muted-foreground">{account.imap_host}</div>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={<RefreshCw className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} />} onClick={refresh} disabled={listLoading}>
            Refresh
          </Button>
          <Button variant="ghost" icon={<Unplug className="w-4 h-4" />} onClick={disconnect}>
            Disconnect
          </Button>
        </div>
      </div>

      {/* phones: a folder picker above the list */}
      <div className={`md:hidden ${reading ? 'hidden' : ''}`}>
        <select
          className="w-full rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink"
          value={folder}
          onChange={(e) => setFolder(e.target.value)}
          aria-label="Folder"
        >
          {(folders.length ? folders : [{ path: 'INBOX', name: 'Inbox', unread: 0 } as MailFolder]).map((f) => (
            <option key={f.path} value={f.path}>
              {f.name}
              {f.unread ? ` (${f.unread})` : ''}
            </option>
          ))}
        </select>
      </div>

      <Card padding="none" className="flex min-h-[560px] overflow-hidden">
        <nav className="hidden md:block w-48 shrink-0 border-r border-border p-2 space-y-0.5 overflow-y-auto" aria-label="Folders">
          {folders.map((f) => {
            const Icon = (f.special && FOLDER_ICONS[f.special]) || Folder;
            const active = f.path === folder;
            return (
              <button
                key={f.path}
                type="button"
                onClick={() => setFolder(f.path)}
                aria-current={active ? 'true' : undefined}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-tile text-[12.5px] text-left ${
                  active ? 'bg-secondary font-bold text-ink' : 'text-muted-foreground hover:bg-secondary hover:text-ink'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden />
                <span className="truncate flex-1">{f.name}</span>
                {f.unread > 0 && <span className="text-[11px] font-bold text-brand">{f.unread}</span>}
              </button>
            );
          })}
        </nav>

        <section
          className={`${reading ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-80 lg:w-96 shrink-0 border-r border-border min-h-0`}
          aria-label={current ? `${current.name} messages` : 'Messages'}
        >
          {error ? (
            <EmptyState icon={<AlertTriangle className="w-5 h-5" />} title="Your mail could not be loaded" description={error} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
          ) : !listLoading && items.length === 0 ? (
            <EmptyState icon={<Mail className="w-5 h-5" />} title="No emails here" />
          ) : (
            <ul className="overflow-y-auto divide-y divide-border">
              {items.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => openMessage(m)}
                    aria-current={m.uid === openUid ? 'true' : undefined}
                    className={`w-full text-left px-3 py-2.5 hover:bg-secondary ${m.uid === openUid ? 'bg-secondary' : ''}`}
                  >
                    <div className="flex items-center gap-2">
                      {!m.seen && <span className="w-2 h-2 rounded-full bg-brand shrink-0" aria-label="Unread" />}
                      <span className={`flex-1 truncate text-[12.5px] ${m.seen ? 'text-ink' : 'font-bold text-ink'}`}>
                        {m.from ? m.from.name || m.from.address : '(unknown sender)'}
                      </span>
                      {m.flagged && <Star className="w-3.5 h-3.5 text-status-warning shrink-0" aria-label="Flagged" />}
                      {m.has_attachments && <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label="Has attachments" />}
                      <span className="text-[11px] text-muted-foreground shrink-0">{listDate(m.date)}</span>
                    </div>
                    <div className={`truncate text-[12px] mt-0.5 ${m.seen ? 'text-muted-foreground' : 'font-bold text-ink'}`}>{m.subject || '(no subject)'}</div>
                  </button>
                </li>
              ))}
              {(listLoading || hasMore) && (
                <li className="p-3 text-center">
                  {listLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin inline text-muted-foreground" aria-label="Loading" />
                  ) : (
                    <Button variant="secondary" onClick={() => loadMessages(folder, page + 1)}>
                      Load older emails
                    </Button>
                  )}
                </li>
              )}
            </ul>
          )}
        </section>

        <section className={`${reading ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 p-4`} aria-label="Email">
          {opening ? (
            <EmptyState icon={<Loader2 className="w-5 h-5 animate-spin" />} title="Opening the email…" />
          ) : open ? (
            <MailReader message={open} onBack={() => setOpenUid(null)} />
          ) : (
            <EmptyState icon={<Mail className="w-5 h-5" />} title="Choose an email to read it" className="m-auto" />
          )}
        </section>
      </Card>
    </div>
  );
}
