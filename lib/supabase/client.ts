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
