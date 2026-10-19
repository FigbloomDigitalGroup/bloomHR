import { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { Settings2, Users } from 'lucide-react';
import { Button, Card, EmptyState, Modal, SearchInput } from '../../UI';
import { supabase } from '../../../lib/supabase';
import { openPrivateFile } from '../../../lib/privateFiles';
import * as api from './api';
import PipelineBoard from './PipelineBoard';
import CandidateView, { isInterviewStage } from './CandidateView';
import StageEditor from './StageEditor';
import { CareersToggle } from '../../Settings/CareersSettings';
import { Candidate, CompanyUser, Interview, Stage, StageMove, candidateName, sortStages } from './types';
import { LoaderBlock } from '../../UI/FigbloomLoader';

const GENERAL = 'general'; // applications with no job posting use the company's default stages

/** The main way into recruitment: pick a job, see its pipeline, open a candidate. */
export default function RecruitmentPipeline() {
  const [postings, setPostings] = useState<api.JobPostingOption[]>([]);
  const [postingKey, setPostingKey] = useState('');
  const [stages, setStages] = useState<Stage[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [users, setUsers] = useState<CompanyUser[]>([]);
  const [me, setMe] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingStages, setEditingStages] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  // the candidate opened because they were just shortlisted: show the Schedule interview form first
  const [scheduleOnOpen, setScheduleOnOpen] = useState(false);
  const [detail, setDetail] = useState<{ candidate: Candidate; history: StageMove[]; interviews: Interview[] } | null>(null);

  const postingId = postingKey === GENERAL ? null : postingKey;

  useEffect(() => {
    (async () => {
      try {
        const [list, people, session] = await Promise.all([api.loadPostings(), api.loadCompanyUsers(), supabase.auth.getUser()]);
        setPostings(list);
        setUsers(people);
        setMe(session.data.user?.id ?? null);
        setPostingKey((key) => key || list.find((p) => p.status === 'open')?.id || list[0]?.id || GENERAL);
      } catch (err) {
        toast.error((err as Error).message);
        setPostingKey(GENERAL);
      }
    })();
  }, []);

  const loadBoard = useCallback(async () => {
    if (!postingKey) return;
    try {
      const [s, c] = await Promise.all([api.loadStages(postingId), api.loadCandidates(postingId)]);
      setStages(s);
      setCandidates(c);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [postingKey, postingId]);

  useEffect(() => {
    setLoading(true);
    loadBoard();
  }, [loadBoard]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      setDetail(await api.loadCandidate(id));
    } catch (err) {
      toast.error((err as Error).message);
    }
  }, []);

  useEffect(() => {
    setDetail(null);
    if (openId) loadDetail(openId);
  }, [openId, loadDetail]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => `${candidateName(c)} ${c.email || ''} ${c.position || ''}`.toLowerCase().includes(q));
  }, [candidates, search]);

  const refresh = async () => {
    await loadBoard();
    if (openId) await loadDetail(openId);
  };

  const withToast = async (work: () => Promise<unknown>, success?: string) => {
    await work();
    if (success) toast.success(success);
    await refresh();
  };

  const posting = postings.find((p) => p.id === postingKey);
  const stageCandidates = (stage: Stage) => candidates.filter((c) => c.current_stage_id === stage.id).length;

  return (
    <div className="space-y-4">
      <Card padding="sm" className="flex flex-col sm:flex-row sm:items-center gap-2">
        <label className="flex-1 min-w-0">
          <span className="sr-only">Job</span>
          <select
            value={postingKey}
            onChange={(e) => setPostingKey(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-tile text-[13px] bg-white"
          >
            {postings.map((p) => (
              <option key={p.id} value={p.id}>
                {p.job_title}
                {p.department ? ` · ${p.department}` : ''}
                {p.status && p.status !== 'open' ? ` (${p.status})` : ''}
              </option>
            ))}
            <option value={GENERAL}>General applications (no job posting)</option>
          </select>
        </label>
        <div className="sm:w-64">
          <SearchInput value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search candidates..." aria-label="Search candidates" />
        </div>
        {posting && (
          <CareersToggle
            posting={{ id: posting.id, job_title: posting.job_title, is_public: !!posting.is_public }}
            onChange={(isPublic) => setPostings((list) => list.map((p) => (p.id === posting.id ? { ...p, is_public: isPublic } : p)))}
          />
        )}
        <Button variant="secondary" onClick={() => setEditingStages(true)} icon={<Settings2 className="w-3.5 h-3.5" />}>
          {postingId ? 'Edit stages' : 'Default stages'}
        </Button>
      </Card>

      {loading ? (
        <LoaderBlock label="Loading the pipeline" compact />
      ) : candidates.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Users className="w-5 h-5" />}
            title="No candidates yet"
            description={posting ? `Applications for ${posting.job_title} will appear here.` : 'Applications will appear here.'}
          />
        </Card>
      ) : (
        <PipelineBoard
          stages={stages}
          candidates={filtered}
          onOpen={(c) => setOpenId(c.id)}
          onMove={async (c, stageId) => {
            try {
              const stage = stages.find((s) => s.id === stageId);
              await withToast(() => api.moveCandidate(c.id, stageId), `${candidateName(c)} moved to ${stage?.name}`);
              // shortlisted: open them with the Schedule interview form ready
              if (isInterviewStage(stage)) {
                setScheduleOnOpen(true);
                setOpenId(c.id);
              }
            } catch (err) {
              toast.error((err as Error).message);
            }
          }}
        />
      )}

      <Modal open={editingStages} onClose={() => setEditingStages(false)} title={postingId ? `Stages for ${posting?.job_title ?? 'this job'}` : 'Default stages'} size="md">
        {!postingId && <p className="text-[12px] text-muted-foreground mb-3">New job postings start with these stages.</p>}
        <StageEditor
          stages={stages}
          onRename={(stage, name) => withToast(() => api.renameStage(stage.id, name))}
          onRemove={(stage) => {
            if (stageCandidates(stage)) return Promise.reject(new Error(`Move the candidates in ${stage.name} to another stage first`));
            return withToast(() => api.removeStage(stage.id));
          }}
          onReorder={(ordered) => withToast(() => api.reorderStages(ordered))}
          onAdd={async (name) => {
            const ordered = sortStages(stages);
            const lastOpen = [...ordered].reverse().find((s) => s.kind === 'open');
            await api.addStage(postingId, name, lastOpen?.position ?? 0);
            // renumber, so the new stage sits after the last open stage and before Hired / Rejected
            await api.reorderStages(sortStages(await api.loadStages(postingId)));
            await refresh();
          }}
        />
      </Modal>

      <Modal open={!!openId} onClose={() => { setOpenId(null); setScheduleOnOpen(false); }} title="Candidate" hideTitle size="5xl" className="bg-background rounded-2xl shadow-xl p-4 sm:p-6">
        {!detail ? (
          <LoaderBlock label="Loading the candidate" compact />
        ) : (
          <CandidateView
            candidate={detail.candidate}
            stages={stages}
            history={detail.history}
            interviews={detail.interviews}
            users={users}
            currentUserId={me}
            startScheduling={scheduleOnOpen}
            onMove={(stageId, note) => withToast(() => api.moveCandidate(detail.candidate.id, stageId, note), 'Moved')}
            onSchedule={async (input, emailCandidate) => {
              await api.saveInterview(input);
              if (emailCandidate) {
                try {
                  await api.sendInterviewEmail(detail.candidate, input);
                  toast.success('Interview saved and email sent');
                } catch (err) {
                  toast.error(`Interview saved, but the email failed: ${(err as Error).message}`);
                }
              } else {
                toast.success('Interview saved');
              }
              await refresh();
            }}
            onInterviewStatus={(id, status) =>
              withToast(() => api.setInterviewStatus(id, status)).catch((err) => {
                toast.error(err.message);
              })
            }
            onScorecard={(id, input) => withToast(() => api.saveScorecard(id, input), 'Scorecard saved')}
            onAddText={(id, title, body) => withToast(() => api.addTextTranscript(id, title, body), 'Transcript saved')}
            onUpload={(id, file) => withToast(() => api.uploadTranscriptFile(id, file), 'File uploaded')}
            onLinkMeeting={async (id, code) => {
              const n = await api.linkMeetingTranscript(id, code);
              toast.success(n ? `Linked ${n} transcript${n === 1 ? '' : 's'}` : 'Already linked');
              await refresh();
            }}
            onOpenFile={(t) => t.file_path && openPrivateFile('interview-transcripts', t.file_path).catch((err) => toast.error(err.message))}
            onOpenCv={() => {
              const stored = detail.candidate.resume_file_url || (detail.candidate.resume_file_name ? `public/${detail.candidate.resume_file_name}` : '');
              if (stored) openPrivateFile('resumes', stored).catch((err) => toast.error(err.message));
            }}
          />
        )}
      </Modal>
    </div>
  );
}
