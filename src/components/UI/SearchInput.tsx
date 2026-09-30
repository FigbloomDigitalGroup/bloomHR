import { InputHTMLAttributes } from 'react';
import { Search } from 'lucide-react';

interface SearchInputProps extends InputHTMLAttributes<HTMLInputElement> {
  variant?: 'light' | 'dark';
}

export default function SearchInput({ variant = 'light', className = '', ...rest }: SearchInputProps) {
  const isDark = variant === 'dark';
  return (
    <label className="relative block">
      <Search
        className={`absolute left-[11px] top-1/2 -translate-y-1/2 w-3.5 h-3.5 ${
          isDark ? 'text-white/45' : 'text-subtle'
        }`}
        strokeWidth={2}
      />
      <input
        type="text"
        className={`w-full box-border rounded-tile pl-[30px] pr-3 py-2 text-xs font-[inherit] outline-none transition-colors ${
          isDark
            ? 'bg-white/10 border border-white/10 text-white placeholder-white/40 focus:border-white/30'
            : 'bg-secondary border border-transparent text-ink placeholder-subtle focus:bg-white focus:border-border'
        } ${className}`}
        {...rest}
      />
    </label>
  );
}
