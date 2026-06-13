import { NextRequest, NextResponse } from 'next/server';
import { requireAuthenticatedUser } from '@/lib/auth-user';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  const user = await requireAuthenticatedUser(request);
  if (!user.ok) {
    return NextResponse.json({
      isAuthenticated: false,
      isAdmin: false,
    });
  }

  return NextResponse.json({
    isAuthenticated: true,
    isAdmin: user.isAdmin === true,
    email: user.email || null,
    userId: user.userId,
  });
}
