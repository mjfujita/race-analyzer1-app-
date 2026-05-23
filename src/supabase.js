import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  // eslint-disable-next-line no-console
  console.warn('Supabase env vars missing. Set VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY in .env.local')
}

export const supabase = createClient(SUPABASE_URL ?? '', SUPABASE_ANON_KEY ?? '')

export const RACE_DB_BUCKET = import.meta.env.VITE_RACE_DB_BUCKET || 'race-db'
export const RACE_DB_OBJECT = import.meta.env.VITE_RACE_DB_OBJECT || 'race.db'
