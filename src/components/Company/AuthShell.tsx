import { ButtonHTMLAttributes, ReactNode, useId, useState } from 'react';
import ShowPasswordButton from '../UI/ShowPasswordButton';
import AuthLayout from '../Auth/AuthLayout';

// The sign-in look for every page where a person picks, creates or joins a company: the same frame as the login
// page (components/Auth/AuthLayout, one brand panel and photo for all of them) with a heading over the form.

interface AuthShellProps {
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}

export default function AuthShell({ title, subtitle, children }: AuthShellProps) {
  return (
    <AuthLayout>
      <div className="space-y-8">
        <div className="space-y-2">
          <h2 className="text-3xl font-bold text-gray-900">{title}</h2>
          {subtitle && <p className="text-gray-500 text-xs font-medium">{subtitle}</p>}
        </div>
        <div>{children}</div>
      </div>
    </AuthLayout>
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
  /** shown under the field in red, e.g. "Passwords don't match" */
  error?: string | null;
}

/** A labelled input styled like the sign-in form's fields. */
export function Field({ label, type = 'text', value, onChange, autoComplete, readOnly, placeholder, error }: FieldProps) {
  // a password field has an eye to show what was typed
  const [shown, setShown] = useState(false);
  const isPassword = type === 'password';
  const errorId = useId();
  return (
    <div className="space-y-1.5">
    <label className="block space-y-1.5">
      <span className="block text-xs font-bold text-gray-500 ml-1">{label}</span>
      <span className="relative block">
      <input
        type={isPassword && shown ? 'text' : type}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        value={value}
        readOnly={readOnly}
        autoComplete={autoComplete}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`block w-full px-4 py-3 border border-gray-200 rounded-lg text-xs text-gray-900 placeholder-gray-400 focus:outline-none focus:border-gray-900 focus:ring-1 focus:ring-gray-900 transition-all ${
          readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-gray-50 hover:border-gray-300'
        } ${isPassword ? 'pr-11' : ''}`}
      />
      {isPassword && <ShowPasswordButton shown={shown} onToggle={() => setShown(!shown)} />}
      </span>
    </label>
    {/* outside the label, so it is announced as a message, not read as part of the field's name */}
    {error && <p id={errorId} role="alert" className="text-xs text-red-600 ml-1">{error}</p>}
    </div>
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
