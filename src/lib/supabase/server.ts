import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { SUPABASE_URL, SUPABASE_PUBLIC_KEY } from './env'

// Used in Server Components, Server Actions, and Route Handlers.
export async function createClient() {
  const cookieStore = await cookies()

  return createServerClient(
    SUPABASE_URL,
    SUPABASE_PUBLIC_KEY,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from a Server Component that can't set cookies directly.
            // Safe to ignore here because our middleware refreshes sessions.
          }
        },
      },
    }
  )
}