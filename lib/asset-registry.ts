import fs from 'fs/promises';
import path from 'path';

export type StoredAssetType = 'image' | 'video' | 'script' | 'audio';

export type StoredAsset = {
  id: string;
  userId: string;
  type: StoredAssetType;
  url: string;
  name: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

const ASSETS_DB_PATH = path.join(process.cwd(), 'data', 'assets.json');

const ensureDataDir = async () => {
  await fs.mkdir(path.dirname(ASSETS_DB_PATH), { recursive: true });
};

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const normalizeAssetType = (value: unknown): StoredAssetType => {
  const normalized = safeTrim(value).toLowerCase();
  return normalized === 'video' || normalized === 'script' || normalized === 'audio'
    ? normalized
    : 'image';
};

export const normalizeAsset = (
  value: unknown,
  userId: string
): StoredAsset | null => {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const url = safeTrim(record.url);
  if (!url) return null;
  const id = safeTrim(record.id) || `asset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const name = safeTrim(record.name) || 'Generated Asset';
  const metadata = record.metadata && typeof record.metadata === 'object'
    ? record.metadata as Record<string, unknown>
    : undefined;

  return {
    id,
    userId,
    type: normalizeAssetType(record.type),
    url,
    name,
    createdAt: safeTrim(record.createdAt) || new Date().toISOString(),
    ...(metadata ? { metadata } : {}),
  };
};

export const readAssets = async (): Promise<StoredAsset[]> => {
  try {
    const raw = await fs.readFile(ASSETS_DB_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error: any) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
};

export const writeAssets = async (assets: StoredAsset[]) => {
  await ensureDataDir();
  const tempPath = ASSETS_DB_PATH.replace(/\.json$/, `.tmp-${Date.now()}.json`);
  await fs.writeFile(tempPath, JSON.stringify(assets, null, 2));
  await fs.rename(tempPath, ASSETS_DB_PATH);
};

export const listAssetsForUser = async (userId: string) => {
  const safeUserId = safeTrim(userId);
  if (!safeUserId) return [];
  const assets = await readAssets();
  return assets
    .filter((asset) => asset.userId === safeUserId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
};

export const upsertAsset = async (asset: StoredAsset) => {
  const assets = await readAssets();
  const existingIndex = assets.findIndex((item) => item.id === asset.id && item.userId === asset.userId);
  if (existingIndex >= 0) {
    assets[existingIndex] = { ...assets[existingIndex], ...asset };
  } else {
    assets.push(asset);
  }
  await writeAssets(assets);
};

export const deleteAsset = async (userId: string, assetId: string) => {
  const assets = await readAssets();
  const next = assets.filter((asset) => !(asset.userId === userId && asset.id === assetId));
  if (next.length === assets.length) return false;
  await writeAssets(next);
  return true;
};
