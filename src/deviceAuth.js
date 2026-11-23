import { supabase } from './supabase.js'

export async function ownerHeaders() {
  try {
    const { data }=await supabase.auth.getSession()
    return data.session?.access_token ? { Authorization:`Bearer ${data.session.access_token}` } : {}
  } catch { return {} }
}
export async function deviceRequest(action,values = {},{signal} = {}) {
  const response=await fetch('/api/device',{ method:action ? 'POST' : 'GET',credentials:'same-origin',cache:'no-store',
    signal,
    headers:{ ...await ownerHeaders(),...(action ? { 'Content-Type':'application/json','X-Race-Device':'1' } : {}) },
    ...(action ? { body:JSON.stringify({ action,...values }) } : {}) })
  let data
  try { data=await response.json() } catch { throw new Error('端末認証の応答を確認できません。') }
  if (!response.ok) throw Object.assign(new Error(data.error?.message ?? '端末認証を確認できません。'),{ status:response.status,code:data.error?.code })
  if (!action && (!Object.hasOwn(data ?? {},'session') || data.session!==null && !data.session?.user?.id)) throw new Error('端末認証の応答を確認できません。')
  return data
}
export async function raceDbDownloadUrl() {
  const response=await fetch('/api/device?resource=race-db',{ credentials:'same-origin',cache:'no-store',headers:await ownerHeaders() })
  const data=await response.json()
  if (!response.ok || typeof data.signedUrl !== 'string') throw new Error(data.error?.message ?? 'PACIデータを取得できません。')
  return data.signedUrl
}
export async function refreshDeviceSession() {
  const data=await deviceRequest()
  if (data.session?.device) {
    // Leave account recovery to Supabase, but ordinary device use no longer needs a browser JWT.
    await supabase.auth.signOut({ scope:'local' }).catch(() => {})
  }
  globalThis.dispatchEvent(new Event('race-device-session-changed'))
  return data.session
}
