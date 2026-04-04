type PersonaApiResult<T = any> = {
  ok: boolean;
  personas: T[];
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
  const requestInit: RequestInit = {
    cache: 'no-store',
    headers: { Pragma: 'no-cache' },
  };

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
