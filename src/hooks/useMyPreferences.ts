import { useQuery } from '@tanstack/react-query';
import { fetchMyPreferences } from '../lib/preferences';

export const MY_PREFERENCES_KEY = ['my-preferences'] as const;

/** The signed-in login's own preferences (theme, picture). Null until loaded, or if they cannot be read. */
export function useMyPreferences(email: string | undefined) {
  return useQuery({
    queryKey: [...MY_PREFERENCES_KEY, email],
    queryFn: fetchMyPreferences,
    enabled: !!email,
    staleTime: 5 * 60 * 1000,
  });
}
