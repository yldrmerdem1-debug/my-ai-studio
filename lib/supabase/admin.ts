import { createClient, type SupabaseClient } from '@supabase/supabase-js';

type AdminClientResult = {
  client: SupabaseClient | null;
  error?: string;
};

export function getSupabaseAdminClient(): AdminClientResult {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    return { client: null, error: 'Supabase not configured' };
  }
  return {
    client: createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}
