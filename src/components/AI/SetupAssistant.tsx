import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Send, Sparkles } from 'lucide-react';
import { Button, Card, EmptyState, PageHeader } from '../UI';
import FigbloomLoader from '../UI/FigbloomLoader';
import { usePermissions } from '../../hooks/usePermissions';
import { COMPANY_PROFILE_SAVED } from '../Dashboard/GetStarted';
import { askSetup, type AISetupMessage } from '../../services/ai';
import {
  applyProposal,
  describeProposal,
  loadSetupState,
  setupSummary,
  whatIsNew,
  type SetupProposal,
  type SetupState,
} from '../../lib/setupAssistant';

type ProposalStatus = 'pending' | 'applying' | 'applied' | 'skipped' | 'failed';

interface Proposal {
  proposal: SetupProposal;
  status: ProposalStatus;
  /** what applying did, or why it was refused */
  note?: string;
}

interface Turn {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  proposals: Proposal[];
}

const STARTERS = ['Start with our company details', 'Suggest departments for us', 'Set up employee numbers', 'Invite my team', 'Add employees'];
const MAX_TURNS_SENT = 20; // the server takes at most 20 messages

/** The conversation as the server takes it: the AI's turns as the JSON it gave, with what became of each proposal. */
function toMessages(turns: Turn[]): AISetupMessage[] {
  return turns.slice(-MAX_TURNS_SENT).map((t) =>
    t.role === 'user'
      ? { role: 'user', content: t.content }
      : {
          role: 'assistant',
          content: JSON.stringify({
            reply: t.content,
            proposals: t.proposals.map((p) => ({ ...p.proposal, status: p.status === 'applied' || p.status === 'skipped' ? p.status : 'pending' })),
          }),
        }
  );
}

/** Set a company up by chatting: the AI asks about the business and proposes changes; each is applied with a click. */
export default function SetupAssistant() {
  const { hasPermission, loading: permissionsLoading } = usePermissions();
  const canUse = !permissionsLoading && hasPermission('settings');
  const [state, setState] = useState<SetupState | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState('');
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);

  const reload = useCallback(async () => {
    const s = await loadSetupState();
    setState(s);
    return s;
  }, []);

  useEffect(() => {
    if (!canUse) return;
    reload().then((s) => {
      setTurns((t) =>
        t.length
          ? t
          : [
              {
                id: nextId.current++,
                role: 'assistant',
                content: `Hi! I'll help you set up ${s.companyName || 'your company'}. Tell me about the business: what it does, where it is, and roughly how many people work there. I'll suggest a set-up you can apply one step at a time.`,
                proposals: [],
              },
            ]
      );
    });
  }, [canUse, reload]);

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' });
  }, [turns, asking]);

  const send = async (text: string) => {
    const content = text.trim();
    if (!content || asking || !state) return;
    const asked: Turn = { id: nextId.current++, role: 'user', content, proposals: [] };
    const conversation = [...turns, asked];
    setTurns(conversation);
    setDraft('');
    setError(null);
    setAsking(true);
    try {
      const answer = await askSetup(toMessages(conversation), setupSummary(state));
      setTurns((t) => [
        ...t,
        { id: nextId.current++, role: 'assistant', content: answer.reply, proposals: answer.proposals.map((proposal) => ({ proposal, status: 'pending' })) },
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The AI could not answer.');
    } finally {
      setAsking(false);
    }
  };

  const setStatus = (turnId: number, index: number, status: ProposalStatus, note?: string) =>
    setTurns((all) =>
      all.map((t) => (t.id === turnId ? { ...t, proposals: t.proposals.map((p, i) => (i === index ? { ...p, status, note } : p)) } : t))
    );

  const apply = async (turnId: number, index: number, proposal: SetupProposal) => {
    if (!state) return;
    const fresh = whatIsNew(proposal, state);
    if (!fresh) return setStatus(turnId, index, 'applied', 'Already set up.');
    setStatus(turnId, index, 'applying');
    try {
      const note = await applyProposal(fresh, state);
      setStatus(turnId, index, 'applied', note);
      if (fresh.type === 'profile') window.dispatchEvent(new Event(COMPANY_PROFILE_SAVED));
    } catch (err) {
      setStatus(turnId, index, 'failed', err instanceof Error ? err.message : 'That was not saved.');
    }
    await reload();
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void send(draft);
  };

  if (permissionsLoading) return <FigbloomLoader />;
  if (!canUse) {
    return (
      <div className="p-4 md:p-6">
        <EmptyState icon={<Sparkles className="w-5 h-5" />} title="Set up with AI" description="Only administrators and people with Settings can set the company up." />
      </div>
    );
  }

  const last = turns[turns.length - 1];
  const allDecided = last?.role === 'assistant' && last.proposals.length > 0 && last.proposals.every((p) => p.status === 'applied' || p.status === 'skipped');

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <PageHeader
        title="Set up with AI"
        subtitle="Chat about your business and apply the suggested set-up one step at a time. Nothing changes until you click a button."
      />
      <Card padding="none" className="flex flex-col overflow-hidden">
        <div className="flex-1 min-h-[320px] max-h-[65vh] overflow-y-auto p-4 space-y-4" aria-live="polite">
          {!state && <FigbloomLoader />}
          {turns.map((t) => (
            <div key={t.id} className={`flex ${t.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[90%] md:max-w-[80%] space-y-2 ${t.role === 'user' ? 'items-end' : ''}`}>
                <div
                  className={`whitespace-pre-wrap rounded-2xl px-4 py-3 text-[13px] leading-relaxed ${
                    t.role === 'user' ? 'bg-brand text-white rounded-br-none' : 'bg-background text-ink border border-border rounded-bl-none'
                  }`}
                >
                  {t.content}
                </div>
                {state &&
                  t.proposals.map((p, i) => (
                    <ProposalCard
                      key={i}
                      item={p}
                      state={state}
                      onApply={() => apply(t.id, i, p.proposal)}
                      onSkip={() => setStatus(t.id, i, 'skipped')}
                    />
                  ))}
              </div>
            </div>
          ))}
          {asking && (
            <div className="flex gap-1.5 px-2" aria-label="The AI is thinking">
              {[0, 200, 400].map((d) => (
                <span key={d} className="w-2 h-2 bg-brand rounded-full animate-pulse" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          )}
          <div ref={bottom} />
        </div>

        <div className="border-t border-border p-3 space-y-2">
          {error && <p className="m-0 text-[12px] text-status-danger">{error}</p>}
          {state && (turns.length <= 1 || allDecided) && !asking && (
            <div className="flex flex-wrap gap-2">
              {(allDecided ? ["Done with those. What's next?"] : STARTERS).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-pill border border-border bg-white px-3 py-1.5 text-[12px] font-semibold text-ink hover:bg-secondary"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={submit} className="flex gap-2">
            {/* a text area, so a pasted list of people keeps its lines; Enter sends, Shift+Enter starts a new line */}
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(draft);
                }
              }}
              placeholder="Tell me about your company, or paste a list of people to add…"
              aria-label="Message"
              maxLength={20000}
              rows={draft.includes('\n') ? 4 : 1}
              disabled={!state}
              className="flex-1 min-w-0 resize-none rounded-tile border border-border bg-white px-3 py-2 text-[13px] text-ink outline-none focus:border-brand"
            />
            <Button type="submit" disabled={!draft.trim() || asking || !state} icon={<Send className="w-4 h-4" />} aria-label="Send">
              <span className="hidden sm:inline">Send</span>
            </Button>
          </form>
          <p className="m-0 text-[11px] text-subtle">
            Suggestions come from AI; check them before applying. You can change anything later in Settings, or{' '}
            <Link to="/departments" className="text-brand font-semibold">
              set it up by hand
            </Link>
            .
          </p>
        </div>
      </Card>
    </div>
  );
}

function ProposalCard({ item, state, onApply, onSkip }: { item: Proposal; state: SetupState; onApply: () => void; onSkip: () => void }) {
  const decided = item.status === 'applied' || item.status === 'skipped';
  // while it waits, show only what the company does not have yet; once decided, show what was proposed
  const shown = decided ? item.proposal : whatIsNew(item.proposal, state);
  const view = describeProposal(shown ?? item.proposal, state);

  return (
    <div className="rounded-card border border-border bg-white p-3 space-y-2 text-[12.5px]" data-testid="setup-proposal">
      <div className="flex items-center justify-between gap-2">
        <span className="font-bold text-ink">{view.title}</span>
        {item.status === 'applied' && (
          <span className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-brand">
            <Check className="w-3.5 h-3.5" aria-hidden /> Applied
          </span>
        )}
        {item.status === 'skipped' && <span className="text-[11.5px] font-semibold text-muted-foreground">Skipped</span>}
      </div>
      {view.lines.length > 0 && (
        <ul className="m-0 pl-4 space-y-0.5 list-disc text-ink">
          {view.lines.map((l, i) => (
            <li key={i}>
              {l.text}
              {l.was && !decided && <span className="text-muted-foreground"> (now {l.was})</span>}
            </li>
          ))}
        </ul>
      )}
      {view.table && (
        <div className="max-h-72 overflow-auto rounded-tile border border-border">
          <table className="w-full text-left text-[12px]">
            <thead className="sticky top-0 bg-background">
              <tr>
                {view.table.columns.map((c) => (
                  <th key={c} scope="col" className="whitespace-nowrap px-2 py-1.5 font-semibold text-muted-foreground">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {view.table.rows.map((row, r) => (
                <tr key={r} className="border-t border-border">
                  {row.map((cell, c) => (
                    <td key={c} className="whitespace-nowrap px-2 py-1.5 text-ink">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view.problems && !decided && (
        <ul className="m-0 pl-4 space-y-0.5 list-disc text-[11.5px] text-status-danger" aria-label="Fix these first">
          {view.problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {view.note && !decided && <p className="m-0 text-[11.5px] text-muted-foreground">{view.note}</p>}
      {item.note && <p className={`m-0 text-[11.5px] ${item.status === 'failed' ? 'text-status-danger' : 'text-muted-foreground'}`}>{item.note}</p>}
      {!decided &&
        (shown ? (
          <div className="flex gap-2">
            <Button onClick={onApply} disabled={item.status === 'applying' || !!view.problems?.length}>
              {item.status === 'applying' ? 'Saving…' : item.status === 'failed' ? 'Try again' : view.applyLabel}
            </Button>
            <Button variant="ghost" onClick={onSkip} disabled={item.status === 'applying'}>
              Skip
            </Button>
          </div>
        ) : (
          <p className="m-0 text-[11.5px] text-muted-foreground">Already set up.</p>
        ))}
    </div>
  );
}
