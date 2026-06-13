import { getSupabaseBrowserClient } from '@/lib/supabase/client';

type PersonaApiResult<T = any> = {
  ok: boolean;
  personas: T[];
};

// Attach identity so the server can scope personas to the current account.
// Prefer a verified Supabase session token; fall back to the local-dev user id.
const buildPersonaRequestInit = async (userId?: string | null): Promise<RequestInit> => {
  const headers: Record<string, string> = { Pragma: 'no-cache' };
  try {
    if (typeof window !== 'undefined') {
      const supabase = getSupabaseBrowserClient();
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token) {
        headers.Authorization = `Bearer ${token}`;
        return { cache: 'no-store', headers };
      }
    }
  } catch {
    // ignore and fall through to local id
  }
  if (userId) headers['X-Local-User-Id'] = userId;
  return { cache: 'no-store', headers };
};

const parsePersonaPayload = <T>(payload: any): T[] =>
  Array.isArray(payload?.personas)
    ? payload.personas
    : Array.isArray(payload)
      ? payload
      : [];

const parseJsonSafe = async (response: Response) => {
  const text = await response.text().catch(() => '');
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

const buildPersonaQuery = (userId?: string | null) => {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  params.set('t', String(Date.now()));
  return `?${params.toString()}`;
};

export const fetchPersonasFromApi = async <T = any>(userId?: string | null): Promise<PersonaApiResult<T>> => {
  const query = buildPersonaQuery(userId);
  const requestInit = await buildPersonaRequestInit(userId);

  const primaryResponse = await fetch(`/api/save-persona${query}`, requestInit);
  const primaryPayload = await parseJsonSafe(primaryResponse);
  let personas = parsePersonaPayload<T>(primaryPayload);
  if (primaryResponse.ok) {
    return { ok: true, personas };
  }

  const fallbackResponse = await fetch(`/api/personas${query}`, requestInit);
  const fallbackPayload = await parseJsonSafe(fallbackResponse);
  personas = parsePersonaPayload<T>(fallbackPayload);
  return {
    ok: fallbackResponse.ok || personas.length > 0,
    personas,
  };
};
