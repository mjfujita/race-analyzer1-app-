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
//
// アップロード方式:
//   Supabase Storage の TUS (resumable) API を使い、6MB ずつ・チャンクごとに新規 HTTPS 接続で送る。
//   チャンク送信が失敗しても HEAD で受信済みオフセットを取り直して同じチャンクから再送する。
//   （2026-09-19: 1接続で 10MB 前後を超える TLS 送信が経路上で壊れて "fetch failed" になる事象への対策。
//     単発 PUT だと 28MB を一度に送るため必ず失敗していた）
//   アップロード後に Storage から再ダウンロードして SHA-256 を照合する。
import { readFileSync, statSync, createReadStream, createWriteStream, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { createHash } from 'node:crypto'
import https from 'node:https'
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

// フロント不要テーブルを落とした軽量版があればそれを優先（容量削減）
const frontendPath = dbPath.replace(/\.db$/, '.db.frontend')
let actualDbPath = dbPath
if (existsSync(frontendPath)) {
  const srcMtime = statSync(dbPath).mtime.getTime()
  const fmtime = statSync(frontendPath).mtime.getTime()
  if (fmtime >= srcMtime) {
    actualDbPath = frontendPath
    console.log(`📦 軽量版を使用: ${frontendPath}`)
  } else {
    console.log('⚠️  軽量版が古いため再生成が必要 (scripts/build_frontend_db.py を実行)')
  }
}

const rawSize = statSync(actualDbPath).size
const rawMb = (rawSize / 1024 / 1024).toFixed(1)
console.log('📤 アップロード準備')
console.log(`   from: ${actualDbPath} (${rawMb} MB)`)
console.log(`   to:   ${url} / ${bucket} / ${object}`)

const gzPath = resolve(tmpdir(), 'race-db-upload.gz')
console.log('🗜  gzip 圧縮中...')
const compressStart = Date.now()
await pipeline(createReadStream(actualDbPath), createGzip({ level: 9 }), createWriteStream(gzPath))
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
// gzip サイズに余裕を持たせて 256MB を上限に設定（必要なら拡張）
const BUCKET_FILE_SIZE_LIMIT = 268435456 // 256MB
const exists = bList?.some((b) => b.name === bucket)
if (!exists) {
  console.log(`📦 バケット ${bucket} を新規作成（プライベート、上限 ${(BUCKET_FILE_SIZE_LIMIT/1024/1024).toFixed(0)}MB）`)
  const { error: cErr } = await supabase.storage.createBucket(bucket, {
    public: false,
    fileSizeLimit: BUCKET_FILE_SIZE_LIMIT,
    allowedMimeTypes: ['application/gzip', 'application/octet-stream'],
  })
  if (cErr) {
    console.error('❌ バケット作成失敗:', cErr.message)
    process.exit(1)
  }
} else if (gzSize > 50 * 1024 * 1024) {
  // 既存バケットの上限を引き上げる（gzip が 50MB を超えた場合のみ）
  console.log(`🔧 既存バケット ${bucket} のファイル上限を ${(BUCKET_FILE_SIZE_LIMIT/1024/1024).toFixed(0)}MB に更新中...`)
  const { error: uErr } = await supabase.storage.updateBucket(bucket, {
    public: false,
    fileSizeLimit: BUCKET_FILE_SIZE_LIMIT,
    allowedMimeTypes: ['application/gzip', 'application/octet-stream'],
  })
  if (uErr) {
    console.error('⚠️  バケット上限の更新に失敗（続行）:', uErr.message)
  }
}

// ---------------------------------------------------------------------------
// TUS (resumable) アップロード
//   - Supabase はチャンクサイズ 6MB 固定（最終チャンクのみ端数可）
//   - 各リクエストは agent:false で新規接続（Keep-Alive を使わない）
// ---------------------------------------------------------------------------
const CHUNK = 6 * 1024 * 1024
const MAX_ATTEMPTS = 60          // チャンク送信の総試行回数上限
const REQUEST_TIMEOUT_MS = 120_000
const authHeaders = { apikey: key, Authorization: `Bearer ${key}`, 'Tus-Resumable': '1.0.0' }
const b64 = (s) => Buffer.from(s).toString('base64')

function request(method, target, headers, body) {
  return new Promise((resolvePromise, reject) => {
    const req = https.request(target, { method, headers, agent: false, timeout: REQUEST_TIMEOUT_MS }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolvePromise({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.on('timeout', () => req.destroy(new Error('request timeout')))
    req.on('error', reject)
    if (body) req.end(body)
    else req.end()
  })
}

async function createSession(length) {
  const create = await request('POST', `${url}/storage/v1/upload/resumable`, {
    ...authHeaders,
    'Upload-Length': String(length),
    'x-upsert': 'true',
    'Upload-Metadata': `bucketName ${b64(bucket)},objectName ${b64(object)},contentType ${b64('application/gzip')}`,
  })
  if (create.status !== 201 || !create.headers.location) {
    throw new Error(`TUS セッション作成失敗: HTTP ${create.status} ${create.body.slice(0, 200)}`)
  }
  return create.headers.location
}

async function tusUpload(gzBuf) {
  let location = await createSession(gzBuf.length)
  let offset = 0
  let attempts = 0
  let failures = 0
  while (offset < gzBuf.length) {
    if (attempts >= MAX_ATTEMPTS) throw new Error(`チャンク送信の試行回数が上限 (${MAX_ATTEMPTS}) に達しました (offset=${offset})`)
    attempts++
    const end = Math.min(offset + CHUNK, gzBuf.length)
    try {
      const r = await request('PATCH', location, {
        ...authHeaders,
        'Upload-Offset': String(offset),
        'Content-Type': 'application/offset+octet-stream',
        'Content-Length': String(end - offset),
      }, gzBuf.subarray(offset, end))
      if (r.status === 204) {
        offset = Number(r.headers['upload-offset'])
        process.stdout.write(`   ${(offset / 1024 / 1024).toFixed(1)} / ${gzMb} MB\r`)
        continue
      }
      throw new Error(`HTTP ${r.status} ${r.body.slice(0, 200)}`)
    } catch (e) {
      failures++
      // 受信済みオフセットを取り直して再送。409 はセッションが壊れているので作り直す
      let resumed = offset
      if (/HTTP 409/.test(e.message)) {
        try { location = await createSession(gzBuf.length); resumed = 0 } catch { /* 次回試行で再度作成 */ }
      } else {
        try {
          const h = await request('HEAD', location, authHeaders)
          if (h.status === 200 && h.headers['upload-offset'] != null) resumed = Number(h.headers['upload-offset'])
        } catch { /* HEAD 失敗時は同じ offset から再送 */ }
      }
      console.log(`\n   ⚠️  チャンク送信失敗 (${String(e.message).split('\n')[0].slice(0, 80)}) → offset ${resumed} から再送 [試行 ${attempts}/${MAX_ATTEMPTS}]`)
      offset = resumed
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  console.log('')
  return { attempts, failures }
}

// 6MB 以下なら単発 PUT（新規接続）を再試行、超えるなら TUS チャンク方式
async function putUploadWithRetry(gzBuf) {
  let attempts = 0
  let failures = 0
  for (;;) {
    if (attempts >= MAX_ATTEMPTS) throw new Error(`PUT の試行回数が上限 (${MAX_ATTEMPTS}) に達しました`)
    attempts++
    try {
      const r = await request('PUT', `${url}/storage/v1/object/${bucket}/${object}`, {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'x-upsert': 'true',
        'Content-Type': 'application/gzip',
        'Content-Length': String(gzBuf.length),
      }, gzBuf)
      if (r.status === 200 || r.status === 201) return { attempts, failures }
      throw new Error(`HTTP ${r.status} ${r.body.slice(0, 200)}`)
    } catch (e) {
      failures++
      console.log(`   ⚠️  送信失敗 (${String(e.message).split('\n')[0].slice(0, 80)}) → 再送 [試行 ${attempts}/${MAX_ATTEMPTS}]`)
      await new Promise((r) => setTimeout(r, 500))
    }
  }
}

const gzBuf = readFileSync(gzPath)
const useTus = gzBuf.length > CHUNK
console.log(useTus
  ? '⬆️  アップロード中 (TUS 6MB チャンク / 接続毎に再接続)...'
  : '⬆️  アップロード中 (単発 PUT / 失敗時は再接続して再送)...')
const uploadStart = Date.now()
let stats
try {
  stats = useTus ? await tusUpload(gzBuf) : await putUploadWithRetry(gzBuf)
} catch (e) {
  console.error('❌ アップロード失敗:', e.message)
  process.exit(1)
}
const uploadSec = ((Date.now() - uploadStart) / 1000).toFixed(1)
console.log(`✅ アップロード完了 (${uploadSec}s, 送信試行 ${stats.attempts} 回 / 失敗 ${stats.failures} 回)`)

// ---------------------------------------------------------------------------
// 整合性確認: Storage から再取得して SHA-256 を照合
// ---------------------------------------------------------------------------
console.log('🔍 整合性確認 (再ダウンロードして SHA-256 照合)...')
const localSha = createHash('sha256').update(gzBuf).digest('hex')
const remoteSha = await new Promise((resolvePromise, reject) => {
  const req = https.request(`${url}/storage/v1/object/authenticated/${bucket}/${object}`, { method: 'GET', headers: { apikey: key, Authorization: `Bearer ${key}` }, agent: false }, (res) => {
    const h = createHash('sha256')
    let n = 0
    res.on('data', (c) => { h.update(c); n += c.length })
    res.on('end', () => resolvePromise({ sha: h.digest('hex'), bytes: n }))
    res.on('error', reject)
  })
  req.on('error', reject)
  req.end()
})
if (remoteSha.sha !== localSha || remoteSha.bytes !== gzBuf.length) {
  console.error(`❌ 整合性 NG: local=${localSha.slice(0, 12)}… (${gzBuf.length} B) / remote=${remoteSha.sha.slice(0, 12)}… (${remoteSha.bytes} B)`)
  process.exit(1)
}
console.log(`   OK: sha256 ${localSha.slice(0, 12)}… / ${(remoteSha.bytes / 1024 / 1024).toFixed(1)} MB 一致`)
console.log('   path:', `${bucket}/${object}`)
