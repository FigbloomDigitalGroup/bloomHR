import { ButtonHTMLAttributes, ReactNode } from 'react';

// The sign-in look (split layout: brand image on the left, form on the right) shared by every page where a
// person creates an account or joins a company, so they all feel like the login page.

function BrandPanel() {
  return (
    <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gray-900">
      <div className="absolute inset-0 z-0">
        <img src="/leaf.jpg" alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
        <div className="absolute inset-0 bg-black/40" />
      </div>
      <div className="relative z-10 w-full flex flex-col justify-between p-16">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shadow-lg shadow-black/20">
            <img src="/solo.png" alt="" className="w-6 h-6 object-contain brightness-0 invert" />
          </div>
          <span className="text-white font-bold text-2xl tracking-tight">
            Figbloom<span className="text-gray-400">HR</span>
          </span>
        </div>
        <div className="space-y-6">
          <div>
            <h1 className="text-5xl font-extrabold text-white leading-tight">
              Automate Your <br />
              <span className="text-gray-400">Payroll &amp; HR Workflows</span>
            </h1>
            <p className="mt-4 text-gray-400 text-xs max-w-md">
              Manage staff records, automate compensation, and handle branch operations with a single, unified business dashboard.
            </p>
          </div>
          <div className="flex gap-12 pt-8">
            <div className="flex flex-col">
              <span className="text-white font-bold text-2xl">99.9%</span>
              <span className="text-gray-500 text-xs uppercase tracking-widest font-bold">Uptime</span>
            </div>
            <div className="flex flex-col">
              <span className="text-white font-bold text-2xl">24/7</span>
              <span className="text-gray-500 text-xs uppercase tracking-widest font-bold">Support</span>
            </div>
          </div>
        </div>
        <div className="text-white text-xs font-light">© 2026 Figbloom HR · Business edition</div>
      </div>
    </div>
  );
}

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-gray-50 font-sans [&_h1]:font-sans [&_h2]:font-sans [&_button]:font-sans [&_input]:font-sans [&_label]:font-sans">
      <BrandPanel />
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12 relative bg-white">
        <div className="w-full max-w-[440px]">
          <div className="lg:hidden text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <img src="/solo.png" alt="" className="w-5 h-5 brightness-0 invert" />
              </div>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">
                Figbloom<span className="text-gray-500">HR</span>
              </span>
            </div>
          </div>
          <div className="space-y-8">
            <div className="space-y-2">
              <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
              {subtitle && <p className="text-gray-500 text-xs font-medium">{subtitle}</p>}
            </div>
            <div>{children}</div>
          </div>
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

/** A labelled input styled like the sign-in form's fields. */
export function Field({ label, type = 'text', value, onChange, autoComplete, readOnly, placeholder }: FieldProps) {
  return (
    <label className="block space-y-1.5">
      <span className="block text-xs font-bold text-gray-500 ml-1">{label}</span>
      <input
        type={type}
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full px-4 py-3 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all ${
          readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-gray-50 hover:border-gray-300'
        }`}
      />
    </label>
  );
}

interface AuthButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary';
}

/** The sign-in page's full-width button: dark for the main action, light for the alternative. */
export function AuthButton({ variant = 'primary', className = '', children, ...rest }: AuthButtonProps) {
  const look =
    variant === 'primary'
      ? 'text-white bg-gray-900 hover:bg-gray-800 shadow-lg shadow-gray-900/20 disabled:bg-gray-300 disabled:shadow-none'
      : 'text-gray-900 bg-gray-50 hover:bg-gray-100 border border-gray-200 disabled:text-gray-400';
  return (
    <button
      type="button"
      className={`w-full flex justify-center items-center gap-2 py-4 px-4 rounded-lg text-xs font-bold transition-all disabled:cursor-not-allowed ${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A text link styled like the ones under the sign-in form. */
export const authLinkClass = 'text-gray-900 text-xs font-bold underline decoration-gray-200 underline-offset-4';
