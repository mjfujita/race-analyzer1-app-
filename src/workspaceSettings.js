import {setBrowserValue} from './browserStorage.js'
export const DEFAULT_SETTINGS = Object.freeze({ minTop3: 50, stress: 10 })
const key = userId => `race-workspace-settings:v1:${encodeURIComponent(userId)}`
export function validateSettings(value) {
  if (!value || !Number.isFinite(value.minTop3) || value.minTop3 < 0 || value.minTop3 > 100
    || !Number.isFinite(value.stress) || value.stress < 0 || value.stress > 80) throw new Error('3着内率は0〜100%、下落想定は0〜80%で入力してください。')
  return { minTop3: value.minTop3, stress: value.stress }
}
export function readSettings(userId, storage = globalThis.localStorage) {
  try { const raw = storage.getItem(key(userId)); return { value: raw ? validateSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }, error: null } }
  catch { return { value: { ...DEFAULT_SETTINGS }, error: '表示条件を読み込めません。既定値を表示しています。保存領域を確認してください。' } }
}
export function saveSettings(userId, value, storage = globalThis.localStorage) {
  if (!userId) throw new Error('ログイン状態を確認してください。')
  const checked = validateSettings(value)
  setBrowserValue(storage,key(userId),JSON.stringify(checked),userId)
  return checked
}
