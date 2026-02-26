import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST /api/save-persona for saving persona.' },
    { status: 404 }
  );
}

export async function POST() {
  return NextResponse.json(
    { error: 'Use POST /api/save-persona for saving persona.' },
    { status: 404 }
  );
}
