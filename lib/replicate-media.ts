type ExpectedMediaKind = 'image' | 'video' | 'audio';
export type MediaKind = ExpectedMediaKind | 'json' | 'html' | 'unknown';

type FetchLike = typeof fetch;

type Logger = {
  info?: (...args: unknown[]) => void;
  warn?: (...args: unknown[]) => void;
  error?: (...args: unknown[]) => void;
};

type UrlCandidate = {
  url: string;
  path: string;
};

export type DownloadedMedia = {
  finalUrl: string;
  status: number;
  contentType: string;
  kind: MediaKind;
  buffer: Buffer;
};

const IMAGE_EXT_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i;
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|avi|mkv)(\?|#|$)/i;
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i;
const HTTP_RE = /^https?:\/\//i;

const JSON_CT_RE = /\bapplication\/json\b/i;
const HTML_CT_RE = /\btext\/html\b/i;
const IMAGE_CT_RE = /\bimage\/[a-z0-9.+-]+\b/i;
const VIDEO_CT_RE = /\bvideo\/[a-z0-9.+-]+\b/i;
const AUDIO_CT_RE = /\baudio\/[a-z0-9.+-]+\b/i;

const KEY_IMAGE_RE = /\b(image|images|thumbnail|thumb|poster|frame|preview)\b/i;
const KEY_VIDEO_RE = /\b(video|videos|movie|clip|animation|motion)\b/i;
const KEY_AUDIO_RE = /\b(audio|sound|voice|music)\b/i;

const REPLICATE_FILES_RE = /^https:\/\/api\.replicate\.com\/v1\/files\/[^/?#]+/i;
const REPLICATE_API_RE = /^https:\/\/api\.replicate\.com\//i;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_REPLICATE_ACCEPT = 'image/*, video/*, audio/*, application/octet-stream';

const normalizeContentType = (value: string | null | undefined) => (value || '').split(';')[0].trim().toLowerCase();
const snippet = (value: string, size = 300) => value.slice(0, size);
const isInvalidUrlInput = (value: unknown) =>
  typeof value !== 'string'
  || !value.trim()
  || value.trim().toLowerCase() === 'undefined'
  || value.trim().toLowerCase() === 'null';

const toHttpUrlOrNull = (value: unknown, baseUrl?: string): string | null => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.toLowerCase() === 'undefined' || normalized.toLowerCase() === 'null') return null;
  if (HTTP_RE.test(normalized)) return normalized;
  // Some Replicate metadata fields can return relative links (e.g. /v1/files/{id}/download?...).
  if (!baseUrl) return null;
  try {
    const resolved = new URL(normalized, baseUrl).toString();
    if (!HTTP_RE.test(resolved)) return null;
    return resolved;
  } catch {
    return null;
  }
};

const isReplicateFilesUrl = (url: string) => REPLICATE_FILES_RE.test(url);
const isReplicateApiUrl = (url: string) => REPLICATE_API_RE.test(url);

const resolveToken = (provided?: string) => (provided || process.env.REPLICATE_API_TOKEN || '').trim();
const getReplicateHeaders = (token: string, accept = DEFAULT_REPLICATE_ACCEPT): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  Accept: accept,
});

export const inferMediaKindFromContentType = (contentType: string | null | undefined): MediaKind => {
  const ct = normalizeContentType(contentType);
  if (!ct) return 'unknown';
  if (JSON_CT_RE.test(ct)) return 'json';
  if (HTML_CT_RE.test(ct)) return 'html';
  if (IMAGE_CT_RE.test(ct)) return 'image';
  if (VIDEO_CT_RE.test(ct)) return 'video';
  if (AUDIO_CT_RE.test(ct)) return 'audio';
  return 'unknown';
};

export const inferMediaKindFromUrl = (url: string): MediaKind => {
  if (IMAGE_EXT_RE.test(url)) return 'image';
  if (VIDEO_EXT_RE.test(url)) return 'video';
  if (AUDIO_EXT_RE.test(url)) return 'audio';
  return 'unknown';
};

const collectUrlCandidates = (value: unknown, path = 'root', out: UrlCandidate[] = []): UrlCandidate[] => {
  if (typeof value === 'string') {
    if (HTTP_RE.test(value)) out.push({ url: value, path });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectUrlCandidates(item, `${path}[${index}]`, out));
    return out;
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown> & {
      url?: unknown;
      href?: unknown;
      toString?: () => string;
    };
    const pushMaybeUrl = (candidate: unknown, candidatePath: string) => {
      const resolved = toHttpUrlOrNull(candidate);
      if (resolved) out.push({ url: resolved, path: candidatePath });
    };
    pushMaybeUrl(obj.href, `${path}.href`);
    if (typeof obj.url === 'function') {
      try {
        pushMaybeUrl((obj.url as () => unknown)(), `${path}.url()`);
      } catch {
        // ignore callable URL access failures
      }
    } else {
      pushMaybeUrl(obj.url, `${path}.url`);
    }
    if (typeof obj.toString === 'function') {
      try {
        const stringified = obj.toString();
        if (typeof stringified === 'string' && HTTP_RE.test(stringified)) {
          out.push({ url: stringified, path: `${path}.toString()` });
        }
      } catch {
        // ignore custom toString failures
      }
    }
    Object.entries(obj).forEach(([key, entry]) => {
      collectUrlCandidates(entry, `${path}.${key}`, out);
    });
  }
  return out;
};

const scoreCandidateForExpected = (candidate: UrlCandidate, expected: ExpectedMediaKind): number => {
  const { path, url } = candidate;
  let score = 0;
  const pathLower = path.toLowerCase();
  const kindByUrl = inferMediaKindFromUrl(url);

  if (expected === 'image') {
    if (KEY_IMAGE_RE.test(pathLower)) score += 40;
    if (KEY_VIDEO_RE.test(pathLower) || KEY_AUDIO_RE.test(pathLower)) score -= 30;
    if (kindByUrl === 'image') score += 30;
    if (kindByUrl === 'video' || kindByUrl === 'audio') score -= 25;
  } else if (expected === 'video') {
    if (KEY_VIDEO_RE.test(pathLower)) score += 40;
    if (KEY_IMAGE_RE.test(pathLower) || KEY_AUDIO_RE.test(pathLower)) score -= 30;
    if (kindByUrl === 'video') score += 30;
    if (kindByUrl === 'image' || kindByUrl === 'audio') score -= 25;
  } else if (expected === 'audio') {
    if (KEY_AUDIO_RE.test(pathLower)) score += 40;
    if (KEY_VIDEO_RE.test(pathLower) || KEY_IMAGE_RE.test(pathLower)) score -= 30;
    if (kindByUrl === 'audio') score += 30;
    if (kindByUrl === 'image' || kindByUrl === 'video') score -= 25;
  }

  return score;
};

export const extractOutputUrlByKind = (output: unknown, expected: ExpectedMediaKind): string => {
  const candidates = collectUrlCandidates(output);
  if (candidates.length === 0) return '';
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidateForExpected(candidate, expected) }))
    .sort((a, b) => b.score - a.score);
  if (scored[0].score > 0) return scored[0].candidate.url;
  const byUrlKind = candidates.find((candidate) => inferMediaKindFromUrl(candidate.url) === expected);
  return byUrlKind?.url || candidates[0].url;
};

const parseJsonSafely = (value: string): unknown => {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
};

const uniq = (items: string[]) => items.filter((item, idx) => items.indexOf(item) === idx);

const extractReplicateDownloadCandidates = (payload: any, sourceUrl: string): string[] => {
  const directCandidates = [
    payload?.urls?.download,
    payload?.download_url,
    payload?.downloadUrl,
    payload?.href,
    payload?.url,
    payload?.urls?.get,
    payload?.urls?.original,
    payload?.serving_url,
  ]
    .map((value) => toHttpUrlOrNull(value, sourceUrl))
    .filter((value): value is string => Boolean(value));
  const nestedCandidates = collectUrlCandidates(payload)
    .map((item) => toHttpUrlOrNull(item.url, sourceUrl))
    .filter((value): value is string => Boolean(value));
  const all = uniq([...directCandidates, ...nestedCandidates])
    .map((url) => toHttpUrlOrNull(url, sourceUrl))
    .filter((url): url is string => Boolean(url))
    .filter((url) => url !== sourceUrl);
  const preferred = all.filter((url) => !isReplicateFilesUrl(url));
  return preferred.length > 0 ? preferred : all;
};

const fetchWithRedirectGuard = async (
  fetchFn: FetchLike,
  initialUrl: string,
  init: RequestInit,
  maxRedirects = 8
): Promise<{ response: Response; finalUrl: string }> => {
  let currentUrl = initialUrl;
  const visited = new Set<string>();
  for (let step = 0; step <= maxRedirects; step += 1) {
    if (!currentUrl) {
      throw new Error('fetchWithRedirectGuard received an undefined or null URL.');
    }
    if (visited.has(currentUrl)) {
      throw new Error(`Redirect loop detected while fetching ${initialUrl}`);
    }
    visited.add(currentUrl);
    const response = await fetchFn(currentUrl, { ...init, redirect: 'manual' });
    const isRedirect = [301, 302, 303, 307, 308].includes(response.status);
    if (!isRedirect) {
      return { response, finalUrl: currentUrl };
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new Error(`Redirect without location header while fetching ${currentUrl}`);
    }
    currentUrl = new URL(location, currentUrl).toString();
  }
  throw new Error(`Too many redirects while fetching ${initialUrl}`);
};

const fetchWithRetryForReplicate = async (
  fetchFn: FetchLike,
  url: string,
  init: RequestInit,
  isReplicateTarget: boolean,
  maxAttempts = 3
): Promise<{ response: Response; finalUrl: string }> => {
  if (isInvalidUrlInput(url)) {
    throw new Error(`fetchWithRetryForReplicate received invalid URL input: ${String(url)}`);
  }
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const out = await fetchWithRedirectGuard(fetchFn, url, init);
      const retryableStatus = isReplicateTarget && (out.response.status === 400 || out.response.status >= 500);
      if (retryableStatus && attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }
      return out;
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) {
        await sleep(250 * attempt);
        continue;
      }
    }
  }
  throw (lastError as Error) || new Error(`Fetch failed for ${url}`);
};

type DownloadOptions = {
  expectedKind?: ExpectedMediaKind;
  strictExpectedKind?: boolean;
  token?: string;
  fetchFn?: FetchLike;
  logger?: Logger;
};

type ResolvedDownloadTarget = {
  url: string;
  preferredAccept?: string;
};

const resolveReplicateDownloadTarget = async (
  fileOrUrl: string,
  options: Pick<DownloadOptions, 'token' | 'fetchFn' | 'logger'> = {}
): Promise<ResolvedDownloadTarget> => {
  const { fetchFn = fetch, logger } = options;
  if (isInvalidUrlInput(fileOrUrl)) {
    throw new Error(`resolveReplicateDownloadUrl received invalid URL input: ${String(fileOrUrl)}`);
  }
  if (!isReplicateFilesUrl(fileOrUrl)) return { url: fileOrUrl };

  const token = resolveToken(options.token);
  if (!token) {
    throw new Error('Missing REPLICATE_API_TOKEN');
  }
  const headers = getReplicateHeaders(token);
  const lookup = await fetchWithRetryForReplicate(fetchFn, fileOrUrl, { headers }, true);
  const lookupCt = normalizeContentType(lookup.response.headers.get('content-type'));
  const lookupKind = inferMediaKindFromContentType(lookupCt);

  if (!lookup.response.ok) {
    const body = await lookup.response.text();
    throw new Error(
      `Replicate file lookup failed (${lookup.response.status}) content-type=${lookupCt || 'unknown'} body=${snippet(body)}`
    );
  }

  if (lookupKind === 'image' || lookupKind === 'video' || lookupKind === 'audio') {
    return { url: lookup.finalUrl };
  }

  if (lookupKind === 'json' || lookupKind === 'html' || lookupKind === 'unknown') {
    const text = await lookup.response.text();
    logger?.warn?.('[replicate-media] file metadata response', {
      status: lookup.response.status,
      contentType: lookupCt || '(missing)',
      body: snippet(text),
    });
    const payload = parseJsonSafely(text);
    const candidates = extractReplicateDownloadCandidates(payload, lookup.finalUrl);
    if (candidates.length > 0) {
      const candidate = toHttpUrlOrNull(candidates[0]);
      if (candidate) return { url: candidate };
    }
    const metadata = (payload && typeof payload === 'object') ? payload as Record<string, unknown> : {};
    const metadataId = typeof metadata.id === 'string' ? metadata.id : '';
    const metadataName = typeof metadata.name === 'string' ? metadata.name : '';
    const metadataContentType = normalizeContentType(
      typeof metadata.content_type === 'string' ? metadata.content_type : ''
    );

    // Some Replicate deployments return metadata unless explicit Accept matches file content type.
    if (metadataContentType) {
      const directBinaryProbe = await fetchWithRetryForReplicate(
        fetchFn,
        lookup.finalUrl,
        { headers: getReplicateHeaders(token, `${metadataContentType}, ${DEFAULT_REPLICATE_ACCEPT}`) },
        true,
        2
      );
      const directCt = normalizeContentType(directBinaryProbe.response.headers.get('content-type'));
      const directKind = inferMediaKindFromContentType(directCt);
      if (directBinaryProbe.response.ok && directKind !== 'json' && directKind !== 'html') {
        logger?.info?.('[replicate-media] direct binary fetch succeeded via Accept hint', {
          contentType: directCt || '(missing)',
        });
        return { url: lookup.finalUrl, preferredAccept: `${metadataContentType}, ${DEFAULT_REPLICATE_ACCEPT}` };
      }
    }

    const probeUrls = [
      `${lookup.finalUrl.replace(/\/+$/, '')}/download`,
      `${lookup.finalUrl.replace(/\/+$/, '')}/download?download=true`,
      `${lookup.finalUrl.replace(/\/+$/, '')}/download?download=1`,
      `${lookup.finalUrl.replace(/\/+$/, '')}?download=true`,
      `${lookup.finalUrl.replace(/\/+$/, '')}?download=1`,
      `${lookup.finalUrl.replace(/\/+$/, '')}?raw=true`,
      `${lookup.finalUrl.replace(/\/+$/, '')}?raw=1`,
    ];
    let lastProbeError = '';
    for (const probeUrl of probeUrls) {
      const probe = await fetchWithRetryForReplicate(fetchFn, probeUrl, { headers }, true);
      const probeCt = normalizeContentType(probe.response.headers.get('content-type'));
      const probeKind = inferMediaKindFromContentType(probeCt);
      if (!probe.response.ok) {
        const probeBody = await probe.response.text();
        const bodySnippet = snippet(probeBody);
        lastProbeError = `url=${probeUrl} status=${probe.response.status} content-type=${probeCt || 'unknown'} body=${bodySnippet}`;
        const missingQuery = probe.response.status === 400 && /missing query parameters/i.test(probeBody);
        if (probe.response.status === 404 || missingQuery) {
          continue;
        }
        continue;
      }
      if (probeKind === 'json' || probeKind === 'html') {
        const probeText = await probe.response.text();
        logger?.warn?.('[replicate-media] /download-like probe returned JSON/HTML', {
          url: probeUrl,
          status: probe.response.status,
          contentType: probeCt || '(missing)',
          body: snippet(probeText),
        });
        const probePayload = parseJsonSafely(probeText);
        const probeCandidates = extractReplicateDownloadCandidates(probePayload, probe.finalUrl);
        if (probeCandidates.length > 0) {
          const candidate = toHttpUrlOrNull(probeCandidates[0]);
          if (candidate) return { url: candidate };
        }
        continue;
      }
      logger?.info?.('[replicate-media] resolved replicate download url', {
        host: (() => {
          try {
            return new URL(probe.finalUrl).host;
          } catch {
            return 'unknown';
          }
        })(),
        contentType: probeCt || '(missing)',
      });
      return { url: probe.finalUrl };
    }
    throw new Error(
      `Replicate file metadata has no usable download URL for ${lookup.finalUrl}.`
      + ` id=${metadataId || 'unknown'} name=${metadataName || 'unknown'} content_type=${metadataContentType || 'unknown'}.`
      + ` ${lastProbeError || 'No probe succeeded'}`
      + ' The files endpoint returned metadata instead of binary; verify Replicate file permissions and token scope.'
    );
  }

  return { url: lookup.finalUrl };
};

export const resolveReplicateDownloadUrl = async (
  fileOrUrl: string,
  options: Pick<DownloadOptions, 'token' | 'fetchFn' | 'logger'> = {}
): Promise<string> => {
  const target = await resolveReplicateDownloadTarget(fileOrUrl, options);
  if (isInvalidUrlInput(target.url)) {
    throw new Error(`resolveReplicateDownloadUrl produced invalid URL: ${String(target.url)}`);
  }
  return target.url;
};

export const downloadMediaWithValidation = async (
  sourceUrl: string,
  options: DownloadOptions = {},
  depth = 0
): Promise<DownloadedMedia> => {
  const {
    expectedKind,
    strictExpectedKind = false,
    token,
    fetchFn = fetch,
    logger,
  } = options;
  if (isInvalidUrlInput(sourceUrl)) {
    throw new Error(`downloadMediaWithValidation received invalid source URL: ${String(sourceUrl)}`);
  }
  if (depth > 4) {
    throw new Error(`Exceeded nested metadata depth while resolving ${sourceUrl}`);
  }

  let resolvedSourceUrl = sourceUrl;
  let preferredAccept = DEFAULT_REPLICATE_ACCEPT;
  if (isReplicateFilesUrl(sourceUrl)) {
    const target = await resolveReplicateDownloadTarget(sourceUrl, { token, fetchFn, logger });
    if (isInvalidUrlInput(target.url)) {
      throw new Error(`Replicate download target is invalid for source ${sourceUrl}: ${String(target.url)}`);
    }
    resolvedSourceUrl = target.url;
    if (target.preferredAccept) preferredAccept = target.preferredAccept;
  }

  const headers: Record<string, string> = {};
  if (isReplicateApiUrl(resolvedSourceUrl)) {
    const resolvedToken = resolveToken(token);
    if (!resolvedToken) {
      throw new Error('Missing REPLICATE_API_TOKEN');
    }
    Object.assign(headers, getReplicateHeaders(resolvedToken, preferredAccept));
  }

  const { response, finalUrl } = await fetchWithRetryForReplicate(
    fetchFn,
    resolvedSourceUrl,
    { headers },
    isReplicateApiUrl(resolvedSourceUrl)
  );
  const contentType = normalizeContentType(response.headers.get('content-type'));
  const kindFromContentType = inferMediaKindFromContentType(contentType);
  const kind = kindFromContentType === 'unknown' ? inferMediaKindFromUrl(finalUrl) : kindFromContentType;

  logger?.info?.('[replicate-media] fetch', {
    sourceUrl,
    resolvedSourceUrl,
    finalUrl,
    status: response.status,
    contentType: contentType || '(missing)',
    kind,
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(
      `Media fetch failed (${response.status}) for ${finalUrl}. content-type=${contentType || 'unknown'} body=${snippet(errorBody)}`
    );
  }

  const buffer = Buffer.from(await response.arrayBuffer());

  if (kind === 'json' || kind === 'html') {
    const text = buffer.toString('utf8');
    logger?.warn?.('[replicate-media] JSON/HTML returned while media expected', {
      status: response.status,
      contentType: contentType || '(missing)',
      body: snippet(text),
    });
    const payload = parseJsonSafely(text);
    const candidates = extractReplicateDownloadCandidates(payload, finalUrl);
    if (candidates.length > 0) {
      const nextUrl = toHttpUrlOrNull(candidates[0]);
      if (!nextUrl) {
        throw new Error(`downloadMediaWithValidation extracted invalid candidate URL: ${String(nextUrl)}`);
      }
      return await downloadMediaWithValidation(nextUrl, options, depth + 1);
    }
    throw new Error(
      `Expected downloadable media but got ${kind} from ${finalUrl}. content-type=${contentType || 'unknown'} body=${snippet(text)}`
    );
  }

  if (expectedKind && strictExpectedKind && kind !== expectedKind) {
    throw new Error(
      `Expected ${expectedKind} but got ${kind} from ${finalUrl}. content-type=${contentType || 'unknown'}`
    );
  }

  return {
    finalUrl,
    status: response.status,
    contentType: contentType || 'application/octet-stream',
    kind,
    buffer,
  };
};

export const resolveReplicatePublicOrSignedUrl = async (
  apiUrl: string,
  token: string,
  fetchFn: FetchLike = fetch
): Promise<string> => {
  if (isReplicateFilesUrl(apiUrl)) {
    return await resolveReplicateDownloadUrl(apiUrl, { token, fetchFn });
  }
  const media = await downloadMediaWithValidation(apiUrl, {
    token,
    fetchFn,
    strictExpectedKind: false,
  });
  return media.finalUrl;
};

