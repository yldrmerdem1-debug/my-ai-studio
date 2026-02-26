export const withDownloadTrue = (url: string): string => {
  const raw = (url || '').trim();
  if (!raw) return raw;

  // Only force this for Hugging Face URLs (as requested). Safe for resolve URLs.
  if (!raw.startsWith('https://huggingface.co/')) return raw;

  try {
    const u = new URL(raw);
    if (u.searchParams.has('download')) return raw;
    u.searchParams.set('download', 'true');
    return u.toString();
  } catch {
    // Fallback for malformed URLs
    if (raw.includes('?')) {
      if (raw.includes('download=')) return raw;
      return `${raw}&download=true`;
    }
    return `${raw}?download=true`;
  }
};

export const uniqStrings = (values: Array<string | null | undefined>): string[] => {
  const out: string[] = [];
  for (const v of values) {
    const s = (v || '').trim();
    if (!s) continue;
    if (!out.includes(s)) out.push(s);
  }
  return out;
};

export const ensurePromptHasTriggers = (prompt: string, triggers: string[]): string => {
  const p = (prompt || '').trim();
  if (!p) return p;
  const uniqueTriggers = uniqStrings(triggers);
  if (uniqueTriggers.length === 0) return p;

  const lower = p.toLowerCase();
  const missing = uniqueTriggers.filter((t) => t && !lower.includes(t.toLowerCase()));
  if (missing.length === 0) return p;

  // Add triggers as a comma-separated prefix.
  return `${missing.join(', ')}, ${p}`.trim();
};

