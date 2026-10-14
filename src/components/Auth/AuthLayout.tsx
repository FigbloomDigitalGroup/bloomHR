import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AccessibilityButton } from '../Accessibility/AccessibilityModal';

// The sign-in screens' frame (sign in, two-step code): the brand panel with the photo on the left on wide screens,
// the form on white on the right. One place, so every sign-in step looks the same.

/** the brand panel's photo; replace the file to change it everywhere */
export const AUTH_PHOTO = '/leaf.jpg';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-page font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans [&_h4]:font-sans [&_button]:font-sans [&_input]:font-sans [&_label]:font-sans">
      <div className="fixed right-3 top-3 z-50 rounded-full bg-white/90 shadow">
        <AccessibilityButton />
      </div>
      {/* Left side - Visual & Brand */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden bg-gray-900">
        <div className="absolute inset-0 z-0">
          <img src={AUTH_PHOTO} alt="" className="absolute inset-0 w-full h-full object-cover opacity-50" />
          <div className="absolute inset-0 bg-black/40" />
        </div>

        <div className="relative z-10 w-full flex flex-col justify-between p-16">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center shadow-lg shadow-black/20">
              <img src="/bloom-mark.png" alt="Company Logo" className="w-6 h-6 object-contain brightness-0 invert" />
            </div>
            <span className="text-white font-bold text-2xl tracking-tight">Figbloom<span className="text-gray-400">HR</span></span>
          </div>

          <div className="space-y-6">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <h1 className="text-5xl font-extrabold text-white leading-tight">
                Automate Your <br />
                <span className="text-gray-400">Payroll & HR Workflows</span>
              </h1>
              <p className="mt-4 text-gray-400 text-xs max-w-md">
                Manage staff records, automate compensation, and handle branch operations with a single, unified business dashboard.
              </p>
            </motion.div>

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

      {/* Right side - the form */}
      <div className="w-full lg:w-[55%] flex items-center justify-center p-6 lg:p-12 relative bg-white">
        <div className="w-full max-w-[440px]">
          {/* Mobile Logo */}
          <div className="lg:hidden text-center mb-10">
            <div className="inline-flex items-center gap-2 mb-2">
              <div className="w-8 h-8 bg-gray-900 rounded-lg flex items-center justify-center">
                <img src="/bloom-mark.png" alt="Logo" className="w-5 h-5 object-contain brightness-0 invert" />
              </div>
              <span className="text-2xl font-bold text-gray-900 tracking-tight">Figbloom<span className="text-gray-500">HR</span></span>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
