/**
 * Public Supabase connection settings.
 *
 * Supabase now labels the browser-safe key "publishable"; older projects (and this
 * codebase) call it the "anon" key. Both are the same kind of public key, so either
 * variable name is accepted. The references must stay literal (no dynamic lookups):
 * Next.js only inlines NEXT_PUBLIC_* values it can see written out in the source.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
export const SUPABASE_PUBLIC_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!;
