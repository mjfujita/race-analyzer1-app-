// race.db を gzip 圧縮して Supabase Storage にアップロード。
//
// 使い方:
//   cd ~/projects/race-analyzer-app
//   node scripts/push_db.js
//
// .env.local で下記を設定:
//   SUPABASE_PROJECT_URL=https://YOUR.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx (または eyJ... JWT)
//   RACE_DB_PATH=/Users/fujitamasaru/projects/backend/race.db
//   RACE_DB_BUCKET=race-db
//   RACE_DB_OBJECT=race.db.gz
import { readFileSync, statSync, createReadStream, createWriteStream } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envPath = resolve(__dirname, '..', '.env.local')

function loadEnv(path) {
  const text = readFileSync(path, 'utf8')
  const out = {}
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const i = line.indexOf('=')
    if (i < 0) continue
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const env = loadEnv(envPath)
const url = env.SUPABASE_PROJECT_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
const dbPath = env.RACE_DB_PATH
const bucket = env.RACE_DB_BUCKET || 'race-db'
const object = env.RACE_DB_OBJECT || 'race.db.gz'

if (!url) throw new Error('SUPABASE_PROJECT_URL が .env.local に未設定')
if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY が .env.local に未設定')
if (!dbPath) throw new Error('RACE_DB_PATH が .env.local に未設定')

const rawSize = statSync(dbPath).size
const rawMb = (rawSize / 1024 / 1024).toFixed(1)
console.log('📤 アップロード準備')
console.log(`   from: ${dbPath} (${rawMb} MB)`)
console.log(`   to:   ${url} / ${bucket} / ${object}`)

const gzPath = resolve(tmpdir(), 'race-db-upload.gz')
console.log('🗜  gzip 圧縮中...')
const compressStart = Date.now()
await pipeline(createReadStream(dbPath), createGzip({ level: 9 }), createWriteStream(gzPath))
const gzSize = statSync(gzPath).size
const gzMb = (gzSize / 1024 / 1024).toFixed(1)
const compressSec = ((Date.now() - compressStart) / 1000).toFixed(1)
console.log(`   ${rawMb} MB → ${gzMb} MB (${compressSec}s)`)

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
})

const { data: bList, error: bErr } = await supabase.storage.listBuckets()
if (bErr) {
  console.error('❌ バケット一覧取得失敗:', bErr.message)
  process.exit(1)
}
const exists = bList?.some((b) => b.name === bucket)
if (!exists) {
  console.log(`📦 バケット ${bucket} が存在しないので作成します（プライベート、上限 50MB）`)
  const { error: cErr } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: 52428800, // 50MB (Free Plan の上限)
    allowedMimeTypes: ['application/gzip', 'application/octet-stream'],
  })
  if (cErr) {
    console.error('❌ バケット作成失敗:', cErr.message)
    process.exit(1)
  }
}

console.log('⬆️  アップロード中...')
const uploadStart = Date.now()
const file = readFileSync(gzPath)
const { data, error } = await supabase.storage
  .from(bucket)
  .upload(object, file, {
    upsert: true,
    contentType: 'application/gzip',
  })

if (error) {
  console.error('❌ アップロード失敗:', error.message)
  process.exit(1)
}

const uploadSec = ((Date.now() - uploadStart) / 1000).toFixed(1)
console.log(`✅ アップロード成功 (${uploadSec}s)`)
console.log('   path:', data?.path)
