import { createClient } from '@supabase/supabase-js'
import { createCompanionHandler, createCompanionService, ApiError } from './companion.js'
import { createSupabaseObjectStore } from './supabaseStore.js'
import { createDeviceAuth, createDeviceHandler, checkDeviceOrigin } from './deviceAuth.js'
import { jraSchedule } from './jraCalendar.js'
import { validatePredictionModels } from '../src/predictionModel.js'
import { validateModel } from '../src/modelStore.js'

let cached
export function appRuntime() {
  if (cached) return cached
  const url=process.env.SUPABASE_PROJECT_URL,secret=process.env.SUPABASE_SERVICE_ROLE_KEY
  const ownerId=process.env.RACE_OWNER_ID,token=process.env.COMPANION_TOKEN
  if (!url || !secret || !ownerId || !token || token.length<32) throw new ApiError(503,'not_configured','自動同期の接続設定が必要です。')
  const client=createClient(url,secret,{ auth:{ persistSession:false,autoRefreshToken:false } })
  const store=createSupabaseObjectStore(client)
  const authenticateUser=async accessToken => {
    const { data,error }=await client.auth.getUser(accessToken)
    return error ? null : data?.user ?? null
  }
  const devices=createDeviceAuth({ store,ownerId,authenticateAccount:authenticateUser })
  const service=createCompanionService({ store,ownerId,schedule:jraSchedule,runtimeValidator:model => {
    validatePredictionModels(model)
    if (model.baseModel != null) validateModel(model.baseModel)
  } })
  cached={
    companion:createCompanionHandler({ service,ownerId,companionToken:token,authenticateUser,
      authenticateDevice:async req => (await devices.authenticateDevice(req))?.user ?? null,checkDeviceWrite:checkDeviceOrigin }),
    device:createDeviceHandler({ auth:devices,createDbUrl:async () => {
      const { data,error }=await client.storage.from('race-db').createSignedUrl('race.db.gz',60)
      if (error || !data?.signedUrl) throw new ApiError(503,'database_unavailable','PACIデータベースを取得できませんでした。')
      return data.signedUrl
    } }),
  }
  return cached
}

export function runtimeFailure(res) {
  res.setHeader('Cache-Control','private, no-store')
  return res.status(503).json({ error:{ code:'not_configured',message:'接続設定を確認できません。時間をおいてお試しください。' } })
}
