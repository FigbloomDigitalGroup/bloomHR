import React from 'react';
import { motion } from 'framer-motion';
import { LucideIcon } from 'lucide-react';

interface GlowButtonProps {
  children: React.ReactNode;
  onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void;
  variant?: 'primary' | 'secondary' | 'danger';
  size?: 'sm' | 'md' | 'lg' | 'xs';
  icon?: LucideIcon;
  disabled?: boolean;
  loading?: boolean;
  className?: string;
}

export default function GlowButton({
  children,
  onClick,
  variant = 'primary',
  size = 'md',
  icon: Icon,
  disabled = false,
  loading = false,
  className = ''
}: GlowButtonProps) {
  const baseClasses = 'inline-flex text-xs items-center justify-center font-medium rounded-lg transition-all duration-200 border backdrop-blur-sm';

  const variantClasses = {
    primary: 'bg-green-600 text-white hover:bg-green-700 border-green-500 hover:border-green-600 transition-all duration-300',
    secondary: 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all duration-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 border-red-500 hover:border-red-600 transition-all duration-300'
  };

  const sizeClasses = {
    xs: 'px-2 py-1 text-[10px] space-x-1',
    sm: 'px-3 py-1.5 text-xs space-x-1.5',
    md: 'px-4 py-2 text-xs space-x-2',
    lg: 'px-6 py-3 text-base space-x-2'
  };

  const disabledClasses = 'opacity-50 cursor-not-allowed hover:shadow-none';

  return (
    <motion.button
      onClick={(disabled || loading) ? undefined : onClick}
      className={`${baseClasses} ${variantClasses[variant]} ${sizeClasses[size]} ${(disabled || loading) ? disabledClasses : ''} ${className}`}
      whileHover={(disabled || loading) ? {} : { scale: 1.02 }}
      whileTap={(disabled || loading) ? {} : { scale: 0.98 }}
      disabled={disabled || loading}
    >
      {loading ? (
        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
      ) : (
        Icon && <Icon className="w-4 h-4" />
      )}
      <span>{loading ? 'Saving...' : children}</span>
    </motion.button>
  );
}