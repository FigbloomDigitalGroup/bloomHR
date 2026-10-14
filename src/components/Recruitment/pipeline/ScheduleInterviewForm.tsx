import { FormEvent, useState } from 'react';
import { Button } from '../../UI';
import type { InterviewInput } from './api';
import { CompanyUser, InterviewMode } from './types';

interface ScheduleInterviewFormProps {
  applicationId: string;
  users: CompanyUser[];
  onSubmit: (input: InterviewInput, emailCandidate: boolean) => Promise<void> | void;
  onCancel: () => void;
}

const field = 'mt-1 w-full px-3 py-2 border border-border rounded-tile text-[13px] bg-white';
const labelText = 'text-[12px] font-semibold text-muted-foreground';

/** Schedules an interview: when, how, who sits on the panel, and whether to email the candidate. */
export default function ScheduleInterviewForm({ applicationId, users, onSubmit, onCancel }: ScheduleInterviewFormProps) {
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(30);
  const [mode, setMode] = useState<InterviewMode>('video');
  const [location, setLocation] = useState('');
  const [meetingLink, setMeetingLink] = useState('');
  const [notes, setNotes] = useState('');
  const [panel, setPanel] = useState<string[]>([]);
  const [emailCandidate, setEmailCandidate] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const togglePanelist = (id: string) => setPanel((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const scheduledAt = new Date(`${date}T${time}`);
    if (!date || !time || Number.isNaN(scheduledAt.getTime())) return setError('Pick a date and time');
    setError('');
    setSaving(true);
    try {
      await onSubmit({ applicationId, scheduledAt, durationMinutes: duration, mode, location, meetingLink, notes, panel }, emailCandidate);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3" aria-label="Schedule interview">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className="block">
          <span className={labelText}>Date</span>
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className={labelText}>Time</span>
          <input type="time" required value={time} onChange={(e) => setTime(e.target.value)} className={field} />
        </label>
        <label className="block">
          <span className={labelText}>Duration</span>
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={field}>
            {[30, 45, 60, 90].map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </select>
        </label>
      </div>

      <fieldset className="flex gap-4 text-[13px]">
        <legend className={`${labelText} mb-1`}>Where</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === 'video'} onChange={() => setMode('video')} /> Video link
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="mode" checked={mode === 'in_person'} onChange={() => setMode('in_person')} /> In person
        </label>
      </fieldset>

      {mode === 'video' ? (
        <label className="block">
          <span className={labelText}>Meeting link</span>
          <input type="url" required value={meetingLink} onChange={(e) => setMeetingLink(e.target.value)} className={field} />
        </label>
      ) : (
        <label className="block">
          <span className={labelText}>Location</span>
          <input required value={location} onChange={(e) => setLocation(e.target.value)} className={field} />
        </label>
      )}

      <fieldset>
        <legend className={labelText}>Panel</legend>
        <p className="text-[11.5px] text-subtle mb-1.5">Panelists need the Recruitment module to see the candidate and score.</p>
        <div className="max-h-40 overflow-y-auto border border-border rounded-tile divide-y divide-border">
          {users.map((u) => (
            <label key={u.user_id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
              <input type="checkbox" checked={panel.includes(u.user_id)} onChange={() => togglePanelist(u.user_id)} />
              <span className="truncate">{u.full_name || u.email}</span>
            </label>
          ))}
          {users.length === 0 && <p className="px-3 py-2 text-[12px] text-subtle">No one to add</p>}
        </div>
      </fieldset>

      <label className="block">
        <span className={labelText}>Notes</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className={field} />
      </label>

      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={emailCandidate} onChange={(e) => setEmailCandidate(e.target.checked)} />
        Email the candidate the details
      </label>

      {error && (
        <p role="alert" className="text-[12.5px] text-status-danger">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Schedule'}
        </Button>
      </div>
    </form>
  );
}
