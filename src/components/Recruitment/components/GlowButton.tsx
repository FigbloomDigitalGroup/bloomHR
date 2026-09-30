import { LucideIcon } from 'lucide-react';

interface GlowButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';
  icon?: LucideIcon;
  size?: 'sm' | 'md' | 'lg';
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

export const GlowButton = ({ 
  children, 
  variant = 'primary', 
  icon: Icon, 
  size = 'md', 
  onClick, 
  disabled = false,
  className = ''
}: GlowButtonProps) => {
  const baseClasses = "inline-flex items-center gap-2 rounded-tile font-semibold transition-all duration-200 border";
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-3.5 py-2 text-xs",
    lg: "px-6 py-3 text-base"
  };
  const variantClasses = {
    primary: "bg-brand border-brand text-white hover:bg-brand-dark hover:border-brand-dark",
    secondary: "bg-white border-border text-ink hover:bg-secondary",
    danger: "bg-orange-tint border-status-danger/30 text-status-danger hover:bg-orange-tint/70"
  };

  return (
    <button 
      className={`${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${className}`}
      onClick={onClick}
      disabled={disabled}
    >
      {Icon && <Icon className="w-4 h-4" />}
      {children}
    </button>
  );
};