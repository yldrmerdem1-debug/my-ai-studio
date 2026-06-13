import { NextRequest, NextResponse } from 'next/server';
import { deleteAsset, listAssetsForUser, normalizeAsset, upsertAsset } from '@/lib/asset-registry';
import { requireAuthenticatedUser } from '@/lib/auth-user';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');
type NormalizedAsset = NonNullable<ReturnType<typeof normalizeAsset>>;

const isMissingRelation = (error: unknown) => {
  const message = String((error as any)?.message || error || '').toLowerCase();
  return message.includes('does not exist') || message.includes('could not find') || message.includes('schema cache');
};

const toSupabasePayload = (asset: NormalizedAsset) => ({
  id: asset.id,
  user_id: asset.userId,
  type: asset.type,
  url: asset.url,
  name: asset.name,
  created_at: asset.createdAt,
  metadata: asset.metadata || {},
});

const syncAssetToSupabase = async (asset: NormalizedAsset) => {
  const { client, error } = getSupabaseAdminClient();
  if (!client || error) return { ok: false, warning: error || 'Supabase not configured' };
  const result = await client
    .from('assets')
    .upsert(toSupabasePayload(asset), { onConflict: 'id' });
  if (result.error) {
    if (!isMissingRelation(result.error)) {
      console.warn('[assets] Supabase upsert failed:', result.error);
    }
    return { ok: false, warning: result.error.message };
  }
  return { ok: true };
};

const deleteAssetFromSupabase = async (userId: string, id: string) => {
  const { client, error } = getSupabaseAdminClient();
  if (!client || error) return;
  const result = await client
    .from('assets')
    .delete()
    .eq('user_id', userId)
    .eq('id', id);
  if (result.error && !isMissingRelation(result.error)) {
    console.warn('[assets] Supabase delete failed:', result.error);
  }
};

const listSupabaseAssets = async (userId: string) => {
  const { client, error } = getSupabaseAdminClient();
  if (!client || error) return null;
  const result = await client
    .from('assets')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (result.error) {
    if (!isMissingRelation(result.error)) {
      console.warn('[assets] Supabase list failed:', result.error);
    }
    return null;
  }
  return (result.data || []).map((row: any) => ({
    id: row.id,
    userId: row.user_id,
    type: row.type,
    url: row.url,
    name: row.name,
    createdAt: row.created_at,
    metadata: row.metadata || undefined,
  }));
};

export async function GET(request: NextRequest) {
  const userCheck = await requireAuthenticatedUser(request);
  if (!userCheck.ok) return NextResponse.json(userCheck.body, { status: userCheck.status });

  const supabaseAssets = await listSupabaseAssets(userCheck.userId);
  if (supabaseAssets) {
    return NextResponse.json({ assets: supabaseAssets, source: 'supabase', authSource: userCheck.source });
  }

  const assets = await listAssetsForUser(userCheck.userId);
  return NextResponse.json({ assets, source: 'local', authSource: userCheck.source });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const userCheck = await requireAuthenticatedUser(request);
  if (!userCheck.ok) return NextResponse.json(userCheck.body, { status: userCheck.status });

  const asset = normalizeAsset(body.asset || body, userCheck.userId);
  if (!asset) {
    return NextResponse.json({ error: 'Asset URL is required', code: 'ASSET_URL_REQUIRED' }, { status: 400 });
  }

  await upsertAsset(asset);
  const sync = await syncAssetToSupabase(asset);
  return NextResponse.json({
    success: true,
    asset,
    source: sync.ok ? 'supabase+local' : 'local',
    authSource: userCheck.source,
    ...(sync.warning ? { warning: sync.warning } : {}),
  });
}

export async function DELETE(request: NextRequest) {
  const id = safeTrim(request.nextUrl.searchParams.get('id'));
  const userCheck = await requireAuthenticatedUser(request);
  if (!userCheck.ok) return NextResponse.json(userCheck.body, { status: userCheck.status });
  if (!id) {
    return NextResponse.json({ error: 'Asset id is required', code: 'ASSET_ID_REQUIRED' }, { status: 400 });
  }

  const deleted = await deleteAsset(userCheck.userId, id);
  await deleteAssetFromSupabase(userCheck.userId, id);
  return NextResponse.json({ success: true, deleted });
}
