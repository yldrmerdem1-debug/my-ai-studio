type AllowedCheckOptions = {
  baseUrl?: string;
  supabaseUrl?: string;
};

const safeUrl = (value: string): URL | null => {
  try {
    return new URL(value);
  } catch {
    return null;
  }
};

export const isAllowedFaceSwapSourceUrl = (url: string, options: AllowedCheckOptions = {}): boolean => {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;

  // Allow same-origin absolute URLs (your app domain).
  const parsed = safeUrl(trimmed);
  if (parsed) {
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;

    const base = options.baseUrl ? safeUrl(options.baseUrl) : null;
    if (base && parsed.host === base.host) return true;

    // Allow Supabase storage URLs (public or signed) for YOUR Supabase project only.
    const supabase = options.supabaseUrl ? safeUrl(options.supabaseUrl) : null;
    if (supabase && parsed.host === supabase.host && parsed.pathname.includes('/storage/v1/object/')) return true;

    return false;
  }

  // Allow app-relative paths; server code can resolve these to baseUrl later.
  if (trimmed.startsWith('/')) return true;
  return false;
};

export const filterActorPhotosToAllowed = (
  actorPhotos: Record<string, string>,
  options: AllowedCheckOptions = {}
): { allowed: Record<string, string>; rejected: string[] } => {
  const allowed: Record<string, string> = {};
  const rejected: string[] = [];
  for (const [character, url] of Object.entries(actorPhotos || {})) {
    if (typeof url !== 'string' || !url.trim()) continue;
    if (isAllowedFaceSwapSourceUrl(url, options)) {
      allowed[character] = url.trim();
    } else {
      rejected.push(character);
    }
  }
  return { allowed, rejected };
};

