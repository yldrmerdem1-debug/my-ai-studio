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

export function saveAsset(asset: Omit<Asset, 'id' | 'createdAt'>): Asset {
  const newAsset: Asset = {
    ...asset,
    id: `asset-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    createdAt: new Date().toISOString(),
  };

  const existingAssets = getAssets();
  const updatedAssets = [newAsset, ...existingAssets];
  localStorage.setItem(ASSETS_KEY, JSON.stringify(updatedAssets));

  return newAsset;
}

export function getAssets(): Asset[] {
  if (typeof window === 'undefined') return [];
  
  try {
    const saved = localStorage.getItem(ASSETS_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (error) {
    return [];
  }
}

export function deleteAsset(id: string): void {
  const assets = getAssets();
  const updatedAssets = assets.filter(asset => asset.id !== id);
  localStorage.setItem(ASSETS_KEY, JSON.stringify(updatedAssets));
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
