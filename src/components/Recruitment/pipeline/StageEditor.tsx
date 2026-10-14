import { useState } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../UI';
import { Stage, sortStages } from './types';

interface StageEditorProps {
  stages: Stage[];
  onRename: (stage: Stage, name: string) => Promise<void>;
  onAdd: (name: string) => Promise<void>;
  onRemove: (stage: Stage) => Promise<void>;
  onReorder: (ordered: Stage[]) => Promise<void>;
}

/** Rename, add, reorder and remove a pipeline's stages. Hired and Rejected can be renamed but stay. */
export default function StageEditor({ stages, onRename, onAdd, onRemove, onReorder }: StageEditorProps) {
  const ordered = sortStages(stages);
  const [names, setNames] = useState<Record<string, string>>({});
  const [newName, setNewName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const shift = (i: number, by: number) => {
    const next = [...ordered];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    return run(() => onReorder(next));
  };

  return (
    <div className="space-y-3">
      <ul className="space-y-2">
        {ordered.map((stage, i) => {
          const value = names[stage.id] ?? stage.name;
          return (
            <li key={stage.id} className="flex items-center gap-1.5">
              <input
                aria-label={`Stage ${i + 1} name`}
                value={value}
                onChange={(e) => setNames((n) => ({ ...n, [stage.id]: e.target.value }))}
                onBlur={() => value.trim() && value.trim() !== stage.name && run(() => onRename(stage, value))}
                className="flex-1 min-w-0 px-3 py-2 border border-border rounded-tile text-[13px]"
              />
              <button type="button" aria-label={`Move ${stage.name} up`} disabled={busy || i === 0} onClick={() => shift(i, -1)} className="p-1.5 text-subtle hover:text-ink disabled:opacity-40">
                <ArrowUp className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={`Move ${stage.name} down`}
                disabled={busy || i === ordered.length - 1}
                onClick={() => shift(i, 1)}
                className="p-1.5 text-subtle hover:text-ink disabled:opacity-40"
              >
                <ArrowDown className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label={`Remove ${stage.name}`}
                disabled={busy || stage.kind !== 'open'}
                title={stage.kind !== 'open' ? 'Hired and Rejected stay; rename them instead' : undefined}
                onClick={() => run(() => onRemove(stage))}
                className="p-1.5 text-subtle hover:text-status-danger disabled:opacity-40"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex gap-2">
        <input
          aria-label="New stage name"
          placeholder="New stage"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          className="flex-1 min-w-0 px-3 py-2 border border-border rounded-tile text-[13px]"
        />
        <Button
          variant="secondary"
          disabled={busy || !newName.trim()}
          icon={<Plus className="w-3.5 h-3.5" />}
          onClick={() =>
            run(async () => {
              await onAdd(newName);
              setNewName('');
            })
          }
        >
          Add stage
        </Button>
      </div>
      <p className="text-[11.5px] text-subtle">New stages go before Hired and Rejected; move them with the arrows.</p>
      {error && (
        <p role="alert" className="text-[12.5px] text-status-danger">
          {error}
        </p>
      )}
    </div>
  );
}
