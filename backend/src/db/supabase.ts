import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config()

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
  // It's okay to fail here during build/dev if vars aren't set, 
  // but we should warn.
  console.warn('Supabase credentials not found in environment variables.')
}

// Create a dummy client or a real one depending on config
// We'll throw only if someone tries to USE it without config, but here we must return a client object
// OR we return null and handle it in the consumer.
// However, existing code expects 'supabase' to be exported.

export const supabase = createClient(supabaseUrl || 'https://placeholder.supabase.co', supabaseKey || 'placeholder')
