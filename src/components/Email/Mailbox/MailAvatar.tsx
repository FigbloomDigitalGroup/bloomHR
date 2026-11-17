/** A round initial for a person: the sender in the list and the reading pane, the mailbox's owner in the bar. */
export default function MailAvatar({ name, small }: { name: string; small?: boolean }) {
  const letter = (name.replace(/^["'\s]+/, '').match(/[\p{L}\p{N}]/u)?.[0] ?? '?').toUpperCase();
  return (
    <span
      aria-hidden
      className={`shrink-0 inline-flex items-center justify-center rounded-full bg-brand/15 text-brand font-bold ${small ? 'w-8 h-8 text-[12px]' : 'w-9 h-9 text-[13px]'}`}
    >
      {letter}
    </span>
  );
}
