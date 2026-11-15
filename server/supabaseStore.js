import { ApiError } from './companion.js'

export function createSupabaseObjectStore(client, bucket = 'race-research') {
  const storage = client.storage.from(bucket)
  function ensurePath(path) {
    if (typeof path !== 'string' || !/^[A-Za-z0-9_/-]+(?:\.json)?$/.test(path) || path.includes('..') || path.startsWith('/')) throw new ApiError(400, 'invalid_path', '保存先が不正です。')
  }
  async function get(path) {
    ensurePath(path)
    const { data, error } = await storage.download(path)
    if (error) {
      if ([404, 400].includes(Number(error.status ?? error.statusCode)) && /not found|does not exist/i.test(error.message ?? '')) return null
      throw new ApiError(503, 'storage_unavailable', '保存データを取得できませんでした。')
    }
    try { return JSON.parse(await data.text()) } catch { throw new ApiError(409, 'record_conflict', '保存データの形式を確認できません。') }
  }
  async function putImmutable(path, value) {
    ensurePath(path)
    const { error } = await storage.upload(path, JSON.stringify(value), { contentType: 'application/json', upsert: false, cacheControl: '0' })
    if (!error) return { created: true }
    if (Number(error.status ?? error.statusCode) === 409 || /already exists|duplicate/i.test(error.message ?? '')) {
      const existing = await get(path)
      if (existing === null) throw new ApiError(503, 'storage_unavailable', '保存状態を確認できませんでした。')
      return { created: false, existing }
    }
    throw new ApiError(503, 'storage_unavailable', '保存を完了できませんでした。再送できます。')
  }
  async function list(prefix, { limit = 2000, order = 'asc', complete = false } = {}) {
    ensurePath(prefix)
    const total = limit + (complete ? 1 : 0)
    const rows = [], pageSize = Math.min(total, 1000)
    for (let offset = 0; offset < total; offset += pageSize) {
      const { data, error } = await storage.list(prefix, { limit: Math.min(pageSize, total - offset), offset, sortBy: { column: 'name', order } })
      if (error) throw new ApiError(503, 'storage_unavailable', '保存記録の一覧を取得できませんでした。')
      rows.push(...data.map(item => ({ name: item.name, path: `${prefix}/${item.name}`, folder: item.id === null })))
      if (data.length < pageSize) break
    }
    return rows
  }
  return { get, putImmutable, list }
}
