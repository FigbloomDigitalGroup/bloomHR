import { useMemo, useRef, useState } from 'react';
import { insertMention, mentionQuery } from '../../lib/tasks';

export interface MentionPerson {
  number: string;
  name: string;
  detail?: string;
}

interface MentionInputProps {
  value: string;
  onChange: (text: string) => void;
  /** someone picked from the list (their "@Name" is now in the text) */
  onMention: (p: MentionPerson) => void;
  people: MentionPerson[];
  placeholder?: string;
  disabled?: boolean;
  onSubmit?: () => void;
}

/** A comment box: typing "@" and a few letters offers matching people; Enter or a click picks one. */
export default function MentionInput({ value, onChange, onMention, people, placeholder, disabled, onSubmit }: MentionInputProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState<{ query: string; start: number } | null>(null);
  const [active, setActive] = useState(0);

  const matches = useMemo(() => {
    if (!query) return [];
    const q = query.query.toLowerCase();
    return people.filter((p) => !q || p.name.toLowerCase().split(/\s+/).some((w) => w.startsWith(q)) || p.name.toLowerCase().startsWith(q)).slice(0, 6);
  }, [people, query]);

  const update = (text: string, caret: number) => {
    onChange(text);
    setQuery(mentionQuery(text, caret));
    setActive(0);
  };

  const pick = (p: MentionPerson) => {
    const el = ref.current;
    if (!query || !el) return;
    const next = insertMention(value, query.start, el.selectionStart ?? value.length, p.name);
    onChange(next.text);
    onMention(p);
    setQuery(null);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(next.caret, next.caret);
    });
  };

  return (
    <div className="relative">
      <textarea
        ref={ref}
        aria-label="Comment"
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => update(e.target.value, e.target.selectionStart ?? e.target.value.length)}
        onKeyDown={(e) => {
          if (matches.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => (a + 1) % matches.length); return; }
            if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => (a - 1 + matches.length) % matches.length); return; }
            if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pick(matches[active]); return; }
            if (e.key === 'Escape') { e.stopPropagation(); setQuery(null); return; }
          }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) { e.preventDefault(); onSubmit(); }
        }}
        className="w-full px-3 py-2 text-xs border border-border rounded-tile bg-white text-ink outline-none focus:border-brand resize-y"
      />
      {matches.length > 0 && (
        <ul role="listbox" aria-label="People to mention" className="absolute z-20 left-2 bottom-full mb-1 w-64 bg-white border border-border rounded-tile shadow-lg py-1">
          {matches.map((p, i) => (
            <li key={p.number}>
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => { e.preventDefault(); pick(p); }}
                className={`w-full text-left px-3 py-1.5 text-xs ${i === active ? 'bg-secondary' : ''}`}
              >
                <span className="text-ink">{p.name}</span>
                {p.detail && <span className="ml-1 text-muted-foreground">{p.detail}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
