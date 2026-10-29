import { ButtonHTMLAttributes, ReactNode, useId, useState } from 'react';
import ShowPasswordButton from '../UI/ShowPasswordButton';
import AuthLayout from '../Auth/AuthLayout';
import { authButtonPrimary, authButtonSecondary, authHeading, authInput, authLabel, authLink, authSubtitle } from '../Auth/authStyles';

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
          <h2 className={authHeading}>{title}</h2>
          {subtitle && <p className={authSubtitle}>{subtitle}</p>}
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
      <span className={`block ${authLabel}`}>{label}</span>
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
        className={`${authInput} ${
          readOnly ? 'bg-gray-100 text-gray-500 cursor-not-allowed' : 'bg-white hover:border-gray-300'
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

/** The sign-in page's full-width button: forest green for the main action, light for the alternative. */
export function AuthButton({ variant = 'primary', className = '', children, ...rest }: AuthButtonProps) {
  const look =
    variant === 'primary'
      ? authButtonPrimary
      : authButtonSecondary;
  return (
    <button
      type="button"
      className={`${look} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A text link styled like the ones under the sign-in form. */
export const authLinkClass = authLink;
