// src/app/login/page.tsx
'use client' // This tells Next.js this is a client-side component

import { createClient } from '../../lib/supabaseClient'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

export default function Login() {
  const supabase = createClient()
  const router = useRouter()

  // When the user logs in, redirect them to the dashboard
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN') {
        router.push('/dashboard')
      }
    })

    // Cleanup subscription on unmount
    return () => subscription.unsubscribe()
  }, [supabase, router])

  return (
    <div className="flex justify-center items-center min-h-screen bg-gray-100">
      <div className="w-full max-w-md p-8 bg-white rounded-lg shadow-md">
        <h1 className="text-2xl font-bold text-center mb-6">JEE Test App</h1>
        <Auth
          supabaseClient={supabase}
          appearance={{ theme: ThemeSupa }}
          providers={['google']} // You can add 'google', 'github' etc.
          theme="light"
          socialLayout="horizontal"
        />
      </div>
    </div>
  )
}