import { createBrowserClient } from '@supabase/ssr'
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY } from './env'

// Used in Client Components (anything with 'use client' at the top).
export function createClient() {
  return createBrowserClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY
  )
}