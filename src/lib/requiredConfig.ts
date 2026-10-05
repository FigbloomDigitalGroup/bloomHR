/**
 * Settings the browser app cannot start without. VITE_ values are read while the site is BUILT, so on a host such
 * as Vercel they must be added in the project settings first and the site redeployed afterwards.
 */
export const REQUIRED_PUBLIC_CONFIG = ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'] as const;

/** Names (never values) of the required settings that are missing or blank. */
export function missingConfig(env: Record<string, unknown>): string[] {
  return REQUIRED_PUBLIC_CONFIG.filter((name) => !String(env[name] ?? '').trim());
}
