import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let browserClient: SupabaseClient | null = null;

const createNoopClient = () => {
  const noopQuery = {
    select: () => noopQuery,
    eq: () => noopQuery,
    order: async () => ({ data: [], error: null }),
  };
  return {
    from: () => noopQuery,
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      signInWithPassword: async () => ({
        data: { user: null, session: null },
        error: { message: 'Supabase client is not configured' },
      }),
      signUp: async () => ({
        data: { user: null, session: null },
        error: { message: 'Supabase client is not configured' },
      }),
      resend: async () => ({
        data: null,
        error: { message: 'Supabase client is not configured' },
      }),
      resetPasswordForEmail: async () => ({
        data: null,
        error: { message: 'Supabase client is not configured' },
      }),
      updateUser: async () => ({
        data: { user: null },
        error: { message: 'Supabase client is not configured' },
      }),
      signOut: async () => ({ error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => undefined } },
      }),
    },
  } as unknown as SupabaseClient;
};

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    browserClient = createNoopClient();
    return browserClient;
  }
  browserClient = createClient(url, anonKey, {
    auth: { persistSession: true, autoRefreshToken: true },
  });
  return browserClient;
}
