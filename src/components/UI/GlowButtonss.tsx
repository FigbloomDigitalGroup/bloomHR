import React from 'react';
import { DivideIcon as LucideIcon } from 'lucide-react';

interface GlowButtonssProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  icon?: LucideIcon;
  disabled?: boolean;
  className?: string;
}

export default function GlowButtonss({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  disabled = false,
  className = ''
}: GlowButtonssProps) {
  const baseClasses = "inline-flex items-center gap-2 rounded-lg font-medium transition-all duration-300 border";
  
  const sizeClasses = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-xs", 
    lg: "px-6 py-3 text-base"
  };
  
  const variantClasses = {
    primary: "bg-green-50 border-green-500 text-green-600 hover:bg-green-100 hover:border-green-600 hover:text-green-700 hover:shadow-[0_0_20px_rgba(34,197,94,0.5)] focus:shadow-[0_0_25px_rgba(34,197,94,0.6)]",
    secondary: "bg-gray-50 hover:bg-gray-100 text-gray-700 border-gray-300 hover:border-gray-400",
    danger: "bg-red-50 border-red-500 text-red-600 hover:bg-red-100 hover:border-red-600 hover:text-red-700 hover:shadow-[0_0_20px_rgba(239,68,68,0.5)]"
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
}