import { createClient } from '@supabase/supabase-js'
import { createCompanionHandler, createCompanionService } from '../server/companion.js'
import { createSupabaseObjectStore } from '../server/supabaseStore.js'
import { validatePredictionModels } from '../src/predictionModel.js'
import { validateModel } from '../src/modelStore.js'

let cached
export default async function handler(req, res) {
  const url = process.env.SUPABASE_PROJECT_URL
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY
  const ownerId = process.env.RACE_OWNER_ID
  const token = process.env.COMPANION_TOKEN
  if (!url || !secret || !ownerId || !token || token.length < 32) {
    res.setHeader('Cache-Control', 'private, no-store')
    return res.status(503).json({ error: { code: 'not_configured', message: '自動同期の接続設定が必要です。' } })
  }
  if (!cached) {
    const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false } })
    const store = createSupabaseObjectStore(client)
    const service = createCompanionService({ store, ownerId, runtimeValidator: model => {
      validatePredictionModels(model)
      if (model.baseModel != null) validateModel(model.baseModel)
    } })
    cached = createCompanionHandler({ service, ownerId, companionToken: token,
      authenticateUser: async accessToken => {
        const { data, error } = await client.auth.getUser(accessToken)
        return error ? null : data?.user ?? null
      } })
  }
  return cached(req, res)
}
