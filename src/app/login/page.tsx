'use client'

import { createClient } from '../../lib/supabase/client'

export default function LoginPage() {
  const handleGitHubLogin = async () => {
    const supabase = createClient()
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    })
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0f172a' }}>
      <div style={{ textAlign: 'center' }}>
        <h1 style={{ color: 'white', fontSize: '1.75rem', marginBottom: '1.5rem' }}>Sign in to Benve Control</h1>
        <button
          onClick={handleGitHubLogin}
          style={{
            backgroundColor: '#1e293b',
            color: 'white',
            padding: '0.75rem 1.5rem',
            borderRadius: '0.5rem',
            border: '1px solid #334155',
            cursor: 'pointer',
            fontSize: '1rem',
          }}
        >
          Sign in with GitHub
        </button>
      </div>
    </div>
  )
}   