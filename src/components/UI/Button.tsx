import { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: ButtonVariant;
  icon?: ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white border border-brand hover:bg-brand-dark',
  secondary: 'bg-white text-ink border border-border hover:bg-secondary',
  ghost: 'bg-transparent text-muted-foreground border border-transparent hover:bg-secondary',
};

export default function Button({ children, variant = 'primary', icon, className = '', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`inline-flex items-center gap-[7px] px-3.5 py-2 rounded-tile text-[12.5px] font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${variantClasses[variant]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
