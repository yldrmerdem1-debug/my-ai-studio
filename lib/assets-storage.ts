/**
 * Utility functions for saving assets to localStorage
 * This will be used by various AI generation pages to auto-save outputs
 */

export interface Asset {
  id: string;
  type: 'image' | 'video' | 'script' | 'audio';
  url: string;
  name: string;
  createdAt: string;
  metadata?: {
    model?: string;
    prompt?: string;
    [key: string]: any;
  };
}

const ASSETS_KEY = 'aiAssets';
const ASSET_CACHE_USER_KEY = 'assetCacheUserId';

const resolveLocalUserId = () => {
  if (typeof window === 'undefined') return '';
  const envUserId = process.env.NEXT_PUBLIC_PERSONA_USER_ID;
  const storedId = localStorage.getItem('localUserId');
  const generatedId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `user_${Date.now()}`;
  const id = envUserId || storedId || generatedId;
  if (!storedId) {
    localStorage.setItem('localUserId', id);
  }
  return id;
};

const resolveAssetCacheKey = () => {
  if (typeof window === 'undefined') return ASSETS_KEY;
  const ownerId = localStorage.getItem(ASSET_CACHE_USER_KEY) || resolveLocalUserId();
  return ownerId ? `${ASSETS_KEY}:${ownerId}` : ASSETS_KEY;
};

const setAssetCacheUserId = (userId: string) => {
  if (typeof window === 'undefined' || !userId) return;
  localStorage.setItem(ASSET_CACHE_USER_KEY, userId);
};

const notifyAssetUpdate = () => {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('assets:updated'));
};

async function getAssetRequestHeaders(): Promise<HeadersInit> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  try {
    const { getSupabaseBrowserClient } = await import('@/lib/supabase/client');
    const supabase = getSupabaseBrowserClient();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) {
      setAssetCacheUserId(data.session?.user?.id || '');
      headers.Authorization = `Bearer ${token}`;
      return headers;
    }
  } catch {
    // Keep local/dev fallback working when Supabase auth is not wired yet.
  }
  const localUserId = resolveLocalUserId();
  if (localUserId) {
    setAssetCacheUserId(localUserId);
    headers['X-Local-User-Id'] = localUserId;
  }
  return headers;
}

async function syncAssetToBackend(asset: Asset) {
  try {
    await fetch('/api/assets', {
      method: 'POST',
      headers: await getAssetRequestHeaders(),
      body: JSON.stringify({ asset }),
    });
  } catch (error) {
    console.warn('Failed to sync asset to backend', error);
  }
}

export async function fetchAssets(): Promise<Asset[]> {
  try {
    const response = await fetch(`/api/assets?t=${Date.now()}`, {
      cache: 'no-store',
      headers: {
        ...await getAssetRequestHeaders(),
        Pragma: 'no-cache',
      },
    });
    const data = await response.json().catch(() => ({}));
    if (response.ok && Array.isArray(data.assets)) {
      localStorage.setItem(resolveAssetCacheKey(), JSON.stringify(data.assets));
      return data.assets;
    }
  } catch (error) {
    console.warn('Failed to fetch backend assets, using local cache', error);
  }
  return getAssets();
}

export function saveAsset(asset: Omit<Asset, 'id' | 'createdAt'>): Asset {
  const newAsset: Asset = {
    ...asset,
    id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
  };

  const existingAssets = getAssets();
  const updatedAssets = [newAsset, ...existingAssets];
  localStorage.setItem(resolveAssetCacheKey(), JSON.stringify(updatedAssets));
  notifyAssetUpdate();
  void syncAssetToBackend(newAsset);

  return newAsset;
}

export function getAssets(): Asset[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const saved = localStorage.getItem(resolveAssetCacheKey())
      || localStorage.getItem(ASSETS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

export function deleteAsset(id: string): void {
  const assets = getAssets();
  const updatedAssets = assets.filter(asset => asset.id !== id);
  localStorage.setItem(resolveAssetCacheKey(), JSON.stringify(updatedAssets));
  notifyAssetUpdate();
  void getAssetRequestHeaders()
    .then((headers) => fetch(`/api/assets?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    }))
    .catch((error) => console.warn('Failed to delete backend asset', error));
}

export function saveImageAsset(imageUrl: string, name: string, metadata?: Asset['metadata']): Asset {
  return saveAsset({
    type: 'image',
    url: imageUrl,
    name,
    metadata,
  });
}

export function saveVideoAsset(videoUrl: string, name: string, metadata?: Asset['metadata']): Asset {
  return saveAsset({
    type: 'video',
    url: videoUrl,
    name,
    metadata,
  });
}

export function saveScriptAsset(script: string, name: string, metadata?: Asset['metadata']): Asset {
  const dataUrl = `data:text/plain;base64,${btoa(script)}`;
  
  return saveAsset({
    type: 'script',
    url: dataUrl,
    name,
    metadata: {
      ...metadata,
      scriptText: script,
    },
  });
}

export function saveAudioAsset(audioUrl: string, name: string, metadata?: Asset['metadata']): Asset {
  return saveAsset({
    type: 'audio',
    url: audioUrl,
    name,
    metadata,
  });
}
