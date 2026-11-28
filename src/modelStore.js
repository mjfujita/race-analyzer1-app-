import {setBrowserValue} from './browserStorage.js'
import { raceDateISO, validTimestamp } from './raceTime.js'
import { isSupportedAbilityModel } from './marketModel.js'

export function validateModel(model) {
  if (!isSupportedAbilityModel(model)
    || model.status !== 'research' || typeof model.id !== 'string' || !model.id || model.id.length > 200
    || !/^\d{4}-\d{2}-\d{2}$/.test(model.trainedThrough ?? '') || !raceDateISO({ raceDate: model.trainedThrough })
    || !model.validation || typeof model.validation !== 'object' || Array.isArray(model.validation)
    || (model.generatedAt != null && !validTimestamp(model.generatedAt))) {
    throw new Error('対応する研究用モデルJSONではありません。')
  }
  return model
}

export function loadModel(userId, storage = globalThis.localStorage) {
  try {
    const raw = storage.getItem(`race-market-model:v1:${userId}`)
    return raw ? validateModel(JSON.parse(raw)) : null
  } catch { return null }
}

export function saveModel(userId, model, storage = globalThis.localStorage) {
  validateModel(model)
  const adopted = { ...model, adoptedAt: new Date().toISOString() }
  setBrowserValue(storage,`race-market-model:v1:${userId}`,JSON.stringify(adopted),userId)
  return adopted
}
