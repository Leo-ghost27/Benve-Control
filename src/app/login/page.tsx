'use client'

import { useState } from 'react'
import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleGitHubLogin = async () => {
    setError(null)
    setLoading(true)
    try {
      const supabase = createClient()
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: 'github',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
        },
      })
      if (authError) {
        console.error('Supabase signInWithOAuth error:', authError)
        setError(authError.message)
        setLoading(false)
      }
      // On success, Supabase redirects the browser away from this page,
      // so there is nothing further to do here.
    } catch (err) {
      console.error('Unexpected error during sign-in:', err)
      setError(
        err instanceof Error ? err.message : 'Unexpected error signing in. Check the browser console for details.'
      )
      setLoading(false)
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' }}>
      <div style={{ textAlign: 'center', maxWidth: '360px', padding: '0 1rem' }}>
        <h1 style={{ color: 'white', fontSize: '1.75rem', marginBottom: '1.5rem' }}>Sign in to Benve Control</h1>
        <button
          onClick={handleGitHubLogin}
          disabled={loading}
          style={{
            backgroundColor: '#1e293b',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            border: '1px solid #334155',
            cursor: loading ? 'default' : 'pointer',
            fontSize: '1rem',
            opacity: loading ? 0.7 : 1,
          }}
        >
          {loading ? 'Redirecting…' : 'Sign in with GitHub'}
        </button>
        {error && (
          <p style={{ color: '#f87171', fontSize: '0.875rem', marginTop: '1rem', lineHeight: 1.5 }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}