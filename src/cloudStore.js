import { supabase } from './supabase.js'
import { oddsStorageKey, importOddsSnapshots } from './oddsHistory.js'
import { loadModel, saveModel, validateModel } from './modelStore.js'
import { ledgerScope, readLedger, importLedger, writeLedgerExclusive, parseRaceObservations, mergeRaceObservations } from './forecastLedger.js'
import { validateRuntimeModels } from './predictionModel.js'
import { raceDateISO } from './raceTime.js'

export const runtimeModelKey = userId => `race-runtime-model:v1:${userId}`
const cacheKey = (userId, race) => `race-companion-cache:v1:${userId}:${raceDateISO(race)}:${race.id}`
const observationKey = scope => `race-observations:v1:${encodeURIComponent(scope.userId)}:${scope.raceDate}:${encodeURIComponent(scope.raceId)}`

export function loadRuntimeModel(userId, storage = globalThis.localStorage) {
  try { return JSON.parse(storage.getItem(runtimeModelKey(userId)) ?? 'null') } catch { return null }
}

export function readCloudRace(userId, race, storage = globalThis.localStorage) {
  if (!race?.id) return null
  try { return JSON.parse(storage.getItem(cacheKey(userId, race)) ?? 'null') } catch { return null }
}

async function request(path, { body, signal } = {}) {
  const { data, error } = await supabase.auth.getSession()
  if (error || !data.session?.access_token) throw new Error('同期にはログインが必要です。')
  const response = await fetch(path, { method: body ? 'POST' : 'GET', signal, cache: 'no-store',
    headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
  let payload
  try { payload = await response.json() } catch { throw new Error('同期サーバーから有効な応答を取得できませんでした。') }
  if (!response.ok) throw Object.assign(new Error(payload.error?.message ?? payload.error ?? `同期できませんでした（${response.status}）。`), { status: response.status, code: payload.error?.code })
  return payload
}

export function fetchCloudRace(race, signal) {
  const query = race?.id ? `?raceId=${encodeURIComponent(race.id)}&raceDate=${raceDateISO(race)?.replaceAll('-', '')}` : ''
  return request(`/api/companion${query}`, { signal })
}

export function requestRaceCapture(race) {
  return request('/api/companion', { body: { action: 'request-capture', raceId: String(race.id), raceDate: raceDateISO(race)?.replaceAll('-', '') } })
}

export async function syncLedgerToCloud(ledger) {
  return request('/api/companion', { body: { action: 'ledger', ledger } })
}

export async function applyCloudData(userId, race, horses, payload, storage = globalThis.localStorage, locks = globalThis.navigator?.locks) {
  const model = payload.models?.runtimeModel?.baseModel ?? payload.models?.abilityModel
  if (model) {
    validateModel(model)
    const previous = loadModel(userId, storage)
    if (previous?.id !== model.id) saveModel(userId, model, storage)
  }
  const runtime = payload.models?.runtimeModel
  if (runtime) {
    validateRuntimeModels(runtime)
    const previous = loadRuntimeModel(userId, storage)
    if (previous?.id !== runtime.id) storage.setItem(runtimeModelKey(userId), JSON.stringify({ ...runtime, adoptedAt: new Date().toISOString() }))
  }
  if (!race?.id) return payload
  const scope = ledgerScope(userId, race)
  const incomingRace = payload.race
  if (incomingRace && (String(incomingRace.id ?? incomingRace.raceId) !== String(race.id)
    || raceDateISO(incomingRace) !== raceDateISO(race))) throw new Error('同期データのレースが一致しません。')
  const numbers = (horses?.length ? horses : incomingRace?.horses ?? []).map(h => Number(h.no))
  if (payload.snapshots?.length && numbers.length) {
    const apply = () => importOddsSnapshots(oddsStorageKey(userId, race), payload.snapshots, race, numbers, storage)
    if (locks?.request) await locks.request(`race-odds-sync:${oddsStorageKey(userId, race)}`, apply)
    else apply()
  }
  const observationEvents = payload.observations?.observations ?? payload.observations ?? []
  if (!Array.isArray(observationEvents) || observationEvents.some(event => String(event.payload?.raceId) !== String(race.id)
    || String(event.payload?.raceDate ?? '').replaceAll('-', '') !== scope.raceDate)) throw new Error('観測データのレースを確認できません。')
  const ordinary = observationEvents.filter(event => ['TYB', 'HJC'].includes(event.kind))
  if (ordinary.length) {
    const parsed = parseRaceObservations(JSON.stringify({ schemaVersion: 1, kind: 'race-market-observations', observations: ordinary }), scope)
    const key = observationKey(scope)
    const save = () => {
      const raw = storage.getItem(key)
      const before = raw ? parseRaceObservations(raw, scope) : null
      storage.setItem(key, JSON.stringify(mergeRaceObservations(before, parsed, scope)))
    }
    if (locks?.request) await locks.request(`race-observations:${key}`, save)
    else save()
  }
  if (payload.ledger) {
    const local = readLedger(storage, scope)
    if (local.error) throw new Error(local.error)
    const merged = importLedger(local.ledger, JSON.stringify(payload.ledger))
    await writeLedgerExclusive(storage, merged, locks)
  }
  const saved = { race: incomingRace ?? race, observations: observationEvents, context: payload.context ?? null,
    results: payload.results ?? null, status: payload.status ?? null, fetchedAt: new Date().toISOString() }
  storage.setItem(cacheKey(userId, race), JSON.stringify(saved))
  return { ...payload, cached: saved }
}

export function enrichCloudHorses(horses, cloudRace) {
  const observed = cloudRace?.horses ?? []
  if (!observed.length) return horses
  const byNo = new Map(observed.map(horse => [Number(horse.no), horse]))
  return horses.map(horse => {
    const next = byNo.get(Number(horse.no))
    if (!next) return horse
    return { ...horse, ...(Number.isInteger(next.frameNo) ? { frameNo: next.frameNo } : {}),
      ...(Array.isArray(next.pastRuns) && next.pastRuns.length ? { pastRuns: next.pastRuns } : {}),
      ...(next.cancelled != null ? { cancelled: next.cancelled } : {}) }
  })
}
