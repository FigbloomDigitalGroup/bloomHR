import { useState } from 'react';
import toast from 'react-hot-toast';
import { Trash2 } from 'lucide-react';
import { Button, Modal } from '../UI';
import { LABEL_COLORS, type TaskLabel } from '../../lib/tasks';
import { deleteLabel, saveLabel } from '../../lib/tasksApi';
import { LabelChip, fieldClass } from './TaskBits';
import { confirmDialog } from '../../lib/confirmDialog';

/** The company's own task labels. */
export default function LabelsModal({ labels, onClose, onChanged }: { labels: TaskLabel[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('blue');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await saveLabel({ name: name.trim(), color });
      setName('');
      onChanged();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Labels" size="md">
      <ul className="flex flex-col gap-1.5 mb-4">
        {labels.map((l) => (
          <li key={l.id} className="flex items-center gap-2">
            <LabelChip label={l} />
            <select
              aria-label={`Colour of ${l.name}`}
              className="ml-auto text-[11px] border border-border rounded-md px-1 py-0.5"
              value={l.color}
              onChange={async (e) => {
                try {
                  await saveLabel({ name: l.name, color: e.target.value }, l.id);
                  onChanged();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              {Object.keys(LABEL_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <button
              type="button"
              aria-label={`Delete ${l.name}`}
              className="p-1 rounded-md hover:bg-secondary"
              onClick={async () => {
                if (!(await confirmDialog({ title: `Delete the label ${l.name}?`, message: 'It is removed from every task.', confirmLabel: 'Delete', tone: 'danger' }))) return;
                try {
                  await deleteLabel(l.id);
                  onChanged();
                } catch (err) {
                  toast.error((err as Error).message);
                }
              }}
            >
              <Trash2 size={13} />
            </button>
          </li>
        ))}
        {labels.length === 0 && <li className="text-xs text-muted-foreground">No labels yet: add the ones your company uses (e.g. Compliance, Client, Urgent).</li>}
      </ul>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(); }}>
        <input aria-label="New label" className={fieldClass} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="New label" />
        <select aria-label="Colour" className="text-xs border border-border rounded-tile px-2" value={color} onChange={(e) => setColor(e.target.value)}>
          {Object.keys(LABEL_COLORS).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <Button type="submit" disabled={busy || !name.trim()}>Add</Button>
      </form>
    </Modal>
  );
}
