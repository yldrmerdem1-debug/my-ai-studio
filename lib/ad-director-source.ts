import { downloadMediaWithValidation } from '@/lib/replicate-media';

export type DirectorProductSnapshot = {
  brand: string;
  campaigns: string[];
  category: string;
  description: string;
  extractedSignals: string[];
  features: string[];
  fetchedPage: boolean;
  hostname: string;
  imageUrl: string;
  merchant: string;
  price: string;
  rating: string;
  reviewCount: string;
  snippet: string;
  title: string;
  url: string;
  usedDirectImageUrl: boolean;
};

export type DirectorInlineImage = {
  data: string;
  mimeType: string;
  sourceUrl: string;
};

export type DirectorResolvedInlineImage = {
  image: DirectorInlineImage;
  sourceUrl: string;
  usedFallback: boolean;
};

const IMAGE_URL_RE = /\.(png|jpe?g|webp|gif|bmp|avif)(\?|#|$)/i;
const ATTRIBUTE_KEY_HINT_RE =
  /(feature|ozellik|özellik|material|materyal|color|renk|size|beden|boyut|fabric|kumas|kumaş|fit|style|kategori|category|tip|type|screen|ekran|storage|hafiza|hafıza|memory|ram|battery|batarya|processor|işlemci|capacity|kapasite|volume|hacim|model|seri|brand|marka)/i;
const PROMOTION_HINT_RE =
  /(indirim|discount|kampanya|campaign|sepette|coupon|kupon|free shipping|kargo|öde|pay less|deal|special|fırsat)/i;
const CATEGORY_NOISE_RE =
  /^(home|anasayfa|trendyol|shop|shopping|en trend ürünler|all products)$/i;

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ');

const decodeJsonString = (value: string) => {
  const raw = safeTrim(value);
  if (!raw) return '';
  try {
    return decodeEntities(JSON.parse(`"${raw}"`)).trim();
  } catch {
    return decodeEntities(
      raw
        .replace(/\\"/g, '"')
        .replace(/\\\//g, '/')
        .replace(/\\n/g, ' ')
        .replace(/\\t/g, ' ')
    ).trim();
  }
};

const toAbsoluteUrl = (value: string, baseUrl: string) => {
  const trimmed = safeTrim(value);
  if (!trimmed) return '';
  try {
    return new URL(trimmed, baseUrl).toString();
  } catch {
    return '';
  }
};

const uniq = (items: string[]) => Array.from(new Set(items.map(item => safeTrim(item)).filter(Boolean)));

const pickFirst = (...values: Array<string | undefined>) => values.find(value => safeTrim(value))?.trim() || '';

const extractMatch = (html: string, patterns: RegExp[]) => {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const value = decodeEntities(safeTrim(match?.[1]));
    if (value) return value;
  }
  return '';
};

const stripHtml = (html: string) =>
  decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h\d)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ ]{2,}/g, ' ')
      .trim()
  );

const collectJsonLdBlocks = (html: string) => {
  const blocks: unknown[] = [];
  const scriptRe = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRe.exec(html))) {
    const raw = safeTrim(match[1]);
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      try {
        blocks.push(JSON.parse(decodeEntities(raw)));
      } catch {
        // ignore malformed blocks
      }
    }
  }
  return blocks;
};

const collectNodesByType = (
  value: unknown,
  expectedType: string,
  out: Array<Record<string, unknown>> = []
) => {
  if (Array.isArray(value)) {
    value.forEach(item => collectNodesByType(item, expectedType, out));
    return out;
  }

  if (!value || typeof value !== 'object') return out;

  const record = value as Record<string, unknown>;
  const typeValue = record['@type'];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (types.some(type => safeTrim(type).toLowerCase() === expectedType.toLowerCase())) {
    out.push(record);
  }

  Object.values(record).forEach(entry => collectNodesByType(entry, expectedType, out));
  return out;
};

const unwrapName = (value: unknown): string => {
  if (typeof value === 'string') return decodeEntities(value).trim();
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return pickFirst(
      typeof record.name === 'string' ? record.name : '',
      typeof record.title === 'string' ? record.title : '',
      typeof record.value === 'string' ? record.value : ''
    );
  }
  return '';
};

const collectNamedValues = (value: unknown, baseUrl: string): string[] => {
  if (!value) return [];
  if (typeof value === 'string') {
    const trimmed = decodeEntities(value).trim();
    if (!trimmed) return [];
    return [trimmed.startsWith('http') ? toAbsoluteUrl(trimmed, baseUrl) || trimmed : trimmed];
  }
  if (Array.isArray(value)) {
    return uniq(value.flatMap(item => collectNamedValues(item, baseUrl)));
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return uniq([
      unwrapName(record),
      ...Object.values(record).flatMap(entry => collectNamedValues(entry, baseUrl)),
    ]);
  }
  return [];
};

const extractJsonLdBreadcrumbs = (html: string) => {
  const blocks = collectJsonLdBlocks(html);
  const breadcrumbNodes = blocks.flatMap(block => collectNodesByType(block, 'BreadcrumbList'));
  const breadcrumbNames: string[] = [];

  breadcrumbNodes.forEach(node => {
    const itemList = Array.isArray(node.itemListElement) ? node.itemListElement : [];
    itemList.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const itemRecord = item as Record<string, unknown>;
      const name = unwrapName(itemRecord.item) || unwrapName(itemRecord.name);
      if (name && !CATEGORY_NOISE_RE.test(name)) {
        breadcrumbNames.push(name);
      }
    });
  });

  return uniq(breadcrumbNames).slice(0, 8);
};

const extractJsonLdProductDetails = (html: string, baseUrl: string) => {
  const blocks = collectJsonLdBlocks(html);
  const productNodes = blocks.flatMap(block => collectNodesByType(block, 'Product'));
  const features: string[] = [];
  const images: string[] = [];
  let title = '';
  let description = '';
  let brand = '';
  let category = '';
  let merchant = '';
  let price = '';
  let rating = '';
  let reviewCount = '';

  productNodes.forEach(node => {
    title ||= unwrapName(node.name);
    description ||= safeTrim(node.description);
    brand ||= unwrapName(node.brand);
    category ||= unwrapName(node.category);
    merchant ||= unwrapName(node.seller) || unwrapName(node.offers);
    images.push(...collectNamedValues(node.image, baseUrl).filter(item => item.startsWith('http')));

    const offers = Array.isArray(node.offers) ? node.offers[0] : node.offers;
    if (offers && typeof offers === 'object') {
      const offerRecord = offers as Record<string, unknown>;
      price ||= pickFirst(
        safeTrim(offerRecord.price),
        safeTrim(offerRecord.lowPrice),
        safeTrim(offerRecord.highPrice)
      );
      const currency = safeTrim(offerRecord.priceCurrency);
      if (price && currency) {
        price = `${price} ${currency}`;
      }
      merchant ||= unwrapName(offerRecord.seller);
    }

    const aggregateRating = node.aggregateRating;
    if (aggregateRating && typeof aggregateRating === 'object') {
      const ratingRecord = aggregateRating as Record<string, unknown>;
      rating ||= safeTrim(ratingRecord.ratingValue);
      reviewCount ||= pickFirst(safeTrim(ratingRecord.reviewCount), safeTrim(ratingRecord.ratingCount));
    }

    const additionalProperty = Array.isArray(node.additionalProperty)
      ? node.additionalProperty
      : Array.isArray(node.additionalProperties)
        ? node.additionalProperties
        : [];
    additionalProperty.forEach(property => {
      if (!property || typeof property !== 'object') return;
      const prop = property as Record<string, unknown>;
      const key = unwrapName(prop.name) || unwrapName(prop.propertyID);
      const value = unwrapName(prop.value) || unwrapName(prop.valueReference);
      if (key && value) features.push(`${key}: ${value}`);
    });
  });

  return {
    brand,
    category,
    description,
    features: uniq(features).slice(0, 12),
    imageUrl: images[0] || '',
    merchant,
    price,
    rating,
    reviewCount,
    title,
    used: productNodes.length > 0,
  };
};

const extractScriptStringValues = (html: string, keys: string[], limit = 10) => {
  const results: string[] = [];
  for (const key of keys) {
    const pattern = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.){1,260})"`, 'gi');
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(html))) {
      const value = decodeJsonString(match[1]);
      if (value) results.push(value);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }
  return uniq(results).slice(0, limit);
};

const extractScriptHints = (html: string) => {
  const brands = extractScriptStringValues(html, ['brandName', 'brand'], 4);
  const categories = extractScriptStringValues(
    html,
    ['categoryName', 'category_name', 'productCategoryName', 'productCategory'],
    6
  ).filter(value => !CATEGORY_NOISE_RE.test(value));
  const merchants = extractScriptStringValues(
    html,
    ['merchantName', 'sellerName', 'seller_name', 'merchantDisplayName'],
    4
  );
  const campaigns = extractScriptStringValues(
    html,
    ['campaignName', 'campaignText', 'promotionText', 'badgeText', 'discountLabel'],
    8
  ).filter(value => PROMOTION_HINT_RE.test(value));
  const prices = extractScriptStringValues(
    html,
    ['discountedPriceFormatted', 'sellingPrice', 'salePrice', 'discountedPrice'],
    4
  );
  const ratings = extractScriptStringValues(html, ['averageRating', 'ratingScore', 'ratingValue'], 4);
  const reviewCounts = extractScriptStringValues(html, ['reviewCount', 'ratingCount', 'commentCount'], 4);

  return {
    brand: brands[0] || '',
    campaigns,
    category: categories[0] || '',
    merchant: merchants[0] || '',
    price: prices[0] || '',
    rating: ratings[0] || '',
    reviewCount: reviewCounts[0] || '',
  };
};

const deriveCategory = (params: {
  breadcrumbNames: string[];
  jsonLdCategory: string;
  scriptCategory: string;
  title: string;
}) => {
  const breadcrumbTail = params.breadcrumbNames
    .filter(name => safeTrim(name).toLowerCase() !== safeTrim(params.title).toLowerCase())
    .slice(-2)
    .join(' > ');
  return pickFirst(params.jsonLdCategory, params.scriptCategory, breadcrumbTail);
};

const extractHeuristicPairs = (html: string, hostname: string) => {
  const pairs: string[] = [];
  const pairRe =
    /"(?:attributeName|attribute_name|attributeType|name|key)"\s*:\s*"([^"\\]{2,50})"[\s\S]{0,140}?"(?:attributeValue|attribute_value|value)"\s*:\s*"([^"\\]{1,120})"/gi;
  let match: RegExpExecArray | null;
  while ((match = pairRe.exec(html))) {
    const key = decodeEntities(match[1]).trim();
    const value = decodeEntities(match[2]).trim();
    if (!key || !value) continue;
    if (!ATTRIBUTE_KEY_HINT_RE.test(key) && !hostname.includes('trendyol')) continue;
    pairs.push(`${key}: ${value}`);
  }
  return uniq(pairs).slice(0, 12);
};

const extractTextFeatures = (plainText: string) => {
  const lines = plainText
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);
  const candidates = lines.filter(line => {
    if (line.length < 6 || line.length > 140) return false;
    if (line.includes(':')) return true;
    return ATTRIBUTE_KEY_HINT_RE.test(line);
  });
  return uniq(candidates).slice(0, 12);
};

const extractMetaDetails = (html: string, baseUrl: string) => ({
  brand: extractMatch(html, [
    /<meta[^>]+property=["']product:brand["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+name=["']brand["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]),
  description: extractMatch(html, [
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["'][^>]*>/i,
  ]),
  imageUrl: toAbsoluteUrl(
    extractMatch(html, [
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    ]),
    baseUrl
  ),
  price: pickFirst(
    extractMatch(html, [
      /<meta[^>]+property=["']product:price:amount["'][^>]+content=["']([^"']+)["'][^>]*>/i,
      /"sellingPrice"\s*:\s*"?(.*?)"?(,|\})/i,
      /"discountedPrice"\s*:\s*"?(.*?)"?(,|\})/i,
    ]),
    ''
  ),
  title: extractMatch(html, [
    /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["'][^>]*>/i,
    /<title[^>]*>([^<]*)<\/title>/i,
  ]),
});

const fetchUrlPayload = async (targetUrl: string) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(targetUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'no-cache',
        Pragma: 'no-cache',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
      },
    });
    const finalUrl = response.url || targetUrl;
    const contentType = safeTrim(response.headers.get('content-type')).toLowerCase();
    if (!response.ok) {
      return { contentType, finalUrl, html: '', ok: false as const };
    }
    if (contentType.startsWith('image/') || IMAGE_URL_RE.test(finalUrl)) {
      return { contentType, finalUrl, html: '', ok: true as const, usedDirectImageUrl: true as const };
    }
    return {
      contentType,
      finalUrl,
      html: await response.text(),
      ok: true as const,
      usedDirectImageUrl: false as const,
    };
  } catch {
    return { contentType: '', finalUrl: targetUrl, html: '', ok: false as const };
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchDirectorProductSnapshot = async (productUrl?: string): Promise<DirectorProductSnapshot | null> => {
  const normalizedUrl = safeTrim(productUrl);
  if (!/^https?:\/\//i.test(normalizedUrl)) return null;

  const payload = await fetchUrlPayload(normalizedUrl);
  const hostname = (() => {
    try {
      return new URL(payload.finalUrl).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  })();

  if (!payload.ok) {
    return {
      brand: '',
      campaigns: [],
      category: '',
      description: '',
      extractedSignals: ['page-fetch-failed'],
      features: [],
      fetchedPage: false,
      hostname,
      imageUrl: '',
      merchant: '',
      price: '',
      rating: '',
      reviewCount: '',
      snippet: '',
      title: '',
      url: normalizedUrl,
      usedDirectImageUrl: false,
    };
  }

  if (payload.usedDirectImageUrl) {
    return {
      brand: '',
      campaigns: [],
      category: '',
      description: '',
      extractedSignals: ['direct-image-url'],
      features: [],
      fetchedPage: false,
      hostname,
      imageUrl: payload.finalUrl,
      merchant: '',
      price: '',
      rating: '',
      reviewCount: '',
      snippet: '',
      title: '',
      url: normalizedUrl,
      usedDirectImageUrl: true,
    };
  }

  const html = payload.html;
  const meta = extractMetaDetails(html, payload.finalUrl);
  const jsonLd = extractJsonLdProductDetails(html, payload.finalUrl);
  const breadcrumbs = extractJsonLdBreadcrumbs(html);
  const scriptHints = extractScriptHints(html);
  const plainText = stripHtml(html);
  const featureCandidates = uniq([
    ...jsonLd.features,
    ...extractHeuristicPairs(html, hostname),
    ...extractTextFeatures(plainText),
  ]).slice(0, 12);

  const extractedSignals = uniq([
    jsonLd.used ? 'jsonld-product' : '',
    meta.imageUrl ? 'meta-image' : '',
    meta.price ? 'meta-price' : '',
    breadcrumbs.length > 0 ? 'jsonld-breadcrumbs' : '',
    scriptHints.merchant ? 'script-merchant' : '',
    scriptHints.campaigns.length > 0 ? 'script-campaigns' : '',
    hostname.includes('trendyol') ? 'trendyol-host' : '',
    featureCandidates.length > 0 ? 'feature-candidates' : '',
  ]);

  return {
    brand: pickFirst(jsonLd.brand, meta.brand, scriptHints.brand),
    campaigns: scriptHints.campaigns,
    category: deriveCategory({
      breadcrumbNames: breadcrumbs,
      jsonLdCategory: jsonLd.category,
      scriptCategory: scriptHints.category,
      title: pickFirst(jsonLd.title, meta.title),
    }),
    description: pickFirst(jsonLd.description, meta.description),
    extractedSignals,
    features: featureCandidates,
    fetchedPage: true,
    hostname,
    imageUrl: pickFirst(jsonLd.imageUrl, meta.imageUrl),
    merchant: pickFirst(jsonLd.merchant, scriptHints.merchant),
    price: pickFirst(jsonLd.price, meta.price, scriptHints.price),
    rating: pickFirst(jsonLd.rating, scriptHints.rating),
    reviewCount: pickFirst(jsonLd.reviewCount, scriptHints.reviewCount),
    snippet: plainText.slice(0, hostname.includes('trendyol') ? 5000 : 3500),
    title: pickFirst(jsonLd.title, meta.title),
    url: normalizedUrl,
    usedDirectImageUrl: false,
  };
};

const parseDataUrl = (value: string) => {
  const match = value.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { data: match[2], mimeType: match[1] };
};

export const resolveDirectorInlineImage = async (
  imageUrl: string,
  replicateToken?: string
): Promise<DirectorInlineImage | null> => {
  const trimmed = safeTrim(imageUrl);
  if (!trimmed) return null;

  if (trimmed.startsWith('data:')) {
    const parsed = parseDataUrl(trimmed);
    if (!parsed) return null;
    return {
      data: parsed.data,
      mimeType: parsed.mimeType,
      sourceUrl: trimmed,
    };
  }

  const media = await downloadMediaWithValidation(trimmed, {
    expectedKind: 'image',
    strictExpectedKind: true,
    token: replicateToken,
  });

  return {
    data: media.buffer.toString('base64'),
    mimeType: media.contentType || 'image/png',
    sourceUrl: media.finalUrl,
  };
};

export const resolveDirectorInlineImageCandidates = async (
  imageUrls: string[],
  replicateToken?: string
): Promise<DirectorResolvedInlineImage | null> => {
  const uniqueCandidates = uniq(imageUrls);
  let lastError: unknown = null;

  for (let index = 0; index < uniqueCandidates.length; index += 1) {
    const candidate = uniqueCandidates[index];
    try {
      const image = await resolveDirectorInlineImage(candidate, replicateToken);
      if (image) {
        return {
          image,
          sourceUrl: candidate,
          usedFallback: index > 0,
        };
      }
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  return null;
};
