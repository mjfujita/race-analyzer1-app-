// Supabase Storage の中身を確認するデバッグスクリプト
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = Object.fromEntries(
  readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)

const supabase = createClient(env.SUPABASE_PROJECT_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
})

console.log('=== Buckets ===')
const { data: buckets, error: bErr } = await supabase.storage.listBuckets()
if (bErr) {
  console.error(bErr)
  process.exit(1)
}
for (const b of buckets) {
  console.log(`  - ${b.name} (public=${b.public}, id=${b.id})`)
}

const bucket = env.RACE_DB_BUCKET || 'race-db'
console.log(`\n=== Objects in "${bucket}" ===`)
const { data: objs, error: oErr } = await supabase.storage.from(bucket).list('', { limit: 100 })
if (oErr) {
  console.error(oErr)
  process.exit(1)
}
if (!objs || objs.length === 0) {
  console.log('  (empty)')
} else {
  for (const o of objs) {
    console.log(`  - ${o.name} (size=${o.metadata?.size ?? '?'}, mime=${o.metadata?.mimetype ?? '?'})`)
  }
}

console.log(`\n=== Try createSignedUrl("${env.RACE_DB_OBJECT || 'race.db.gz'}") ===`)
const { data: signed, error: sErr } = await supabase.storage
  .from(bucket)
  .createSignedUrl(env.RACE_DB_OBJECT || 'race.db.gz', 60)
if (sErr) {
  console.error('  ❌', sErr.message)
} else {
  console.log('  ✅ signed URL OK:', signed.signedUrl.slice(0, 100) + '...')
}
