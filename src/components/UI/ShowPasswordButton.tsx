import { Eye, EyeOff } from 'lucide-react';

/** The eye at the end of a password field: shows or hides what was typed. Place it inside a `relative` wrapper. */
export default function ShowPasswordButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={shown ? 'Hide password' : 'Show password'}
      aria-pressed={shown}
      className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-700 focus:outline-none focus-visible:text-gray-900"
    >
      {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
    </button>
  );
}
