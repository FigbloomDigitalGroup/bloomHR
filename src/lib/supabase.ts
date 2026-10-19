import { createClient } from '@supabase/supabase-js';

// The site is built with these (VITE_ values are read at build time). If they are missing, main.tsx shows a
// "not set up" page instead of the app, so this client is never used; it just must not crash on import.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!supabaseUrl || !supabaseKey) {
  console.error('Supabase URL and/or Anon Key are missing. Please check your environment variables.');
}

// Create and export Supabase client
export const supabase = createClient(supabaseUrl || 'https://not-configured.invalid', supabaseKey || 'not-configured', {
  auth: {
    persistSession: true,
    autoRefreshToken: true
  }
});

// Privileged operations (creating/updating/deleting auth users) go through the backend
// admin API - see src/lib/adminApi.ts. The service-role key must never be a VITE_ variable.
