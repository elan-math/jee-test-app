// src/app/page.tsx
'use client'
import { createClient } from '../lib/supabaseClient'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'

// This is a simple "loader" page
// It checks if the user is logged in.
// If yes, it sends them to /dashboard
// If no, it sends them to /login
export default function Home() {
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        router.replace('/dashboard')
      } else {
        router.replace('/login')
      }
    }
    checkUser()
  }, [supabase, router])

  return (
    <div className="flex justify-center items-center min-h-screen">
      <p>Loading...</p> 
      {/* You can replace this with a nice spinner component later */}
    </div>
  )
}