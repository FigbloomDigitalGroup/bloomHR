// One look for every sign-in screen (sign in, two-step code, create or join a company, new password), taken from the public
// landing page: forest green for the main action and the focus, 12px fields, 14px buttons, semibold headings with tight
// tracking, ink for text. A visitor who clicks "Create your company" lands on a page that looks like the one they left.
// The green is the theme's own (bg-brand reads --brand), so a different palette follows.
//
// These are class strings, so a screen can still add its own (an error border, a smaller gap) beside them.

export const authHeading = 'm-0 text-[clamp(1.75rem,1.4rem+1.2vw,2.25rem)] font-semibold leading-[1.1] tracking-[-0.03em] text-ink';
export const authSubtitle = 'm-0 text-[15px] leading-relaxed text-gray-600';
export const authLabel = 'text-[13px] font-semibold text-gray-700';

/** a text field: the colour and the focus ring; the caller adds the background (white, or grey when read-only) */
export const authInput =
  'block w-full rounded-tile border border-gray-200 px-4 py-3 text-[15px] text-ink placeholder-gray-400 transition-all focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20';
export const authInputOpen = `${authInput} bg-white hover:border-gray-300`;

const button = 'flex w-full items-center justify-center gap-2 rounded-card px-4 py-3.5 text-[15px] font-semibold transition-all disabled:cursor-not-allowed';
export const authButtonPrimary = `${button} bg-brand text-white shadow-[0_12px_26px_-12px_rgba(23,64,42,0.7)] hover:bg-brand-dark hover:shadow-[0_16px_30px_-12px_rgba(23,64,42,0.8)] disabled:bg-gray-300 disabled:shadow-none`;
export const authButtonSecondary = `${button} border border-gray-300 bg-white text-ink hover:border-ink disabled:border-gray-200 disabled:text-gray-400`;

/** a link inside a sentence ("Create one") */
export const authLink = 'font-semibold text-brand underline decoration-brand/30 underline-offset-4 transition-colors hover:decoration-brand';
/** a quiet link or button on its own line ("Forgot?", "Back to sign in") */
export const authQuietLink = 'text-[13px] font-medium text-gray-500 transition-colors hover:text-brand';
