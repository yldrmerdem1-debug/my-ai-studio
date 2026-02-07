import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase env missing', {
        hasUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(supabaseServiceKey),
      });
      return NextResponse.json(
        { error: 'Supabase not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    console.log('FETCHING personas FROM SUPABASE...');
    const userId = request.nextUrl.searchParams.get('userId');
    let query = supabase
      .from('personas')
      .select('*')
      .order('created_at', { ascending: false });
    if (userId) {
      query = query.eq('user_id', userId);
    }
    const { data, error } = await query;
    if (error) {
      console.error('Personas list error:', error);
      return NextResponse.json(
        { error: 'Database error', details: error },
        { status: 500 }
      );
    }
    console.log('🔥 RAW DB DATA (First Item):', (data ?? [])[0]);
    return NextResponse.json(Array.isArray(data) ? data : []);
  } catch (error: any) {
    console.error('Personas list error:', error);
    return NextResponse.json(
      { error: 'Database error', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
