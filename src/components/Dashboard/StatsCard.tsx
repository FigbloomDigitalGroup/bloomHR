import React from 'react';
import { motion } from 'framer-motion';
import { DivideIcon as LucideIcon } from 'lucide-react';

interface StatsCardProps {
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: LucideIcon;
  color?: 'green' | 'blue' | 'orange' | 'red';
}

export default function StatsCard({
  title,
  value,
  change,
  changeType = 'neutral',
  icon: Icon,
  color = 'green'
}: StatsCardProps) {
  const iconColors = {
    green: 'text-green-400',
    blue: 'text-blue-400',
    orange: 'text-orange-400',
    red: 'text-red-400'
  };
  
  const changeColors = {
    positive: 'text-green-500',
    negative: 'text-red-500',
    neutral: 'text-gray-500'
  };
  
  return (
    <motion.div
      className="bg-white backdrop-blur-sm border rounded-lg p-6 hover:border-green-500/50 hover:shadow-[0_0_20px_rgba(34,197,94,0.06)] shadow-sm transition-all duration-300"
      whileHover={{ 
        scale: 1.02,
        y: -2
      }}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-gray-600 text-xs font-medium">{title}</p>
          <p className="text-gray-900 text-2xl font-bold mt-1">{value}</p>
          {change && (
            <p className={`text-xs mt-1 ${changeColors[changeType]}`}>
              {change}
            </p>
          )}
        </div>
        <div className={`p-3 rounded-lg bg-gray-100 ${iconColors[color]}`}>
          <Icon className="w-6 h-6" />
        </div>
      </div>
    </motion.div>
  );
}