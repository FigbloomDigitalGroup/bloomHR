import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  FileText,
  Flag,
  Folder,
  Inbox,
  Keyboard,
  Loader2,
  Mail,
  MailOpen,
  Paperclip,
  PenSquare,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldAlert,
  SlidersHorizontal,
  Star,
  Trash2,
  Unplug,
  X,
} from 'lucide-react';
import { Button, Card, EmptyState } from '../../UI';
import { confirmDialog } from '../../../lib/confirmDialog';
import {
  deleteMessages,
  disconnectMailbox,
  findArchive,
  findTrash,
  getMailbox,
  getMessage,
  listFolders,
  listMessages,
  moveMessages,
  searchMessages,
  setFlags,
  type MailFolder,
  type MailListItem,
  type MailMessage,
  type MailboxAccount,
  type MailboxDefaults,
  type SearchFilters,
  type SendResult,
} from '../../../lib/mailboxApi';
import { forwardDraft, newDraft, replyDraft, type ComposeDraft } from '../../../lib/mailCompose';
import { notifyMailbox } from '../../../hooks/useMailboxUnread';
import MailboxConnect from './MailboxConnect';
import MailCompose from './MailCompose';
import MailReader, { type ReplyMode } from './MailReader';
import MailAvatar from './MailAvatar';

const FOLDER_ICONS: Record<string, typeof Inbox> = { inbox: Inbox, sent: Send, drafts: FileText, trash: Trash2, junk: ShieldAlert, archive: Archive };

export const SHORTCUTS_HELP = 'Keyboard shortcuts: j / k next / previous email · r reply · e archive (when there is an Archive folder) · # delete';

/** Today: the time; this year: the day and month; before: the date. */
function listDate(iso: string | null, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return d.toLocaleDateString();
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Typing in a field: the keyboard shortcuts stay out of the way. */
const typingIn = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

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
  if (!state.account)
    return (
      <MailboxConnect
        defaults={state.defaults}
        onConnected={(account) => {
          notifyMailbox({ connected: true });
          setState({ ...state, account });
        }}
      />
    );
  return (
    <MailboxView
      account={state.account}
      defaults={state.defaults}
      onChanged={(account) => setState({ ...state, account })}
      onDisconnected={() => {
        notifyMailbox({ connected: false });
        setState({ ...state, account: null });
      }}
    />
  );
}

type Action = 'read' | 'unread' | 'flag' | 'unflag' | 'delete' | 'move';

function MailboxView({
  account,
  defaults,
  onChanged,
  onDisconnected,
}: {
  account: MailboxAccount;
  defaults: MailboxDefaults;
  onChanged: (account: MailboxAccount) => void;
  onDisconnected: () => void;
}) {
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
  const [compose, setCompose] = useState<ComposeDraft | null>(null);
  // a new draft each time Compose opens, even for the same email
  const [composeKey, setComposeKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  // searching: the filters in use (null: the folder's own list), and the form being typed
  const [search, setSearch] = useState<SearchFilters | null>(null);
  const [searchTotal, setSearchTotal] = useState<{ total: number; capped: boolean } | null>(null);
  const [query, setQuery] = useState('');
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Omit<SearchFilters, 'q'>>({});
  const { frame, frameHeight } = useFillHeight(editing);

  const loadFolders = useCallback(async () => {
    try {
      setFolders((await listFolders()).folders);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const loadMessages = useCallback(
    async (p: number) => {
      setListLoading(true);
      setError('');
      try {
        const res = search ? await searchMessages(folder, search, p) : await listMessages(folder, p);
        setItems((prev) => (p === 1 ? res.messages : [...prev, ...res.messages]));
        setHasMore(res.has_more);
        setPage(p);
        setSearchTotal(search && 'capped' in res ? { total: res.total, capped: Boolean(res.capped) } : null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setListLoading(false);
      }
    },
    [folder, search],
  );

  useEffect(() => {
    loadFolders();
  }, [loadFolders]);
  useEffect(() => {
    setOpen(null);
    setOpenUid(null);
    setSelected(new Set());
    loadMessages(1);
  }, [loadMessages]);

  // the sidebar's new-mail badge follows the Inbox's unread count shown here
  useEffect(() => {
    const inbox = folders.find((f) => f.special === 'inbox' || f.path.toUpperCase() === 'INBOX');
    if (inbox) notifyMailbox({ unread: inbox.unread });
  }, [folders]);

  const chooseFolder = (path: string) => {
    setSearch(null);
    setQuery('');
    setFolder(path);
  };

  const refresh = () => {
    loadFolders();
    loadMessages(1);
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

  const closeReader = () => {
    setOpenUid(null);
    setOpen(null);
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

  const startCompose = (draft: ComposeDraft) => {
    setCompose(draft);
    setComposeKey((k) => k + 1);
  };

  const respond = (mode: ReplyMode) => {
    if (!open) return;
    startCompose(mode === 'forward' ? forwardDraft(open) : replyDraft(open, account.email, mode === 'replyAll'));
  };

  const sent = (result: SendResult) => {
    const replied = compose?.reply;
    setCompose(null);
    // a reply marks the original answered
    if (replied && replied.folder === folder) setItems((prev) => prev.map((m) => (m.uid === replied.uid ? { ...m, answered: true } : m)));
    loadFolders();
    // the copy is in Sent: show it when that is the folder open
    if (result.sent_folder && result.sent_folder === folder && !search) loadMessages(1);
  };

  const trash = findTrash(folders);
  const archive = findArchive(folders);
  const inTrash = trash !== null && folder === trash;
  const moveTargets = folders.filter((f) => f.path !== folder);

  /** Acts on these emails; removing the open one goes on to the next (older) email, else the one before. */
  const act = async (uids: number[], action: Action, to?: string) => {
    if (!uids.length || busy) return;
    let permanent = false;
    if (action === 'delete' && inTrash) {
      permanent = await confirmDialog({
        title: 'Delete permanently?',
        message: `${plural(uids.length, 'email')} will be deleted for good. This can't be undone.`,
        confirmLabel: 'Delete permanently',
        tone: 'danger',
      });
      if (!permanent) return;
    }
    if (action === 'delete' && !inTrash && !trash) {
      toast.error('Your mailbox has no Trash folder, so nothing was deleted. Create a folder called Trash (in your webmail), then try again.');
      return;
    }
    const chosen = new Set(uids);
    setBusy(true);
    try {
      if (action === 'read' || action === 'unread') {
        const seen = action === 'read';
        await setFlags(folder, uids, { seen });
        const changed = items.filter((m) => chosen.has(m.uid) && m.seen !== seen).length;
        setItems((prev) => prev.map((m) => (chosen.has(m.uid) ? { ...m, seen } : m)));
        setFolders((prev) => prev.map((f) => (f.path === folder ? { ...f, unread: Math.max(0, f.unread + (seen ? -changed : changed)) } : f)));
        if (open && chosen.has(open.uid)) {
          if (seen) setOpen({ ...open, seen });
          else closeReader(); // marked unread: back to the list
        }
      } else if (action === 'flag' || action === 'unflag') {
        const flagged = action === 'flag';
        await setFlags(folder, uids, { flagged });
        setItems((prev) => prev.map((m) => (chosen.has(m.uid) ? { ...m, flagged } : m)));
        if (open && chosen.has(open.uid)) setOpen({ ...open, flagged });
      } else {
        if (action === 'move') {
          await moveMessages(folder, uids, to!);
          toast.success(`Moved ${plural(uids.length, 'email')} to ${folders.find((f) => f.path === to)?.name || to}.`);
        } else {
          const res = await deleteMessages(folder, uids, permanent);
          toast.success(res.permanent ? `Deleted ${plural(uids.length, 'email')} permanently.` : `Moved ${plural(uids.length, 'email')} to Trash.`);
        }
        const index = openUid !== null ? items.findIndex((m) => m.uid === openUid) : -1;
        const remaining = items.filter((m) => !chosen.has(m.uid));
        setItems(remaining);
        if (openUid !== null && chosen.has(openUid)) {
          const after = items.slice(index + 1).find((m) => !chosen.has(m.uid));
          const before = [...items.slice(0, Math.max(0, index))].reverse().find((m) => !chosen.has(m.uid));
          const next = after || before;
          if (next) openMessage(next);
          else closeReader();
        }
        // gone from this folder: no longer selected (read and flag changes keep the selection)
        setSelected((prev) => new Set([...prev].filter((uid) => !chosen.has(uid))));
        loadFolders();
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  // keyboard shortcuts: j / k next / previous, r reply, e archive, # delete (not while typing or writing an email)
  const keys = useRef<(e: KeyboardEvent) => void>(() => {});
  keys.current = (e: KeyboardEvent) => {
    if (compose || editing || e.ctrlKey || e.metaKey || e.altKey || typingIn(e.target)) return;
    const index = openUid !== null ? items.findIndex((m) => m.uid === openUid) : -1;
    if (e.key === 'j' || e.key === 'k') {
      const next = e.key === 'j' ? items[index + 1] : index > 0 ? items[index - 1] : undefined;
      if (next) {
        e.preventDefault();
        openMessage(next);
      }
    } else if (e.key === 'r' && open) {
      e.preventDefault();
      respond('reply');
    } else if (e.key === 'e' && open && archive && folder !== archive) {
      e.preventDefault();
      act([open.uid], 'move', archive);
    } else if (e.key === '#') {
      const uids = selected.size ? [...selected] : open ? [open.uid] : [];
      if (uids.length) {
        e.preventDefault();
        act(uids, 'delete');
      }
    }
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const clearSearch = () => {
    setQuery('');
    setFilters({});
    setShowFilters(false);
    setSearch(null);
  };

  const runSearch = (e?: FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    const next: SearchFilters = { ...(q ? { q } : {}), ...filters };
    if (!q && !next.unread && !next.attachments && !next.since && !next.before) {
      clearSearch();
      return;
    }
    setSearch(next);
  };

  if (editing) {
    return (
      <MailboxConnect
        defaults={defaults}
        account={account}
        onCancel={() => setEditing(false)}
        onConnected={(saved) => {
          setEditing(false);
          onChanged(saved);
        }}
      />
    );
  }

  const current = folders.find((f) => f.path === folder);
  // (writing happens in its own window, so the list and the email stay as they are)
  const reading = openUid !== null;
  const chosen = items.filter((m) => selected.has(m.uid));
  const allSelected = items.length > 0 && chosen.length === items.length;
  const allFlagged = chosen.length > 0 && chosen.every((m) => m.flagged);
  const toggle = (uid: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });

  const runRowAction = (e: React.MouseEvent, run: () => void) => {
    e.stopPropagation();
    run();
  };

  // Gmail-like: the mailbox fills the screen below where it starts, and the folders, the list and the email each scroll
  // on their own, so an email (or a new message) never opens out of sight
  return (
    <div ref={frame} style={{ height: frameHeight }} className="flex flex-col gap-3 min-h-[520px]">
      {/* the bar: whose mailbox, search (this folder), refresh / settings / disconnect */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0 md:w-56 shrink-0">
          <MailAvatar name={account.email} />
          <div className="min-w-0">
            <div className="text-[13px] font-bold text-ink truncate">{account.email}</div>
            <div className="text-[11px] text-muted-foreground truncate">{account.imap_host}</div>
          </div>
        </div>

        <form role="search" onSubmit={runSearch} className="relative flex-1 min-w-[220px] order-last md:order-none basis-full md:basis-auto">
          <div className="flex items-center gap-1 rounded-full bg-secondary px-3 py-1.5 focus-within:bg-white focus-within:ring-1 focus-within:ring-border focus-within:shadow-sm">
            <Search className="w-4 h-4 shrink-0 text-subtle" aria-hidden />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              maxLength={200}
              placeholder={`Search ${current?.name || 'this folder'}`}
              aria-label="Search mail"
              className="flex-1 min-w-0 bg-transparent px-1.5 py-0.5 text-[12.5px] text-ink outline-none"
            />
            {(query || search) && (
              <button type="button" onClick={clearSearch} aria-label="Clear search" className="p-1 rounded-full hover:bg-border">
                <X className="w-3.5 h-3.5 text-muted-foreground" aria-hidden />
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-label="Search filters"
              title="Search filters"
              className={`p-1 rounded-full hover:bg-border ${showFilters ? 'bg-border' : ''}`}
            >
              <SlidersHorizontal className="w-4 h-4 text-muted-foreground" aria-hidden />
            </button>
          </div>
          {showFilters && (
            <div className="absolute z-20 left-0 right-0 mt-1 rounded-tile border border-border bg-white shadow-lg p-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[12px] text-ink">
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={!!filters.unread} onChange={(e) => setFilters({ ...filters, unread: e.target.checked })} />
                Unread only
              </label>
              <label className="inline-flex items-center gap-1.5">
                <input type="checkbox" checked={!!filters.attachments} onChange={(e) => setFilters({ ...filters, attachments: e.target.checked })} />
                Has attachments
              </label>
              <label className="inline-flex items-center gap-1.5">
                From
                <input
                  type="date"
                  aria-label="From date"
                  value={filters.since || ''}
                  onChange={(e) => setFilters({ ...filters, since: e.target.value || undefined })}
                  className="rounded border border-border px-1.5 py-0.5"
                />
              </label>
              <label className="inline-flex items-center gap-1.5">
                To
                <input
                  type="date"
                  aria-label="To date"
                  value={filters.before || ''}
                  onChange={(e) => setFilters({ ...filters, before: e.target.value || undefined })}
                  className="rounded border border-border px-1.5 py-0.5"
                />
              </label>
              <Button type="submit" className="ml-auto !px-3 !py-1">
                Search
              </Button>
            </div>
          )}
        </form>

        <div className="flex items-center gap-0.5 ml-auto md:ml-0">
          <IconButton label="Refresh" onClick={refresh} disabled={listLoading}>
            <RefreshCw className={`w-4 h-4 ${listLoading ? 'animate-spin' : ''}`} aria-hidden />
          </IconButton>
          <span title={SHORTCUTS_HELP} aria-label={SHORTCUTS_HELP} className="hidden md:inline-flex p-2 text-muted-foreground cursor-help">
            <Keyboard className="w-4 h-4" aria-hidden />
          </span>
          <IconButton label="Settings" onClick={() => setEditing(true)}>
            <Settings className="w-4 h-4" aria-hidden />
          </IconButton>
          <IconButton label="Disconnect" onClick={disconnect}>
            <Unplug className="w-4 h-4" aria-hidden />
          </IconButton>
        </div>
      </div>

      <Card padding="none" className="flex flex-1 min-h-0 overflow-hidden">
        {/* folders, with the big New message button on top (Gmail's Compose) */}
        <div className="hidden md:flex flex-col w-56 shrink-0 border-r border-border min-h-0">
          <div className="p-3 shrink-0">
            <button
              type="button"
              onClick={() => startCompose(newDraft())}
              className="inline-flex items-center gap-3 rounded-2xl bg-brand/10 hover:bg-brand/15 hover:shadow-md transition-shadow px-5 py-3.5 text-[13px] font-semibold text-ink"
            >
              <PenSquare className="w-5 h-5 text-brand" aria-hidden />
              New message
            </button>
          </div>
          <nav className="flex-1 min-h-0 overflow-y-auto pr-3 pb-3 space-y-0.5" aria-label="Folders">
            {folders.map((f) => {
              const Icon = (f.special && FOLDER_ICONS[f.special]) || Folder;
              const active = f.path === folder;
              return (
                <button
                  key={f.path}
                  type="button"
                  onClick={() => chooseFolder(f.path)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full flex items-center gap-3 pl-5 pr-3 py-1.5 rounded-r-full text-[13px] text-left ${
                    active ? 'bg-brand/15 font-bold text-ink' : 'text-ink/80 hover:bg-secondary'
                  }`}
                >
                  <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-brand' : 'text-muted-foreground'}`} aria-hidden />
                  <span className="truncate flex-1">{f.name}</span>
                  {f.unread > 0 && <span className={`text-[11.5px] ${active ? 'font-bold text-ink' : 'font-semibold text-ink/80'}`}>{f.unread}</span>}
                </button>
              );
            })}
          </nav>
        </div>

        {/* the list */}
        <section
          className={`${reading ? 'hidden md:flex' : 'flex'} flex-col w-full md:w-[22rem] lg:w-[26rem] shrink-0 border-r border-border min-h-0`}
          aria-label={current ? `${current.name} messages` : 'Messages'}
        >
          {/* phones: a folder picker and New message above the list */}
          <div className="md:hidden flex items-center gap-2 p-2 border-b border-border shrink-0">
            <select
              className="flex-1 min-w-0 rounded-tile border border-border bg-white px-3 py-2 text-[12.5px] text-ink"
              value={folder}
              onChange={(e) => chooseFolder(e.target.value)}
              aria-label="Folder"
            >
              {(folders.length ? folders : [{ path: 'INBOX', name: 'Inbox', unread: 0 } as MailFolder]).map((f) => (
                <option key={f.path} value={f.path}>
                  {f.name}
                  {f.unread ? ` (${f.unread})` : ''}
                </option>
              ))}
            </select>
            <IconButton label="Write a new message" onClick={() => startCompose(newDraft())}>
              <PenSquare className="w-4 h-4 text-brand" aria-hidden />
            </IconButton>
          </div>

          {search && (
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border bg-secondary/60 text-[11.5px] shrink-0">
              <button type="button" onClick={clearSearch} className="inline-flex items-center gap-1 font-semibold text-brand hover:underline">
                <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
                Back to {current?.name || 'folder'}
              </button>
              <span className="ml-auto text-muted-foreground" role="status">
                {searchTotal ? `${searchTotal.capped ? 'The newest ' : ''}${plural(searchTotal.total, 'result')}` : 'Searching…'}
              </span>
            </div>
          )}

          {/* selecting: the toolbar (always there, so the list never jumps) */}
          {items.length > 0 && !error && (
            <div className="flex items-center gap-1 px-2 py-1.5 border-b border-border min-h-[42px] shrink-0" role="toolbar" aria-label="Selected emails">
              <input
                type="checkbox"
                className="mx-1.5"
                checked={allSelected}
                onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((m) => m.uid)))}
                aria-label="Select all"
              />
              {chosen.length === 0 ? (
                <span className="text-[11.5px] text-muted-foreground truncate">Select emails to act on several at once</span>
              ) : (
                <>
                  <span className="text-[11.5px] font-semibold text-ink mr-1 whitespace-nowrap">{chosen.length} selected</span>
                  <ToolButton label="Mark read" icon={<Mail className="w-4 h-4" />} onClick={() => act([...selected], 'read')} disabled={busy} />
                  <ToolButton label="Mark unread" icon={<MailOpen className="w-4 h-4" />} onClick={() => act([...selected], 'unread')} disabled={busy} />
                  <ToolButton
                    label={allFlagged ? 'Unflag' : 'Flag'}
                    icon={<Flag className="w-4 h-4" />}
                    onClick={() => act([...selected], allFlagged ? 'unflag' : 'flag')}
                    disabled={busy}
                  />
                  {moveTargets.length > 0 && (
                    <select
                      className="max-w-[8rem] rounded-tile border border-border bg-white px-1.5 py-1 text-[11.5px] text-ink"
                      aria-label="Move to…"
                      value=""
                      disabled={busy}
                      onChange={(e) => e.target.value && act([...selected], 'move', e.target.value)}
                    >
                      <option value="">Move to…</option>
                      {moveTargets.map((f) => (
                        <option key={f.path} value={f.path}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  )}
                  <ToolButton label="Delete" icon={<Trash2 className="w-4 h-4" />} onClick={() => act([...selected], 'delete')} disabled={busy} />
                </>
              )}
            </div>
          )}

          {error ? (
            <EmptyState icon={<AlertTriangle className="w-5 h-5" />} title="Your mail could not be loaded" description={error} action={<Button variant="secondary" onClick={refresh}>Try again</Button>} />
          ) : !listLoading && items.length === 0 ? (
            <EmptyState icon={<Mail className="w-5 h-5" />} title={search ? 'No emails match' : 'No emails here'} className="m-auto" />
          ) : (
            <ul className="flex-1 min-h-0 overflow-y-auto">
              {items.map((m) => {
                const sender = m.from ? m.from.name || m.from.address : '(unknown sender)';
                const subject = m.subject || '(no subject)';
                const isOpen = m.uid === openUid;
                return (
                  <li
                    key={m.uid}
                    className={`group relative flex items-start gap-1 border-b border-border/70 ${
                      isOpen ? 'bg-brand/10' : selected.has(m.uid) ? 'bg-secondary' : m.seen ? 'bg-white' : 'bg-white'
                    } hover:shadow-[inset_1px_0_0_rgb(0_0_0/0.06),inset_-1px_0_0_rgb(0_0_0/0.06),0_1px_2px_rgb(0_0_0/0.08)] hover:z-[1]`}
                  >
                    {isOpen && <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-brand" aria-hidden />}
                    <input
                      type="checkbox"
                      className="mt-3.5 ml-3 shrink-0"
                      checked={selected.has(m.uid)}
                      onChange={() => toggle(m.uid)}
                      aria-label={`Select ${subject}`}
                    />
                    <button
                      type="button"
                      onClick={() => openMessage(m)}
                      aria-current={isOpen ? 'true' : undefined}
                      className="flex-1 min-w-0 flex items-start gap-2.5 text-left pl-1.5 pr-2 py-2.5"
                    >
                      <MailAvatar name={sender} small />
                      <span className="flex-1 min-w-0">
                        <span className="flex items-center gap-2">
                          {!m.seen && <span className="w-2 h-2 rounded-full bg-brand shrink-0" aria-label="Unread" />}
                          <span className={`flex-1 truncate text-[12.5px] ${m.seen ? 'text-ink/80' : 'font-bold text-ink'}`}>{sender}</span>
                          {m.has_attachments && <Paperclip className="w-3.5 h-3.5 text-muted-foreground shrink-0" aria-label="Has attachments" />}
                          <span className={`text-[11px] shrink-0 group-hover:invisible ${m.seen ? 'text-muted-foreground' : 'font-bold text-ink'}`}>{listDate(m.date)}</span>
                        </span>
                        <span className={`block truncate text-[12px] mt-0.5 ${m.seen ? 'text-muted-foreground' : 'font-bold text-ink'}`}>{subject}</span>
                      </span>
                    </button>
                    {/* on hover, like Gmail: archive, delete, read / unread (the date makes room) */}
                    <div className="absolute right-9 top-1.5 hidden group-hover:flex items-center bg-white/95 rounded-full">
                      {archive && folder !== archive && (
                        <RowAction label={`Archive ${subject}`} onClick={(e) => runRowAction(e, () => act([m.uid], 'move', archive))} disabled={busy}>
                          <Archive className="w-4 h-4" aria-hidden />
                        </RowAction>
                      )}
                      <RowAction label={`Delete ${subject}`} onClick={(e) => runRowAction(e, () => act([m.uid], 'delete'))} disabled={busy}>
                        <Trash2 className="w-4 h-4" aria-hidden />
                      </RowAction>
                      <RowAction
                        label={m.seen ? `Mark ${subject} unread` : `Mark ${subject} read`}
                        onClick={(e) => runRowAction(e, () => act([m.uid], m.seen ? 'unread' : 'read'))}
                        disabled={busy}
                      >
                        {m.seen ? <Mail className="w-4 h-4" aria-hidden /> : <MailOpen className="w-4 h-4" aria-hidden />}
                      </RowAction>
                    </div>
                    <button
                      type="button"
                      onClick={() => act([m.uid], m.flagged ? 'unflag' : 'flag')}
                      disabled={busy}
                      aria-pressed={m.flagged}
                      aria-label={`${m.flagged ? 'Unflag' : 'Flag'} ${subject}`}
                      title={m.flagged ? 'Unflag' : 'Flag'}
                      className="shrink-0 mt-2 mr-2 p-1 rounded-full hover:bg-secondary disabled:opacity-50"
                    >
                      <Star className={`w-4 h-4 ${m.flagged ? 'fill-current text-status-warning' : 'text-subtle'}`} aria-hidden />
                    </button>
                  </li>
                );
              })}
              {(listLoading || hasMore) && (
                <li className="p-3 text-center">
                  {listLoading ? (
                    <Loader2 className="w-4 h-4 animate-spin inline text-muted-foreground" aria-label="Loading" />
                  ) : (
                    <Button variant="secondary" onClick={() => loadMessages(page + 1)}>
                      {search ? 'More results' : 'Load older emails'}
                    </Button>
                  )}
                </li>
              )}
            </ul>
          )}
        </section>

        {/* the email */}
        <section className={`${reading ? 'flex' : 'hidden md:flex'} flex-col flex-1 min-w-0 min-h-0`} aria-label="Email">
          {opening ? (
            <EmptyState icon={<Loader2 className="w-5 h-5 animate-spin" />} title="Opening the email…" className="m-auto" />
          ) : open ? (
            <MailReader
              message={open}
              onBack={closeReader}
              onRespond={respond}
              actions={{
                busy,
                moveTargets,
                onToggleFlag: () => act([open.uid], open.flagged ? 'unflag' : 'flag'),
                onMarkUnread: () => act([open.uid], 'unread'),
                onDelete: () => act([open.uid], 'delete'),
                onMove: (to) => act([open.uid], 'move', to),
                ...(archive && folder !== archive ? { onArchive: () => act([open.uid], 'move', archive) } : {}),
              }}
            />
          ) : (
            <EmptyState icon={<Mail className="w-5 h-5" />} title="Choose an email to read it" description={current ? `${current.name}${current.unread ? ` · ${current.unread} unread` : ''}` : undefined} className="m-auto" />
          )}
        </section>
      </Card>

      {/* writing: a window over the bottom right (full screen on a phone), so the list and the email stay in view */}
      {compose && <MailCompose key={composeKey} account={account} draft={compose} onClose={() => setCompose(null)} onSent={sent} />}
    </div>
  );
}

/** A toolbar button: icon and words, the words hidden on a phone (still its name). */
function ToolButton({ label, icon, onClick, disabled }: { label: string; icon: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="inline-flex items-center gap-1 px-2 py-1 rounded-tile text-[11.5px] font-semibold text-ink hover:bg-secondary disabled:opacity-50"
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

/** An icon-only button with its name as a tooltip (the bar above the mailbox, phones' New message). */
function IconButton({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="p-2 rounded-full text-muted-foreground hover:bg-secondary hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** A row's quick action, shown when the pointer is over the row. */
function RowAction({ label, onClick, disabled, children }: { label: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label.split(' ')[0] === 'Mark' ? label.replace(/^Mark .* (read|unread)$/, 'Mark $1') : label.split(' ')[0]}
      className="p-1.5 rounded-full text-muted-foreground hover:bg-secondary hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * The mailbox's height: from where it starts down to the bottom of the window (at least 520px), measured again when
 * the window is resized, so the page itself doesn't scroll and each column scrolls on its own.
 */
function useFillHeight(remeasure: unknown, bottomGap = 16) {
  const frame = useRef<HTMLDivElement>(null);
  const [frameHeight, setFrameHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const measure = () => {
      const el = frame.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setFrameHeight(Math.max(520, Math.floor(window.innerHeight - top - bottomGap)));
    };
    measure();
    // again once the page around it has settled (fonts, the tabs above)
    const later = window.setTimeout(measure, 200);
    window.addEventListener('resize', measure);
    return () => {
      window.clearTimeout(later);
      window.removeEventListener('resize', measure);
    };
  }, [remeasure, bottomGap]);
  return { frame, frameHeight };
}
