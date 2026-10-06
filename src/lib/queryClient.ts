import { QueryClient } from '@tanstack/react-query';

/**
 * The app's shared cache for data that lives on the server.
 *
 * Anything fetched with useQuery is stored here under a key, so two screens asking for the same thing share one
 * request, and a screen that mounts again shows what is already there while it quietly refreshes.
 *
 *   staleTime 5 min      data is treated as fresh for five minutes (the same window the staff directory had)
 *   refetchOnWindowFocus  off: switching tabs should not trigger a wave of requests
 *   retry 1              one retry for a network blip, then show the error
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });

export const queryClient = createQueryClient();

/** Keys for the shared queries, so every screen refers to the same entry. */
export const queryKeys = {
  employeeDirectory: ['employee-directory'] as const,
  myPermissions: ['my-permissions'] as const,
  myCompanies: ['my-companies'] as const,
};
