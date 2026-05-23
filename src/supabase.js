import { createClient } from '@supabase/supabase-js'

// 公開鍵 (publishable / anon)。ブラウザにバンドルされる前提なので埋め込み OK。
// 機密 (service_role) は絶対にここに書かない。
const SUPABASE_URL = 'https://ojolpyqetwqqnlzhsrgq.supabase.co'
const SUPABASE_ANON_KEY = 'sb_publishable_-fOuSkdcnaX8GbLiBLGrbQ_emXytt3m'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

export const RACE_DB_BUCKET = 'race-db'
export const RACE_DB_OBJECT = 'race.db.gz'
