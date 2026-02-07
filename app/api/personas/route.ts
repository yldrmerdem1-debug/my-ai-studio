import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Personas route env missing', {
        hasUrl: Boolean(supabaseUrl),
        hasServiceKey: Boolean(supabaseServiceKey),
      });
      return NextResponse.json([], { status: 200 });
    }
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userId = new URL(request.url).searchParams.get('userId');

    try {
      let modelQuery = supabase
        .from('model_trainings')
        .select('*')
        .order('created_at', { ascending: false });

      if (userId) {
        modelQuery = modelQuery.eq('user_id', userId);
      }

      const { data, error } = await modelQuery;
      if (error) {
        console.error('Personas route Supabase error:', error);
      } else if (Array.isArray(data) && data.length > 0) {
        return NextResponse.json(data, { status: 200 });
      }

      let personaQuery = supabase
        .from('personas')
        .select('*')
        .order('created_at', { ascending: false });
      if (userId) {
        personaQuery = personaQuery.eq('user_id', userId);
      }
      const { data: personaData, error: personaError } = await personaQuery;
      if (personaError) {
        console.error('Personas fallback error:', personaError);
        return NextResponse.json([], { status: 200 });
      }
      return NextResponse.json(Array.isArray(personaData) ? personaData : [], { status: 200 });
    } catch (queryError) {
      console.error('Personas route query error:', queryError);
      return NextResponse.json([], { status: 200 });
    }
  } catch (error) {
    console.error('Personas route error:', error);
    return NextResponse.json([], { status: 200 });
  }
}
