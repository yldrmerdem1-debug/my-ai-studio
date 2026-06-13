import type { NextRequest } from 'next/server';
import { getSupabaseAdminClient } from '@/lib/supabase/admin';

export type AuthenticatedUserResult =
  | { ok: true; userId: string; source: 'supabase' | 'local-dev'; email?: string; isAdmin?: boolean }
  | { ok: false; status: number; body: { error: string; code: string } };

const safeTrim = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const isLocalFallbackAllowed = () =>
  process.env.NODE_ENV !== 'production'
  || process.env.ASSETS_ALLOW_UNVERIFIED_USER_ID === 'true';

const parseCsv = (value: unknown) =>
  safeTrim(value)
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

const isConfiguredAdmin = (params: {
  email?: string;
  userId?: string;
  appRole?: string;
  userRole?: string;
}) => {
  const adminEmails = parseCsv(process.env.ADMIN_EMAILS);
  const adminUserIds = parseCsv(process.env.ADMIN_USER_IDS);
  const email = safeTrim(params.email).toLowerCase();
  const userId = safeTrim(params.userId).toLowerCase();
  const appRole = safeTrim(params.appRole).toLowerCase();
  const userRole = safeTrim(params.userRole).toLowerCase();
  return appRole === 'admin'
    || userRole === 'admin'
    || Boolean(email && adminEmails.includes(email))
    || Boolean(userId && adminUserIds.includes(userId));
};

const readBearerToken = (request: NextRequest) => {
  const authHeader = safeTrim(request.headers.get('authorization'));
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return safeTrim(match?.[1]);
};

const readLocalUserId = async (request: NextRequest) => {
  const headerUserId = safeTrim(request.headers.get('x-local-user-id'));
  if (headerUserId) return headerUserId;

  if (request.method === 'GET' || request.method === 'DELETE') {
    return safeTrim(request.nextUrl.searchParams.get('userId'));
  }

  try {
    const body = await request.clone().json();
    return safeTrim(body?.user?.id || body?.userId);
  } catch {
    return '';
  }
};

export const requireAuthenticatedUser = async (request: NextRequest): Promise<AuthenticatedUserResult> => {
  const token = readBearerToken(request);
  if (token) {
    const { client, error } = getSupabaseAdminClient();
    if (!client || error) {
      return {
        ok: false,
        status: 503,
        body: { error: 'Authentication service is not configured', code: 'AUTH_SERVICE_UNAVAILABLE' },
      };
    }

    const { data, error: userError } = await client.auth.getUser(token);
    const userId = safeTrim(data?.user?.id);
    if (userError || !userId) {
      return {
        ok: false,
        status: 401,
        body: { error: 'Invalid or expired session', code: 'SESSION_INVALID' },
      };
    }
    return {
      ok: true,
      userId,
      source: 'supabase',
      email: safeTrim(data.user?.email) || undefined,
      isAdmin: isConfiguredAdmin({
        userId,
        email: data.user?.email,
        appRole: data.user?.app_metadata?.role,
        userRole: data.user?.user_metadata?.role,
      }),
    };
  }

  const localUserId = await readLocalUserId(request);
  if (localUserId && isLocalFallbackAllowed()) {
    return {
      ok: true,
      userId: localUserId,
      source: 'local-dev',
      isAdmin: isConfiguredAdmin({ userId: localUserId }),
    };
  }

  return {
    ok: false,
    status: 401,
    body: { error: 'Login required', code: 'AUTH_REQUIRED' },
  };
};

export const requireAdminUser = async (request: NextRequest): Promise<AuthenticatedUserResult> => {
  const user = await requireAuthenticatedUser(request);
  if (!user.ok) return user;
  if (user.isAdmin) return user;
  return {
    ok: false,
    status: 403,
    body: { error: 'Admin access required', code: 'ADMIN_REQUIRED' },
  };
};

/**
 * Single source of truth for credit exemption. Admins (the platform owner)
 * never consume credits. When the credit system is added, gate the debit/charge
 * step behind `!isCreditExempt(user)` so admin generations stay free.
 */
export const isCreditExempt = (user: AuthenticatedUserResult): boolean =>
  user.ok === true && user.isAdmin === true;
