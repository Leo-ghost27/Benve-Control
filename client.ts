// Server-side Supabase client.
// No keys, passwords, or secrets live in this file or anywhere in this repo.
// Values are read at runtime from environment variables — NEXT_PUBLIC_SUPABASE_URL
// and NEXT_PUBLIC_SUPABASE_ANON_KEY — set locally in .env.local (never committed)
// and, in production, in Netlify's environment variable settings.

import { createClient } from "@supabase/supabase-js";

export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return null;
  }

  return createClient(supabaseUrl, supabaseAnonKey);
}
