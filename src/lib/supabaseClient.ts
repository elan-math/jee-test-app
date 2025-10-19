// src/lib/supabaseClient.ts
import { createPagesBrowserClient } from '@supabase/auth-helpers-nextjs'

// We use createPagesBrowserClient here, which works well with Next.js App Router
// This function creates a new Supabase client on the browser side.
export const createClient = () =>
  createPagesBrowserClient({
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  })