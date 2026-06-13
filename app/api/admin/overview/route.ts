import { NextRequest, NextResponse } from 'next/server';
import { requireAdminUser } from '@/lib/auth-user';
import { readAssets } from '@/lib/asset-registry';
import { readPersonas } from '@/lib/persona-registry';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const countBy = <T,>(items: T[], getKey: (item: T) => string | undefined) =>
  items.reduce<Record<string, number>>((acc, item) => {
    const key = getKey(item) || 'unknown';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

const unique = (values: Array<string | undefined>) =>
  Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));

export async function GET(request: NextRequest) {
  const admin = await requireAdminUser(request);
  if (!admin.ok) return NextResponse.json(admin.body, { status: admin.status });

  const [assets, personas] = await Promise.all([
    readAssets(),
    readPersonas(),
  ]);

  const users = unique([
    ...assets.map((asset) => asset.userId),
    ...personas.map((persona) => persona.userId),
  ]);

  const recentAssets = [...assets]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 8)
    .map((asset) => ({
      id: asset.id,
      name: asset.name,
      type: asset.type,
      userId: asset.userId,
      createdAt: asset.createdAt,
      model: typeof asset.metadata?.model === 'string' ? asset.metadata.model : undefined,
    }));

  const recentPersonas = [...personas]
    .sort((a, b) => new Date(b.createdAt || '').getTime() - new Date(a.createdAt || '').getTime())
    .slice(0, 8)
    .map((persona) => ({
      id: persona.personaId,
      name: persona.name || persona.triggerWord || 'Persona',
      subjectType: persona.subjectType || 'unknown',
      status: persona.status || persona.visualStatus || 'unknown',
      userId: persona.userId,
      createdAt: persona.createdAt,
    }));

  return NextResponse.json({
    admin: {
      userId: admin.userId,
      email: admin.email,
      source: admin.source,
    },
    totals: {
      users: users.length,
      assets: assets.length,
      personas: personas.length,
      videos: assets.filter((asset) => asset.type === 'video').length,
      images: assets.filter((asset) => asset.type === 'image').length,
    },
    breakdown: {
      assetsByType: countBy(assets, (asset) => asset.type),
      personasByStatus: countBy(personas, (persona) => persona.status || persona.visualStatus),
      personasBySubject: countBy(personas, (persona) => persona.subjectType),
    },
    recentAssets,
    recentPersonas,
  });
}
