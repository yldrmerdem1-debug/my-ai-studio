// Deterministic, premium-looking avatar styling derived from a user's identity.
// Same user → same gradient, so the avatar feels personal and consistent.

const AVATAR_GRADIENTS: Array<{ from: string; via: string; to: string; ring: string; glow: string }> = [
  { from: '#22d3ee', via: '#3b82f6', to: '#8b5cf6', ring: 'rgba(34,211,238,0.45)', glow: 'rgba(34,211,238,0.35)' },
  { from: '#a855f7', via: '#6366f1', to: '#22d3ee', ring: 'rgba(168,85,247,0.45)', glow: 'rgba(168,85,247,0.35)' },
  { from: '#f472b6', via: '#a855f7', to: '#6366f1', ring: 'rgba(244,114,182,0.45)', glow: 'rgba(244,114,182,0.32)' },
  { from: '#34d399', via: '#22d3ee', to: '#3b82f6', ring: 'rgba(52,211,153,0.45)', glow: 'rgba(52,211,153,0.32)' },
  { from: '#fbbf24', via: '#fb7185', to: '#a855f7', ring: 'rgba(251,191,36,0.45)', glow: 'rgba(251,113,133,0.32)' },
  { from: '#38bdf8', via: '#818cf8', to: '#c084fc', ring: 'rgba(129,140,248,0.45)', glow: 'rgba(129,140,248,0.32)' },
];

const hashString = (value: string) => {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
};

export const getAvatarGradient = (seed?: string | null) => {
  const safeSeed = String(seed || 'kinetic').trim().toLowerCase() || 'kinetic';
  return AVATAR_GRADIENTS[hashString(safeSeed) % AVATAR_GRADIENTS.length];
};

export const getAvatarInitials = (...sources: Array<string | null | undefined>) => {
  const base = sources.map((value) => String(value || '').trim()).find(Boolean) || 'K';
  const initials = base
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
  return initials || base.charAt(0).toUpperCase() || 'K';
};

export const buildAvatarBackground = (seed?: string | null) => {
  const gradient = getAvatarGradient(seed);
  return `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.via} 50%, ${gradient.to} 100%)`;
};
