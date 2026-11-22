import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { ApiError } from './companion.js'

export const DEVICE_COOKIE = '__Host-race_device'
export const DEVICE_DAYS = 180
const TOKEN = /^[A-Za-z0-9_-]{43}$/
const UUID = /^[a-f0-9-]{36}$/
const hash = v => createHash('sha256').update(v).digest('hex')
const deny = (status,code,message) => { throw new ApiError(status,code,message) }
const cookie = (value,seconds) => `${DEVICE_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${seconds}`
function tokenFrom(req) {
  const raw = req.headers?.cookie
  if (typeof raw !== 'string' || raw.length > 20000) return null
  const entries = raw.split(';').map(v => v.trim()).filter(v => v.startsWith(`${DEVICE_COOKIE}=`))
  if (entries.length !== 1) return null
  const value = entries[0].slice(DEVICE_COOKIE.length+1)
  return TOKEN.test(value) ? value : null
}
export function checkDeviceOrigin(req) {
  // A same-origin custom header prevents simple cross-site forms; Origin also gates credentialed requests.
  if (req.headers?.['x-race-device'] !== '1') deny(403,'origin_required','この画面から操作してください。')
  try {
    const origin = new URL(req.headers.origin)
    if (!['https:','http:'].includes(origin.protocol) || origin.host !== req.headers.host || origin.origin !== req.headers.origin) throw Error()
    if (origin.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(origin.hostname)) throw Error()
  } catch { deny(403,'invalid_origin','別のサイトからの操作は受け付けません。') }
}
const publicDevice = (d,currentId,revoked) => ({ id:d.id,label:d.label,createdAt:d.createdAt,expiresAt:d.expiresAt,current:d.id===currentId,revoked })

export function createDeviceAuth({ store, ownerId, authenticateAccount, now = () => Date.now() }) {
  const base = `${ownerId}/v1/devices`
  const revoked = id => store.get(`${base}/revoked/${id}.json`)
  const label = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 80 ? value.trim() : '承認済み端末'
  async function authenticateDevice(req) {
    const token = tokenFrom(req)
    if (!token) return null
    const d = await store.get(`${base}/tokens/${hash(token)}.json`)
    if (!d || d.ownerId !== ownerId || d.tokenHash !== hash(token) || !UUID.test(d.id) || !Number.isFinite(Date.parse(d.expiresAt))
      || Date.parse(d.expiresAt) <= now() || await revoked(d.id)) return null
    return { user:{ id:ownerId,email:'本人の端末' },device:publicDevice(d,d.id,false),via:'device' }
  }
  async function authenticate(req) {
    const device = await authenticateDevice(req)
    if (device) return device
    const authorization = req.headers?.authorization
    const token = typeof authorization === 'string' && /^Bearer [^\s]+$/i.test(authorization) ? authorization.slice(7) : null
    if (!token) return null
    const user = await authenticateAccount(token)
    if (!user) return null
    if (user.id !== ownerId) deny(403,'forbidden','このデータへのアクセス権がありません。')
    return { user,device:null,via:'account' }
  }
  async function issue(deviceLabel) {
    const token = randomBytes(32).toString('base64url'), id = randomUUID()
    const d = { schemaVersion:1,id,ownerId,label:label(deviceLabel),createdAt:new Date(now()).toISOString(),
      expiresAt:new Date(now()+DEVICE_DAYS*86400000).toISOString(),tokenHash:hash(token) }
    const index = await store.putImmutable(`${base}/registry/${id}.json`,d)
    const secret = await store.putImmutable(`${base}/tokens/${d.tokenHash}.json`,d)
    if (!index.created || !secret.created) deny(409,'device_conflict','端末を登録できませんでした。もう一度お試しください。')
    return { token,device:publicDevice(d,id,false) }
  }
  async function list(currentId) {
    const rows = await store.list(`${base}/registry`,{ limit:64,order:'desc',complete:true })
    if (rows.length > 64) deny(409,'device_limit','登録端末が上限に達しています。復旧操作が必要です。')
    const records = await Promise.all(rows.map(r => store.get(r.path)))
    return Promise.all(records.filter(d => d?.ownerId === ownerId && UUID.test(d.id)).map(async d => publicDevice(d,currentId,Boolean(await revoked(d.id)))))
  }
  async function register(auth,deviceLabel) {
    if (auth?.via !== 'account') deny(403,'account_required','最初の端末は本人確認済みの画面から登録してください。')
    await checkCapacity()
    return issue(deviceLabel)
  }
  async function checkCapacity() {
    const records=await list()
    if (records.length>=64) deny(409,'device_limit','端末の登録履歴が上限に達しています。復旧操作が必要です。')
    if (records.filter(d => !d.revoked && Date.parse(d.expiresAt)>now()).length>=8) deny(409,'device_limit','不要な端末を解除してから登録してください。')
  }
  async function pair(auth,deviceLabel) {
    if (!auth?.device) deny(403,'trusted_device_required','先にこのPCを承認済み端末に登録してください。')
    await checkCapacity()
    const code = randomBytes(32).toString('base64url')
    const p = { schemaVersion:1,ownerId,issuerId:auth.device.id,label:label(deviceLabel),createdAt:new Date(now()).toISOString(),expiresAt:new Date(now()+10*60000).toISOString() }
    const saved = await store.putImmutable(`${base}/pairings/${hash(code)}.json`,p)
    if (!saved.created) deny(409,'pairing_conflict','QRコードを作り直してください。')
    return { code,expiresAt:p.expiresAt }
  }
  async function claim(code,deviceLabel) {
    if (!TOKEN.test(code ?? '')) deny(400,'invalid_pairing','登録用QRコードを読み取ってください。')
    const h = hash(code), p = await store.get(`${base}/pairings/${h}.json`)
    if (!p || p.ownerId !== ownerId || !Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.expiresAt)<=now() || !UUID.test(p.issuerId) || await revoked(p.issuerId)) deny(410,'pairing_expired','QRコードの有効期限が切れたか、発行端末が解除されています。PCで作り直してください。')
    const issuer = await store.get(`${base}/registry/${p.issuerId}.json`)
    if (!issuer || issuer.ownerId!==ownerId || !Number.isFinite(Date.parse(issuer.expiresAt)) || Date.parse(issuer.expiresAt)<=now()) deny(410,'pairing_expired','発行したPCの承認期限が切れています。')
    await checkCapacity()
    const used = await store.putImmutable(`${base}/claims/${h}.json`,{ ownerId,claimedAt:new Date(now()).toISOString() })
    if (!used.created) deny(409,'pairing_used','このQRコードは使用済みです。PCで新しく発行してください。')
    return issue(deviceLabel || p.label)
  }
  async function revoke(auth,id) {
    if (!auth || !UUID.test(id ?? '')) deny(400,'invalid_device','解除する端末を選択してください。')
    const d = await store.get(`${base}/registry/${id}.json`)
    if (!d || d.ownerId!==ownerId) deny(404,'device_not_found','登録端末が見つかりません。')
    await store.putImmutable(`${base}/revoked/${id}.json`,{ ownerId,deviceId:id,revokedAt:new Date(now()).toISOString(),revokedBy:auth.device?.id ?? 'owner-account' })
    return { ok:true,current:auth.device?.id===id }
  }
  return { authenticateDevice,authenticate,register,pair,claim,revoke,list }
}

export function createDeviceHandler({ auth, createDbUrl }) {
  return async (req,res) => {
    res.setHeader('Cache-Control','private, no-store, max-age=0')
    res.setHeader('Vary','Cookie, Authorization, Origin')
    res.setHeader('X-Content-Type-Options','nosniff')
    res.setHeader('Referrer-Policy','no-referrer')
    try {
      if (!['GET','POST'].includes(req.method)) deny(405,'method_not_allowed','この操作は利用できません。')
      if (req.method === 'POST') checkDeviceOrigin(req)
      const user = await auth.authenticate(req)
      const query = req.query ?? Object.fromEntries(new URL(req.url,'https://local.invalid').searchParams)
      if (req.method === 'GET') {
        if (query.resource === 'race-db' && Object.keys(query).length===1) {
          if (!user) deny(401,'unauthorized','端末の承認が必要です。')
          return res.status(200).json({ signedUrl:await createDbUrl() })
        }
        if (Object.keys(query).length) deny(400,'invalid_input','取得条件が不正です。')
        return res.status(200).json({ session:user ? { user:user.user,device:user.device } : null })
      }
      if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) deny(415,'unsupported_type','JSONで送信してください。')
      if (Number(req.headers?.['content-length'] ?? 0)>4096) deny(413,'too_large','入力が長すぎます。')
      let body = req.body
      if (Buffer.byteLength(typeof body==='string' ? body : JSON.stringify(body) ?? '')>4096) deny(413,'too_large','入力が長すぎます。')
      if (typeof body === 'string') {
        if (Buffer.byteLength(body)>4096) deny(413,'too_large','入力が長すぎます。')
        try { body=JSON.parse(body) } catch { deny(400,'invalid_input','入力形式が不正です。') }
      }
      if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).some(k => !['action','label','code','deviceId'].includes(k))
        || body.label != null && (typeof body.label!=='string' || body.label.length>80)) deny(400,'invalid_input','入力を確認してください。')
      if (body.action === 'claim') {
        const result = await auth.claim(body.code,body.label)
        res.setHeader('Set-Cookie',cookie(result.token,DEVICE_DAYS*86400))
        return res.status(200).json({ device:result.device,registered:true })
      }
      if (!user) deny(401,'unauthorized','承認済み端末から操作してください。')
      if (body.action === 'register') {
        const result = await auth.register(user,body.label)
        res.setHeader('Set-Cookie',cookie(result.token,DEVICE_DAYS*86400))
        return res.status(200).json({ registered:true,device:result.device })
      }
      if (body.action === 'pair') return res.status(200).json(await auth.pair(user,body.label))
      if (body.action === 'list') return res.status(200).json({ devices:await auth.list(user.device?.id),currentId:user.device?.id ?? null })
      if (body.action === 'revoke' || body.action === 'logout') {
        const id = body.action === 'logout' ? user.device?.id : body.deviceId
        if (!id) return res.status(200).json({ ok:true,current:true })
        const result = await auth.revoke(user,id)
        if (result.current) res.setHeader('Set-Cookie',cookie('',0))
        return res.status(200).json(result)
      }
      deny(400,'invalid_input','対応していない操作です。')
    } catch (error) {
      const known = error instanceof ApiError
      return res.status(known ? error.status : 503).json({ error:{ code:known ? error.code : 'device_unavailable',message:known ? error.message : '端末認証を確認できません。時間をおいて再度お試しください。' } })
    }
  }
}
