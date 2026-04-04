const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const withHttps = (value: string) => {
  const trimmed = safeTrim(value).replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  return trimmed ? `https://${trimmed}` : '';
};

const normalizeBaseUrl = (value: unknown) => {
  const trimmed = safeTrim(value).replace(/\/+$/, '');
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[a-z0-9.-]+(?::\d+)?$/i.test(trimmed)) return `https://${trimmed}`;
  return '';
};

export const isProductionRuntime = () => process.env.NODE_ENV === 'production';

export const isLocalAssetFallbackEnabled = () => {
  const explicit = safeTrim(process.env.ALLOW_LOCAL_ASSET_FALLBACK).toLowerCase();
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return !isProductionRuntime();
};

export const getConfiguredSiteUrl = () => {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.APP_URL,
    process.env.URL,
    process.env.NEXTAUTH_URL,
    process.env.DEPLOY_URL,
    process.env.CF_PAGES_URL,
    process.env.RAILWAY_STATIC_URL ? withHttps(process.env.RAILWAY_STATIC_URL) : '',
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? withHttps(process.env.VERCEL_PROJECT_PRODUCTION_URL) : '',
    process.env.VERCEL_URL ? withHttps(process.env.VERCEL_URL) : '',
  ];

  for (const candidate of candidates) {
    const normalized = normalizeBaseUrl(candidate);
    if (normalized) return normalized;
  }

  return 'http://localhost:3000';
};

export const getSiteUrlFromRequest = (request: Request) => {
  const configured = getConfiguredSiteUrl();
  if (!configured.includes('localhost')) return configured;

  const forwardedHost = safeTrim(request.headers.get('x-forwarded-host'));
  const host = forwardedHost || safeTrim(request.headers.get('host'));
  if (!host) return configured;

  const forwardedProto = safeTrim(request.headers.get('x-forwarded-proto'));
  const protocol = forwardedProto || (host.includes('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
};
