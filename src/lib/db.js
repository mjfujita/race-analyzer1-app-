import initSqlJs from 'sql.js/dist/sql-wasm.js'
import sqlWasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { supabase, RACE_DB_BUCKET, RACE_DB_OBJECT } from '../supabase'

const CACHE_KEY = 'race-db-cache-v1'
const CACHE_META_KEY = 'race-db-cache-meta-v1'

let dbPromise = null

// 直近に読み込んだ race.db のメタ（バージョン表示用）
export const dbMeta = { fetchedAt: null, fromCache: false, bytes: 0 }

async function loadFromCache() {
  try {
    const cache = await caches.open(CACHE_KEY)
    const res = await cache.match(CACHE_META_KEY)
    if (!res) return null
    const meta = await res.json()
    const dataRes = await cache.match('race-db-data')
    if (!dataRes) return null
    const buf = await dataRes.arrayBuffer()
    return { buf: new Uint8Array(buf), etag: meta.etag, fetchedAt: meta.fetchedAt }
  } catch {
    return null
  }
}

async function saveToCache(buf, etag) {
  try {
    const cache = await caches.open(CACHE_KEY)
    await cache.put('race-db-data', new Response(buf))
    await cache.put(
      CACHE_META_KEY,
      new Response(JSON.stringify({ etag, fetchedAt: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    )
  } catch {
    // cache unavailable; ignore
  }
}

async function fetchRaceDb(onProgress) {
  const { data: signed, error } = await supabase.storage
    .from(RACE_DB_BUCKET)
    .createSignedUrl(RACE_DB_OBJECT, 60)
  if (error || !signed?.signedUrl) {
    throw new Error('race.db の署名URL取得に失敗: ' + (error?.message || 'unknown'))
  }
  const res = await fetch(signed.signedUrl)
  if (!res.ok) throw new Error('race.db ダウンロード失敗: HTTP ' + res.status)

  const totalCompressed = Number(res.headers.get('Content-Length')) || 0
  const etag = res.headers.get('ETag') || ''
  if (!res.body) throw new Error('レスポンスストリームが取得できません')

  // gzip 圧縮済みの場合は object 名が .gz で終わる前提
  const isGz = RACE_DB_OBJECT.endsWith('.gz')

  // ダウンロード進捗（圧縮済みバイト基準）
  const reader = res.body.getReader()
  const downloadedChunks = []
  let downloaded = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    downloadedChunks.push(value)
    downloaded += value.length
    onProgress?.({ loaded: downloaded, total: totalCompressed, phase: 'download' })
  }
  const compressed = new Uint8Array(downloaded)
  let off = 0
  for (const c of downloadedChunks) {
    compressed.set(c, off)
    off += c.length
  }

  if (!isGz) return { buf: compressed, etag }

  // gzip 解凍
  onProgress?.({ loaded: downloaded, total: totalCompressed, phase: 'decompress' })
  const ds = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('gzip'))
  const decompressed = new Uint8Array(await new Response(ds).arrayBuffer())
  onProgress?.({ loaded: decompressed.length, total: decompressed.length, phase: 'done' })
  return { buf: decompressed, etag }
}

export async function loadDb({ forceRefresh = false, onProgress } = {}) {
  if (dbPromise && !forceRefresh) return dbPromise
  dbPromise = (async () => {
    const SQL = await initSqlJs({ locateFile: () => sqlWasmUrl })
    if (!forceRefresh) {
      const cached = await loadFromCache()
      if (cached) {
        onProgress?.({ loaded: cached.buf.length, total: cached.buf.length, fromCache: true })
        dbMeta.fetchedAt = cached.fetchedAt || null
        dbMeta.fromCache = true
        dbMeta.bytes = cached.buf.length
        return new SQL.Database(cached.buf)
      }
    }
    const { buf, etag } = await fetchRaceDb(onProgress)
    await saveToCache(buf, etag)
    dbMeta.fetchedAt = new Date().toISOString()
    dbMeta.fromCache = false
    dbMeta.bytes = buf.length
    return new SQL.Database(buf)
  })()
  return dbPromise
}

export function queryAll(db, sql, params = []) {
  const stmt = db.prepare(sql)
  try {
    stmt.bind(params)
    const rows = []
    while (stmt.step()) rows.push(stmt.getAsObject())
    return rows
  } finally {
    stmt.free()
  }
}
