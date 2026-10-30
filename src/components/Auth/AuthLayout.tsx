import type { ReactNode } from 'react';
import { motion } from 'framer-motion';
import { AccessibilityButton } from '../Accessibility/AccessibilityModal';
import BrandMark from '../Landing/BrandMark';

// The sign-in screens' frame (sign in, two-step code, create or join a company, new password): a brand panel with the photo
// on the left on wide screens, the form on the right. One place, so every step looks the same, and looks like the public
// landing page: forest green over the photo, the mark drawn large behind, the landing page's type and buttons (authStyles.ts).
// Only the look follows the landing page. The words on this panel are the sign-in page's own, kept as the owner had them.

/** the brand panel's photo; replace the file to change it everywhere */
export const AUTH_PHOTO = '/auth-team.jpg';
/** which part of the photo the narrow panel keeps: the two women at the table, left of centre */
const PHOTO_FOCUS = '38% center';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-page font-sans [&_h1]:font-sans [&_h2]:font-sans [&_h3]:font-sans [&_h4]:font-sans [&_button]:font-sans [&_input]:font-sans [&_label]:font-sans">
      <div className="fixed right-3 top-3 z-50 rounded-full bg-white/90 shadow">
        <AccessibilityButton />
      </div>
      {/* Left side - Visual & Brand */}
      <div className="relative hidden overflow-hidden bg-brand lg:flex lg:w-[45%]">
        <div aria-hidden="true" className="absolute inset-0 z-0">
          <img src={AUTH_PHOTO} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: PHOTO_FOCUS }} />
          {/* the photo keeps its own colours under a hint of the brand's green; green only deepens a little at the top, behind the
              logo, and across the lower part, behind the words, just enough to keep the white type readable */}
          <div className="absolute inset-0 bg-brand/5" />
          <div className="absolute inset-x-0 top-0 h-1/5 bg-gradient-to-b from-brand/45 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-brand/65 via-brand/35 via-55% to-transparent" />
          {/* a warm glow low on the left, the brand's orange, and the mark drawn large like on the landing page's dark bands */}
          <div className="absolute -bottom-48 -left-48 h-[560px] w-[560px] rounded-full bg-[radial-gradient(closest-side,rgb(var(--highlight)/0.2),transparent)]" />
          <BrandMark outline className="absolute -right-64 -top-24 h-[560px] w-[560px] text-white/[0.1]" />
        </div>

        <div className="relative z-10 flex w-full flex-col justify-between p-12 xl:p-16">
          <div className="flex items-center gap-3">
            <BrandMark className="h-9 w-9 text-white" />
            <span className="text-2xl font-semibold tracking-[-0.02em] text-white">
              Figbloom<span className="font-light text-white/70">HR</span>
            </span>
          </div>

          <div className="mt-auto space-y-6 pb-8">
            <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
              <h1 className="m-0 text-4xl font-semibold leading-[1.05] tracking-[-0.035em] text-white xl:text-5xl">
                Automate Your <br />
                <span className="font-light text-white/70">Payroll & HR Workflows</span>
              </h1>
              <p className="mt-4 max-w-md text-xs text-white/75">
                Manage staff records, automate compensation, and handle branch operations with a single, unified business dashboard.
              </p>
            </motion.div>

            <div className="flex gap-12 pt-4">
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white">99.9%</span>
                <span className="text-xs font-bold uppercase tracking-widest text-white/60">Uptime</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-bold text-white">24/7</span>
                <span className="text-xs font-bold uppercase tracking-widest text-white/60">Support</span>
              </div>
            </div>
          </div>

          <div className="text-xs font-light text-white/80">© 2026 Figbloom HR · Business edition</div>
        </div>
      </div>

      {/* Right side - the form, on white with a faint wash of the brand's tint in the corner, as on the landing page */}
      <div className="relative flex w-full items-center justify-center bg-white bg-[radial-gradient(70%_55%_at_100%_0%,rgb(var(--tint)/0.7),transparent_70%)] p-6 lg:w-[55%] lg:p-12">
        <div className="w-full max-w-[440px]">
          {/* Mobile Logo */}
          <div className="mb-10 text-center lg:hidden">
            <div className="inline-flex items-center gap-2.5">
              <BrandMark className="h-9 w-9 text-brand" />
              <span className="text-2xl font-semibold tracking-[-0.02em] text-ink">
                Figbloom<span className="font-light text-ink/60">HR</span>
              </span>
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
