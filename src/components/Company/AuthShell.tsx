import { ReactNode } from 'react';

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

/** The plain centered card the company sign-up, join and "no company yet" screens share. */
export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="min-h-screen bg-green-tint flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <p className="text-center text-[13px] font-semibold text-brand mb-5">Figbloom HR</p>
        <div className="bg-white border border-border rounded-card p-6">
          <h1 className="text-[20px] font-bold text-ink">{title}</h1>
          {subtitle && <p className="mt-1.5 text-[13px] text-muted-foreground">{subtitle}</p>}
          <div className="mt-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

interface FieldProps {
  label: string;
  type?: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: string;
  readOnly?: boolean;
  placeholder?: string;
}

export function Field({ label, type = 'text', value, onChange, autoComplete, readOnly, placeholder }: FieldProps) {
  return (
    <label className="block">
      <span className="block text-[12px] font-semibold text-muted-foreground mb-1">{label}</span>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`w-full px-3 py-2 rounded-tile border border-border text-[13px] text-ink focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand ${
          readOnly ? 'bg-secondary text-muted-foreground' : 'bg-white'
        }`}
      />
    </label>
  );
}
