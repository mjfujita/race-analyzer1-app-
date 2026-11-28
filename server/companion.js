import { createHash, timingSafeEqual } from 'node:crypto'
import { SINGLE_ANCHOR_METHOD } from '../src/anchorAssessment.js'
import { validateForecastReview } from '../src/forecastReview.js'
import { validateModel } from '../src/modelStore.js'
import { validateLedger, emptyLedger, importLedger, parseRaceObservations, LEDGER_COLLECTIONS } from '../src/forecastLedger.js'
import { importOddsSnapshots } from '../src/oddsHistory.js'
import { decisionCutoff, japanRaceDay, raceDateISO, raceTimestamp, snapshotTiming, validTimestamp } from '../src/raceTime.js'
import {summarizeRaceResult} from '../src/raceProgress.js'
import {validatePrediction,validateJournalResult,mergeJournal,latestResult,legacyPrediction,officialJournalResult} from '../src/predictionJournal.js'

import {validateGroupRegistration,mergeGroupRegistrations,latestGroupRegistration} from '../src/groupRegistration.js'

export const MAX_BODY_BYTES = 3_000_000
const MAX_RACE_FILES = 2000
const COMMAND_TTL = 5 * 60_000
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code }
}
const invalid = message => { throw new ApiError(400, 'invalid_input', message) }
const conflict = message => { throw new ApiError(409, 'record_conflict', message) }
async function forEachBounded(items, limit, apply) {
  let next = 0, failure
  // Stop scheduling after failure, but drain every already-started operation before returning.
  await Promise.allSettled(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const item = items[next++]
      try { await apply(item) } catch (error) { failure ??= error }
    }
  }))
  if (failure) throw failure
}
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export const contentHash = value => createHash('sha256').update(canonical(value)).digest('hex')
const keyHash = value => createHash('sha256').update(String(value)).digest('hex')
function inspect(value, depth = 0) {
  if (depth > 20) invalid('JSONの階層が深すぎます。')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') {
    if (value.length > 200_000 || /[?&](?:PHPSESSID|access_token|refresh_token|password|api_key)=/i.test(value)) invalid('機密情報を含むURLや長すぎる文字列は保存できません。')
    return
  }
  if (typeof value === 'number') { if (!Number.isFinite(value)) invalid('数値が不正です。'); return }
  if (Array.isArray(value)) { if (value.length > 20_000) invalid('項目が多すぎます。'); value.forEach(item => inspect(item, depth + 1)); return }
  if (!plain(value)) invalid('JSON形式を確認してください。')
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || /^(?:password|passwd|secret|authorization|cookie|cookies|access_token|refresh_token|service_role_key|companion_token)$/i.test(key)) invalid('機密情報・未対応項目は保存できません。')
    inspect(child, depth + 1)
  }
}
function boundedJson(value) {
  inspect(value)
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', '送信データは3MB以内にしてください。')
}
export function validateRaceKey(raceId, raceDate) {
  if (typeof raceId !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(raceId)
    || typeof raceDate !== 'string' || !/^\d{8}$/.test(raceDate) || !raceDateISO({ raceDate })) invalid('レースID・開催日が不正です。')
  return { raceId, raceDate }
}
function checkTime(value, now, label, optional = false) {
  if (optional && value == null) return
  if (!validTimestamp(value) || Date.parse(value) > now + 120_000) invalid(`${label}が不正です。`)
}
function raceMeta(input) {
  const value = { id: input.raceId, raceDate: input.raceDate }
  for (const key of ['name', 'place', 'placeCode', 'raceNo', 'postTime', 'fieldSize', 'releaseFieldSize', 'surface', 'distance', 'weather', 'going']) {
    if (input.race?.[key] != null) value[key] = input.race[key]
  }
  return value
}
function validateModels(models, runtimeValidator) {
  if (models == null) return { abilityModel: null, runtimeModel: null }
  if (!plain(models) || Object.keys(models).some(key => !['abilityModel', 'runtimeModel'].includes(key))) invalid('学習モデルの形式が不正です。')
  try {
    if (models.abilityModel != null) validateModel(models.abilityModel)
    if (models.runtimeModel != null) {
      if (!runtimeValidator) invalid('この版で対応していない実行モデルです。')
      runtimeValidator(models.runtimeModel)
    }
  } catch (error) { if (error instanceof ApiError) throw error; invalid('学習モデルの検証に失敗しました。') }
  return { abilityModel: models.abilityModel ?? null, runtimeModel: models.runtimeModel ?? null }
}
function uniqueRecords(records, idKey) {
  const byId = new Map()
  for (const record of records) {
    const id = record[idKey]
    if (byId.has(id) && contentHash(byId.get(id)) !== contentHash(record)) conflict('同じIDに異なる記録があります。元の記録を保持しました。')
    byId.set(id, record)
  }
  return [...byId.values()]
}
function validateRaceInput(race, ownerId, now) {
  if (!plain(race)) invalid('レースの形式が不正です。')
  validateRaceKey(race.raceId, race.raceDate)
  if (!plain(race.race) || !Array.isArray(race.snapshots) || !Array.isArray(race.observations)
    || race.snapshots.length > 2000 || race.observations.length > 5000) invalid('レースの観測形式が不正です。')
  if ((race.race.id != null && String(race.race.id) !== race.raceId)
    || (race.race.raceDate != null && String(race.race.raceDate).replaceAll('-', '') !== race.raceDate)) invalid('レース情報が一致しません。')
  if (race.snapshots.length) {
    const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
    try { importOddsSnapshots('validate', race.snapshots, { id: race.raceId, raceDate: race.raceDate }, Array.from({ length: 18 }, (_, i) => i + 1), storage) }
    catch { invalid('オッズ記録のレース・日時・倍率が不正です。') }
  }
  const ids = new Set()
  for (const event of race.observations) {
    if (!plain(event) || typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 200 || ids.has(event.eventId)
      || !['TYB', 'HJC', 'LIVE', 'LIVE_RACE', 'RESULT'].includes(event.kind) || !plain(event.payload)
      || String(event.payload.raceId) !== race.raceId || String(event.payload.raceDate).replaceAll('-', '') !== race.raceDate) invalid('観測記録のレース・識別子が不正です。')
    ids.add(event.eventId)
    checkTime(event.retrievedAt, now, '観測取得時刻')
    if (['TYB', 'HJC'].includes(event.kind)) {
      try { parseRaceObservations(JSON.stringify({ schemaVersion: 1, kind: 'race-market-observations', observations: [event] }), { userId: ownerId, raceId: race.raceId, raceDate: race.raceDate }) }
      catch { invalid('TYB・HJC記録の形式が不正です。') }
    }
  }
  return race
}
export function validateBundle(input, { ownerId, runtimeValidator, now = Date.now() }) {
  boundedJson(input)
  if (input?.schemaVersion !== 1 || input.kind !== 'race-companion-bundle' || !plain(input.status)
    || !Array.isArray(input.races) || input.races.length > 72) invalid('取得データの形式が不正です。')
  checkTime(input.generatedAt, now, '生成時刻')
  if (typeof input.status.state !== 'string' || !/^[a-z_-]{1,40}$/.test(input.status.state)) invalid('取得状態が不正です。')
  for (const key of ['lastRunAt', 'lastSuccessAt']) checkTime(input.status[key], now, '処理時刻', true)
  const models = validateModels(input.models, runtimeValidator)
  if (input.forecastReview != null) {
    try { validateForecastReview(input.forecastReview, ownerId); checkTime(input.forecastReview.generatedAt, now, '振り返り生成時刻') }
    catch { invalid('振り返りデータの検証に失敗しました。') }
  }
  const keys = new Set()
  for (const race of input.races) {
    validateRaceInput(race, ownerId, now)
    const key = `${race.raceDate}:${race.raceId}`
    if (keys.has(key)) invalid('同じレースが重複しています。')
    keys.add(key)
  }
  return { ...input, models }
}

// Dependencies are injected for deterministic tests. Storage must offer atomic create-only writes.
export function createCompanionService({ store, ownerId, runtimeValidator, now = () => Date.now(), schedule = async () => 'unconfirmed' }) {
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(ownerId ?? '')) throw new ApiError(503, 'not_configured', '同期サービスの設定が必要です。')
  const prefix = `${ownerId}/v1`
  const racePrefix = (id, date) => `${prefix}/races/${date}/${id}`
  async function immutable(path, value) {
    const result = await store.putImmutable(path, value)
    if (!result.created && contentHash(result.existing) !== contentHash(value)) conflict('同じ保存先に異なる記録があります。既存記録を保持しました。')
    return result.created
  }
  async function list(path, options = {}) {
    const rows = await store.list(path, options)
    if (rows.length > (options.limit ?? MAX_RACE_FILES)) throw new ApiError(409, 'archive_limit', '記録が多いため保管範囲の整理が必要です。データは削除していません。')
    return rows
  }
  async function latestMeta() {
    const rows = await list(`${prefix}/meta`, { limit: 1, order: 'desc' })
    if (!rows.length) return null
    const meta = await store.get(rows[0].path)
    if (!meta || meta.schemaVersion !== 1 || meta.ownerId !== ownerId) conflict('保存済みの同期情報を検証できません。')
    validateModels(meta.models, runtimeValidator)
    return meta
  }
  async function latestReview() {
    const [row] = await list(`${prefix}/forecast-review`, { limit: 1, order: 'desc' })
    if (!row) return null
    const stored = await store.get(row.path)
    if (!stored || stored.ownerId !== ownerId || !validTimestamp(stored.receivedAt)) conflict('振り返りの保存範囲を確認できません。')
    return { ...validateForecastReview(stored.review, ownerId), receivedAt: stored.receivedAt }
  }
  async function availableRaces(date) {
    let dates = date ? [date] : (await list(`${prefix}/race-index`, { limit: 8, order: 'desc' })).map(row => row.name).filter(value => /^\d{8}$/.test(value))
    dates = dates.sort().reverse()
    const result = []
    for (const day of dates) {
      const rows = await list(`${prefix}/race-index/${day}`, { limit: 72, order: 'desc' })
      const records = new Map()
      await forEachBounded(rows.filter(row => row.name.endsWith('.json')), 8, async row => {
        const item = await store.get(row.path)
        if (!item) return
        validateRaceKey(item.id, item.raceDate)
        if (item.raceDate !== day || row.name !== `${item.id}.json`) conflict('保存済みの開催情報が一致しません。')
        records.set(row.path, item)
      })
      result.push(...records.values())
      if (result.length >= 36) break
    }
    return result.sort((a, b) => b.raceDate.localeCompare(a.raceDate) || String(a.postTime ?? '').localeCompare(String(b.postTime ?? '')) || a.id.localeCompare(b.id)).slice(0, 36)
  }
  async function dashboardRace(item, reviewRow, timestamp) {
    const { id, raceDate } = item, base = racePrefix(id, raceDate)
    const [observations, forecasts, receipts, groupPlans] = await Promise.all([
      list(`${base}/observations`, { limit: 1, column: 'created_at', order: 'desc' }),
      list(`${base}/ledger/forecasts`, { limit: 1 }),
      list(`${base}/ledger/receipts`, { limit: 1 }),
      list(`${base}/ledger/groupPlans`, { limit:1 }),
    ])
    // Collector updates carry cumulative snapshots for the race. Use one published payload.
    const [stored, receipt] = await Promise.all([
      observations[0] ? store.get(observations[0].path) : null,
      receipts[0] ? store.get(receipts[0].path) : null,
    ])
    if (observations.length && (!stored || stored.ownerId !== ownerId || stored.race?.raceId !== id
      || stored.race?.raceDate !== raceDate)) conflict('開催情報の観測範囲が一致しません。')
    if (receipts.length && (!receipt || receipt.ownerId !== ownerId || receipt.raceId !== id || receipt.raceDate !== raceDate
      || typeof receipt.forecastId !== 'string' || !validTimestamp(receipt.receivedAt) || !validTimestamp(receipt.cutoffAt)
      || Date.parse(receipt.receivedAt) > Math.min(timestamp, Date.parse(receipt.cutoffAt)))) conflict('予想の受領記録を確認できません。')
    const race = stored ? raceMeta(stored.race) : item
    const horses = stored?.race.race.horses ?? []
    const field = horses.filter(horse => !horse.cancelled).map(horse => Number(horse.no))
    const odds = (stored?.race.snapshots ?? []).filter(row => row.kind === 'observed' && field.length >= 2
      && Object.keys(row.odds).length === field.length && field.every(no => Object.hasOwn(row.odds, no))
      && snapshotTiming(row, race).eligible && Date.parse(row.retrievedAt) <= timestamp)
      .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0]
    return { ...race, oddsRetrievedAt: odds?.retrievedAt ?? null, ...(groupPlans.length ? { hasGroupPlan:true } : {}), hasForecast: forecasts.length > 0 || groupPlans.length > 0 || Boolean(receipt),
      receipt: receipt ? { ownerId, raceId: id, raceDate, forecastId: receipt.forecastId, receivedAt: receipt.receivedAt } : null,
      review: reviewRow ? { forecastId: reviewRow.forecastId, state: reviewRow.state } : null }
  }
  async function getDashboard() {
    const timestamp = now(), date = japanRaceDay(timestamp)
    const [meta, review, races, days] = await Promise.all([
      latestMeta(), latestReview(), availableRaces(date), list(`${prefix}/race-index`, { limit: 8, order: 'desc' }),
    ])
    const reviewByRace = new Map((review?.races ?? []).filter(row => row.raceDate === date).map(row => [row.raceId, row]))
    const rows = new Map()
    await forEachBounded(races, 6, async race => { rows.set(race.id, await dashboardRace(race, reviewByRace.get(race.id), timestamp)) })
    const lastMeeting = days.find(row => /^\d{8}$/.test(row.name) && row.name < date)?.name ?? null
    const lastDataSentAt = [meta?.status.lastFullSyncAt, meta?.status.lastSuccessfulDataSyncAt]
      .filter(value => validTimestamp(value) && Date.parse(value) <= timestamp).sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null
    return { schemaVersion: 1, date, lastMeeting, lastDataSentAt,
      schedule: races.length ? 'scheduled' : await schedule(date), races: races.map(race => rows.get(race.id)) }
  }
  async function getCatalog() {
    const date=japanRaceDay(now())
    // A PACI pack can arrive the day before the meeting. Do not hide it behind today's date.
    // Keep complete meetings: the general 36-row list may contain only part of the older day.
    const [current,recent]=await Promise.all([availableRaces(date),availableRaces()])
    const latestDate=recent[0]?.raceDate
    const rows=new Map([...current,...recent.filter(race=>race.raceDate===latestDate)]
      .map(race=>[`${race.raceDate}:${race.id}`,race]))
    return {schemaVersion:1,date,availableRaces:[...rows.values()].sort((a,b)=>b.raceDate.localeCompare(a.raceDate)
      ||String(a.postTime??'').localeCompare(String(b.postTime??''))||a.id.localeCompare(b.id))}
  }
  async function getRaceProgress({raceDate}){
    validateRaceKey('progress',raceDate)
    const timestamp=now(),races=await availableRaces(raceDate),rows=new Map()
    await forEachBounded(races,6,async item=>{
      const [row]=await list(`${racePrefix(item.id,item.raceDate)}/observations`,{limit:1,column:'created_at',order:'desc'})
      const stored=row?await store.get(row.path):null
      if(row&&(!stored||stored.ownerId!==ownerId||stored.race?.raceId!==item.id||stored.race?.raceDate!==item.raceDate))conflict('結果の開催情報が一致しません。')
      const race=stored?raceMeta(stored.race):item
      rows.set(item.id,{...race,result:summarizeRaceResult(stored?.race.context,race,timestamp)})
    })
    return {schemaVersion:1,raceDate,checkedAt:new Date(timestamp).toISOString(),races:races.map(r=>rows.get(r.id))}
  }
  function checkCommand(command) {
    if (!plain(command) || command.ownerId !== ownerId || !/^\d{1,12}-[a-f0-9]{64}$/.test(command.id ?? '')
      || !Number.isSafeInteger(command.sequence) || command.sequence < 1 || command.sequence > 1_000_000
      || !validTimestamp(command.requestedAt) || !validTimestamp(command.expiresAt)
      || Date.parse(command.expiresAt) - Date.parse(command.requestedAt) !== COMMAND_TTL) conflict('取得依頼の記録を検証できません。')
    validateRaceKey(command.raceId, command.raceDate)
    return command
  }
  const commandPublic = (command, status = 'pending') => ({ id: command.id, raceId: command.raceId, raceDate: command.raceDate,
    requestedAt: command.requestedAt, expiresAt: command.expiresAt, status })
  async function commandStatus(command) {
    const ack = await store.get(`${prefix}/capture-acks/${command.id}.json`)
    if (ack) {
      if (ack.ownerId !== ownerId || ack.id !== command.id || !['completed', 'failed'].includes(ack.status)) conflict('取得依頼の完了記録を検証できません。')
      return ack.status
    }
    return Date.parse(command.expiresAt) <= now() ? 'expired' : 'pending'
  }
  async function pullCommands() {
    const bucket = Math.floor(now() / COMMAND_TTL)
    const commands = []
    for (const slot of [bucket - 1, bucket]) {
      const rows = await list(`${prefix}/capture-commands/${slot}`, { limit: 1000, complete: true })
      for (const row of rows) {
        const command = checkCommand(await store.get(row.path))
        if (Date.parse(command.expiresAt) <= now()) continue
        if (await commandStatus(command) === 'pending') commands.push(commandPublic(command))
      }
    }
    return { schemaVersion: 1, commands: commands.sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id)).slice(0, 36) }
  }
  async function requestCapture({ raceId, raceDate }) {
    validateRaceKey(raceId, raceDate)
    const pending = (await pullCommands()).commands
    const duplicate = pending.find(command => command.raceId === raceId && command.raceDate === raceDate)
    if (duplicate) return { ok: true, command: duplicate }
    if (pending.length >= 36) throw new ApiError(429, 'capture_queue_full', '取得依頼が処理待ちです。完了後に再実行してください。')
    const base = `${prefix}/capture-races/${raceDate}/${raceId}`
    const publish = async command => {
      await immutable(`${base}/versions/${String(command.sequence).padStart(7, '0')}-${command.id}.json`, command)
      await immutable(`${prefix}/capture-commands/${command.id.split('-')[0]}/${command.id}.json`, command)
    }
    // One successor slot per previous command also suppresses requests across a clock-bucket boundary.
    for (let attempt = 0; attempt < 4; attempt++) {
      const rows = await list(`${base}/versions`, { limit: 1, order: 'desc' })
      const previous = rows.length ? checkCommand(await store.get(rows[0].path)) : null
      if (previous && await commandStatus(previous) === 'pending') {
        await publish(previous)
        return { ok: true, command: commandPublic(previous) }
      }
      const requestedAt = new Date(now()).toISOString(), bucket = Math.floor(now() / COMMAND_TTL)
      const id = `${bucket}-${contentHash({ ownerId, raceId, raceDate, requestedAt, previousId: previous?.id ?? null })}`
      const proposed = { schemaVersion: 1, ownerId, id, raceId, raceDate, sequence: (previous?.sequence ?? 0) + 1, requestedAt, expiresAt: new Date(Date.parse(requestedAt) + COMMAND_TTL).toISOString() }
      const reservation = await store.putImmutable(`${base}/slots/${keyHash(previous?.id ?? 'first')}.json`, proposed)
      const command = checkCommand(reservation.created ? proposed : reservation.existing)
      if (command.raceId !== raceId || command.raceDate !== raceDate) conflict('取得依頼の範囲が一致しません。')
      await publish(command)
      if (await commandStatus(command) === 'pending') return { ok: true, command: commandPublic(command) }
    }
    throw new ApiError(409, 'capture_request_conflict', '取得依頼が更新されました。もう一度実行してください。')
  }
  async function acknowledgeCommand({ id, status }) {
    if (!/^\d{1,12}-[a-f0-9]{64}$/.test(id ?? '') || !['completed', 'failed'].includes(status)) invalid('取得依頼の完了条件が不正です。')
    const stored = await store.get(`${prefix}/capture-commands/${id.split('-')[0]}/${id}.json`)
    if (!stored) throw new ApiError(404, 'command_not_found', '取得依頼が見つかりません。')
    const command = checkCommand(stored)
    const ack = { schemaVersion: 1, ownerId, id, status, acknowledgedAt: new Date(now()).toISOString() }
    const saved = await store.putImmutable(`${prefix}/capture-acks/${id}.json`, ack)
    if (!saved.created && (saved.existing?.ownerId !== ownerId || saved.existing?.id !== id || saved.existing?.status !== status)) conflict('取得依頼の完了記録が競合しています。')
    return { ok: true, command: commandPublic(command, status) }
  }
  async function getCaptureRequest({raceId,raceDate}) {
    validateRaceKey(raceId,raceDate)
    const rows=await list(`${prefix}/capture-races/${raceDate}/${raceId}/versions`,{limit:1,order:'desc'})
    const command=rows.length?checkCommand(await store.get(rows[0].path)):null
    if(command&&(command.raceId!==raceId||command.raceDate!==raceDate))conflict('取得依頼の範囲が一致しません。')
    const meta=await latestMeta()
    return {command:command?commandPublic(command,await commandStatus(command)):null,
      workerLastContactAt:meta?.receivedAt??null}
  }
  async function readLedger(scope) {
    const ledger = emptyLedger(scope), base = `${racePrefix(scope.raceId, scope.raceDate)}/ledger`
    for (const kind of LEDGER_COLLECTIONS) {
      const rows = await list(`${base}/${kind}`, { limit: 500, complete: true })
      const records = await Promise.all(rows.map(row => store.get(row.path)))
      if (records.some(record => !record || record.ownerId !== ownerId || record.scope?.raceId !== scope.raceId || record.scope?.raceDate !== scope.raceDate || record.kind !== kind)) conflict('保存済み記録の範囲が一致しません。')
      const remaining = uniqueRecords(records.map(value => value.record), 'id')
      const ids = new Set()
      // Correct dependency order is independent of client clocks or Storage listing order.
      while (remaining.length) {
        const index = remaining.findIndex(record => !(kind === 'forecasts' ? record.parentId : record.replacesId) || ids.has(kind === 'forecasts' ? record.parentId : record.replacesId))
        if (index < 0) conflict('訂正履歴の参照を復元できません。')
        const [record] = remaining.splice(index, 1)
        if (!ledger[kind]) ledger[kind] = []
        ledger[kind].push(record); ids.add(record.id)
      }
    }
    try { return validateLedger(ledger, scope) } catch { conflict('保存済み記録に競合があります。購入金額は自動集計していません。') }
  }
  async function ingestBundle(input) {
    const bundle = validateBundle(input, { ownerId, runtimeValidator, now: now() })
    const receivedAt = new Date(now()).toISOString(), hash = contentHash(bundle)
    // Store the full immutable input before publishing its race records and metadata.
    await immutable(`${prefix}/bundles/${hash}.json`, { schemaVersion: 1, ownerId, bundle })
    await forEachBounded(bundle.races, 4, async race => {
      const base = racePrefix(race.raceId, race.raceDate), raceHash = contentHash(race)
      const path = `${base}/observations/${raceHash}.json`
      const existing = await store.get(path)
      if (existing && (existing.ownerId !== ownerId || contentHash(existing.race) !== raceHash)) conflict('保存済み観測の内容が一致しません。')
      if (!existing) {
        // At most four races × four identities: retain create-only conflict checks without serial network latency.
        const identities = [...race.snapshots.map(value => ({ path: `${base}/snapshot-ids/${keyHash(value.id)}.json`, value })),
          ...race.observations.map(value => ({ path: `${base}/observation-ids/${keyHash(value.eventId)}.json`, value }))]
        await forEachBounded(identities, 4, item => immutable(item.path, item.value))
        const raceRecord = { schemaVersion: 1, ownerId, generatedAt: bundle.generatedAt, race }
        const savedRace = await store.putImmutable(path, raceRecord)
        // A published immutable race has already passed every identity check. Identical retries can reuse it.
        if (!savedRace.created && (savedRace.existing?.ownerId !== ownerId || contentHash(savedRace.existing?.race) !== raceHash)) conflict('保存済み観測の内容が一致しません。')
      }
      const indexPath = `${prefix}/race-index/${race.raceDate}/${race.raceId}.json`
      // The index only records discovery. Changing metadata comes from the latest race payload.
      await store.putImmutable(indexPath, raceMeta(race))
    })
    const prior = await latestMeta()
    if (bundle.forecastReview) {
      const review = bundle.forecastReview
      const path = `${prefix}/forecast-review/${String(Date.parse(review.generatedAt)).padStart(13, '0')}.json`
      const saved = await store.putImmutable(path, { ownerId, receivedAt, review })
      if (!saved.created && (saved.existing?.ownerId !== ownerId || contentHash(saved.existing?.review) !== contentHash(review))) {
        conflict('同じ集計時刻に異なる振り返りが届きました。')
      }
    }
    const meta = { schemaVersion: 1, ownerId, generatedAt: bundle.generatedAt, receivedAt, status: bundle.status,
      models: { abilityModel: bundle.models.abilityModel ?? prior?.models?.abilityModel ?? null,
        runtimeModel: bundle.models.runtimeModel ?? prior?.models?.runtimeModel ?? null } }
    await immutable(`${prefix}/meta/${String(now()).padStart(13, '0')}-${hash}.json`, meta)
    return { ok: true, receivedAt, races: bundle.races.length, bundleHash: hash }
  }
  async function get({ raceId, raceDate } = {}) {
    if (raceId != null) validateRaceKey(raceId, raceDate)
    else if (raceDate != null && (!/^\d{8}$/.test(raceDate) || !raceDateISO({ raceDate }))) invalid('開催日が不正です。')
    const meta = await latestMeta()
    const response = { schemaVersion: 1, status: { ...(meta ? { ...meta.status, syncedAt: meta.receivedAt } : { state: 'not_connected' }), pendingCaptureCount: (await pullCommands()).commands.length },
      models: meta?.models ?? { abilityModel: null, runtimeModel: null }, forecastReview: await latestReview(), availableRaces: await availableRaces(raceDate) }
    if (!raceId) return response
    const scope = { userId: ownerId, raceId, raceDate }
    const rows = await list(`${racePrefix(raceId, raceDate)}/observations`, { limit: MAX_RACE_FILES, complete: true })
    const records = (await Promise.all(rows.map(row => store.get(row.path)))).sort((a, b) => Date.parse(a?.generatedAt) - Date.parse(b?.generatedAt))
    for (const record of records) {
      if (!record || record.ownerId !== ownerId || record.race?.raceId !== raceId || record.race?.raceDate !== raceDate) conflict('観測記録の範囲が一致しません。')
      validateRaceInput(record.race, ownerId, now())
    }
    const latest = records.at(-1)?.race
    const saved = await pullLedger(scope, true)
    return { ...response, race: latest ? { ...latest.race, id: raceId, raceDate } : null,
      snapshots: uniqueRecords(records.flatMap(record => record.race.snapshots), 'id'),
      observations: uniqueRecords(records.flatMap(record => record.race.observations), 'eventId'),
      context: latest?.context ?? null, results: latest?.results ?? null, ledger: saved.ledger, groupReceipts: saved.groupReceipts ?? {}, receipts: Object.fromEntries((saved.receipts ?? []).map(receipt => [receipt.forecastId,receipt])), conflicts: [] }
  }
  async function saveLedger(input) {
    const startedAt = now()
    boundedJson(input)
    validateRaceKey(input?.scope?.raceId, input?.scope?.raceDate)
    const scope = { userId: ownerId, raceId: input.scope.raceId, raceDate: input.scope.raceDate }
    if (input.scope.userId !== ownerId) throw new ApiError(403, 'forbidden', 'この記録へのアクセス権がありません。')
    try { validateLedger(input, scope) } catch { invalid('予想・購入記録の形式が不正です。') }
    const previous = await readLedger(scope)
    let merged
    try { merged = importLedger(previous, JSON.stringify(input)) } catch { conflict('記録または訂正履歴が競合しています。先に最新の記録を同期してください。') }
    const base = `${racePrefix(scope.raceId, scope.raceDate)}/ledger`
    await immutable(`${base}/archives/${contentHash(input)}.json`, { schemaVersion: 1, ownerId, ledger: input })
    for (const kind of LEDGER_COLLECTIONS) {
      for (const record of merged[kind] ?? []) {
        // Reserve IDs across record kinds as well as across stale clients. A failed attempt can be retried identically.
        await immutable(`${base}/ids/${keyHash(record.id)}.json`, { kind, record })
        const semanticId = kind === 'settlements' ? record.replacesId ? `replace:${record.replacesId}` : `purchase:${record.purchaseId}`
          : kind === 'purchases' && record.replacesId ? `replace:${record.replacesId}` : `id:${record.id}`
        await immutable(`${base}/${kind}/${keyHash(semanticId)}.json`, { schemaVersion: 1, ownerId, scope, kind, record })
      }
    }
    const candidates = input.forecasts.filter(record => (record.kind === 'ace' || record.kind === 'user'
      && record.parameters.anchorSelection?.method === SINGLE_ANCHOR_METHOD
      && ['selected','skip'].includes(record.parameters.anchorSelection.decision)) && record.mode === 'live'
      && record.inputs.probabilityStack)
    const receipts = Object.create(null)
    await forEachBounded(candidates, 4, async record => {
      const receipt = await store.get(`${base}/receipts/${keyHash(record.id)}.json`)
      if (!receipt) return
      if (receipt.ownerId !== ownerId || receipt.raceId !== scope.raceId || receipt.raceDate !== scope.raceDate
        || receipt.forecastId !== record.id) conflict('予想の受領記録を確認できません。')
      receipts[record.id] = receipt
    })
    const newForecasts = candidates.filter(record => !receipts[record.id] && Date.parse(record.createdAt) <= startedAt
      && startedAt <= Date.parse(record.cutoffAt))
    const received = newForecasts.length ? await get(scope) : null
    const cutoffAt = decisionCutoff(received?.race)
    for (const record of newForecasts) {
      const calibration = received.forecastReview?.active.find(model => model.id === record.inputs.probabilityCalibration
        && model.stack === record.inputs.probabilityStack && model.temperature === record.inputs.probabilityTemperature
        && model.testedThrough < scope.raceDate && Date.parse(received.forecastReview.receivedAt) <= Date.parse(record.createdAt))
      if (record.inputs.probabilityCalibration && !calibration) continue
      const source = received.snapshots?.find(row => row.id === record.inputs.sourceId && row.kind === 'observed')
      if (!cutoffAt || Date.parse(record.cutoffAt) !== Date.parse(cutoffAt) || !source
        || !snapshotTiming(source, received.race).eligible || Date.parse(source.retrievedAt) > Date.parse(record.createdAt)
        || ['observedAt', 'retrievedAt', 'sourcePublishedAt'].some(key => (source[key] != null || record.inputs[key] != null)
          && Date.parse(source[key]) !== Date.parse(record.inputs[key]))
        || contentHash(source.odds) !== contentHash(record.inputs.winOdds)
        || record.field.length !== Object.keys(source.odds).length || record.field.some(h => !Object.hasOwn(source.odds, h.no))) continue
      const receipt = { schemaVersion: 1, ownerId, raceId: scope.raceId, raceDate: scope.raceDate,
        forecastId: record.id, cutoffAt, receivedAt: new Date(startedAt).toISOString(), sourceId: source.id }
      await immutable(`${prefix}/forecast-index/${scope.raceDate}/${scope.raceId}.json`, { raceId: scope.raceId, raceDate: scope.raceDate })
      const saved = await store.putImmutable(`${base}/receipts/${keyHash(record.id)}.json`, receipt)
      receipts[record.id] = saved.created ? receipt : saved.existing
    }
    // Group decisions have no model probabilities and never enter forecast calibration.
    const groupReceipts = Object.create(null)
    const groupCandidates = (input.groupPlans ?? []).filter(p => p.mode === 'live')
    const groupData = groupCandidates.length ? await get(scope) : null
    for (const plan of groupCandidates) {
      const path = `${base}/group-receipts/${keyHash(plan.id)}.json`
      const previousReceipt = await store.get(path)
      if (previousReceipt) { groupReceipts[plan.id] = previousReceipt; continue }
      const source = groupData.snapshots?.find(s => s.id === plan.snapshot.id && s.kind === 'observed')
      const cutoff = decisionCutoff(groupData.race)
      if (!source || !cutoff || cutoff !== plan.cutoffAt || !snapshotTiming(source,groupData.race).eligible
        || Date.parse(plan.createdAt) > startedAt || startedAt > Date.parse(cutoff)
        || contentHash(source) !== contentHash(plan.snapshot)
        || plan.field.length !== Object.keys(source.odds).length || plan.field.some(h => !Object.hasOwn(source.odds,h.no))) continue
      const receipt = { ownerId, raceId:scope.raceId, raceDate:scope.raceDate, planId:plan.id, sourceId:source.id,
        receivedAt:new Date(startedAt).toISOString(), cutoffAt:cutoff }
      const saved = await store.putImmutable(path,receipt)
      groupReceipts[plan.id] = saved.created ? receipt : saved.existing
    }
    return { ok: true, ledger: await readLedger(scope), receipts: { ...receipts }, groupReceipts: { ...groupReceipts } }
  }
  async function pullLedger({ raceId, raceDate }, includeDecisions = false) {
    validateRaceKey(raceId, raceDate)
    const base = `${racePrefix(raceId, raceDate)}/ledger/receipts`
    const rows = await list(base, { limit: 500, complete: true })
    const receipts = await Promise.all(rows.map(row => store.get(row.path)))
    if (receipts.some(row => !row || row.ownerId !== ownerId || row.raceId !== raceId || row.raceDate !== raceDate)) conflict('予想の受領記録を確認できません。')
    const ledger = await readLedger({ userId: ownerId, raceId, raceDate })
    const originalIds = new Set(ledger.forecasts.filter(record => record.kind === 'ace').map(record => record.id))
    // Existing Python workers attest and train original forecasts only. Owner GET may also show decision receipts.
    const visibleReceipts = includeDecisions ? receipts : receipts.filter(receipt => originalIds.has(receipt.forecastId))
    const response = { schemaVersion: 1, ledger, ...(visibleReceipts.length ? { receipts: visibleReceipts } : {}), conflicts: [] }
    if (includeDecisions) {
      const rows = await list(`${racePrefix(raceId,raceDate)}/ledger/group-receipts`, { limit:500, complete:true })
      const groups = await Promise.all(rows.map(row => store.get(row.path)))
      if (groups.some(r => !r || r.ownerId !== ownerId || r.raceId !== raceId || r.raceDate !== raceDate)) conflict('グループ判断の受領範囲が一致しません。')
      response.groupReceipts = Object.fromEntries(groups.map(r => [r.planId,r]))
    }
    if (Buffer.byteLength(JSON.stringify(response)) > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', 'このレースの記録は同期上限を超えています。記録は保持しています。')
    return response
  }
  async function pullForecastRaces() {
    const base = `${prefix}/forecast-index`
    const dates = (await list(base, { limit: 8, order: 'desc' })).map(row => row.name).filter(day => /^\d{8}$/.test(day))
    const races = await Promise.all(dates.map(async raceDate => (await list(`${base}/${raceDate}`, { limit: 72 }))
      .filter(row => row.name.endsWith('.json'))
      .map(row => validateRaceKey(row.name.slice(0, -5), raceDate))))
    return { schemaVersion: 1, races: races.flat() }
  }
  async function getGroupRegistrations(raceDate){
    const rows=await list(`${prefix}/group-registrations/${raceDate}/records`,{limit:1000,complete:true}),records=[],receipts={}
    await forEachBounded(rows,4,async row=>{
      const stored=await store.get(row.path)
      if(stored?.ownerId!==ownerId||!validTimestamp(stored.receivedAt))conflict('グループ登録の保存内容を確認できません。')
      try{validateGroupRegistration(stored.record)}catch{conflict('グループ登録の保存内容を確認できません。')}
      if(stored.record.race.raceDate!==raceDate)conflict('グループ登録の開催日が一致しません。')
      records.push(stored.record);receipts[stored.record.id]=stored.receivedAt
    })
    return {registrations:mergeGroupRegistrations([],records),receipts}
  }
  async function saveGroupRegistration(record){
    boundedJson(record)
    try{validateGroupRegistration(record)}catch(error){invalid(error.message)}
    const {id:raceId,raceDate}=record.race
    validateRaceKey(raceId,raceDate);checkTime(record.createdAt,now(),'登録日時')
    const base=`${prefix}/group-registrations/${raceDate}`,path=`${base}/records/${keyHash(record.id)}.json`
    const before=await store.get(path)
    if(before){if(before.ownerId!==ownerId||contentHash(before.record)!==contentHash(record))conflict('同じIDのグループ登録は変更できません。');return {ok:true,receivedAt:before.receivedAt}}
    const [metaRow]=await list(`${racePrefix(raceId,raceDate)}/observations`,{limit:1,order:'desc',column:'created_at'})
    const meta=metaRow?await store.get(metaRow.path):null
    if(!meta?.race?.race?.horses?.length)invalid('先にこのレースのデータを同期してください。')
    if(meta.ownerId!==ownerId||meta.race.raceId!==raceId||meta.race.raceDate!==raceDate)conflict('観測の保存範囲が一致しません。')
    const field=meta.race.race.horses
    if(record.field.length!==field.length||field.some(h=>h.cancelled)||record.field.some(h=>!field.some(f=>Number(f.no)===h.no&&f.name===h.name)))invalid('同期済みの出走馬と一致しません。')
    const stored=await store.get(`${racePrefix(raceId,raceDate)}/snapshot-ids/${keyHash(record.snapshot.id)}.json`)
    if(!stored||['id','kind','raceId','raceDate','observedAt','retrievedAt','odds'].some(key=>contentHash(stored[key])!==contentHash(record.snapshot[key]))
      ||record.race.postTime!==meta.race.race.postTime)invalid('同期済みの観測・発走時刻と一致しません。')
    const {registrations}=await getGroupRegistrations(raceDate),current=latestGroupRegistration(registrations,raceId)
    if((current?.id??null)!==record.replacesId)conflict('グループが更新されています。再読込してから登録してください。')
    try{mergeGroupRegistrations(registrations,[record])}catch(error){invalid(error.message)}
    await immutable(`${base}/links/${keyHash(`${raceId}:${record.replacesId??'first'}`)}.json`,{id:record.id,hash:contentHash(record)})
    const receivedAt=new Date(now()).toISOString(),created=await store.putImmutable(path,{ownerId,record,receivedAt})
    if(!created.created){if(contentHash(created.existing.record)!==contentHash(record))conflict('同じIDに異なる登録があります。');return {ok:true,receivedAt:created.existing.receivedAt}}
    return {ok:true,receivedAt}
  }
  async function getPredictionJournal({raceDate}) {
    validateRaceKey('day',raceDate)
    const journal={predictions:[],results:[],receipts:{},legacy:[],official:[],races:[]}
    for(const kind of ['predictions','results']){
      const rows=await list(`${prefix}/prediction-journal/${raceDate}/${kind}`,{limit:1000,complete:true})
      await forEachBounded(rows,4,async row=>{
        const stored=await store.get(row.path)
        if(!stored||stored.ownerId!==ownerId||!validTimestamp(stored.receivedAt))conflict('予想・結果の保存内容を確認できません。')
        try{(kind==='predictions'?validatePrediction:validateJournalResult)(stored.record)}catch{conflict('予想・結果の保存内容を確認できません。')}
        if((stored.record.race?.raceDate??stored.record.raceDate)!==raceDate)conflict('開催日が一致しません。')
        journal[kind].push(stored.record);journal.receipts[stored.record.id]=stored.receivedAt
      })
    }
    const merged=mergeJournal({predictions:[],results:[]},journal)
    const races=await availableRaces(raceDate)
    await forEachBounded(races,4,async race=>{
      const [latestRow]=await list(`${racePrefix(race.id,raceDate)}/observations`,{limit:1,column:'created_at',order:'desc'})
      const payload=latestRow?await store.get(latestRow.path):null
      if(payload&&(payload.ownerId!==ownerId||payload.race?.raceId!==race.id||payload.race?.raceDate!==raceDate))conflict('観測の保存範囲が一致しません。')
      const meta={...race,...payload?.race?.race}
      journal.races.push(Object.fromEntries(['id','raceDate','place','placeCode','raceNo','name','postTime','fieldSize'].filter(key=>meta[key]!=null).map(key=>[key,meta[key]])))
      const official=officialJournalResult(payload?.race?.race??race,payload?.race?.observations,now())
      if(official)journal.official.push(official)
      const rows=await list(`${racePrefix(race.id,raceDate)}/ledger/groupPlans`,{limit:500,complete:true})
      for(const row of rows){
        const stored=await store.get(row.path)
        if(stored?.ownerId!==ownerId||stored.scope?.raceId!==race.id||stored.scope?.raceDate!==raceDate)conflict('以前の予想記録を確認できません。')
        if(stored.record.decision==='plan')journal.legacy.push(legacyPrediction(stored.record))
      }
    })
    const groups=await getGroupRegistrations(raceDate)
    return {...journal,...merged,registrations:groups.registrations,receipts:{...journal.receipts,...groups.receipts}}
  }
  async function saveJournalRecord(record){
    boundedJson(record)
    const raceId=record?.race?.id??record?.raceId,raceDate=record?.race?.raceDate??record?.raceDate
    validateRaceKey(raceId,raceDate)
    const kind=record?.kind==='selection'?'predictions':record?.kind==='result'?'results':null
    if(!kind)invalid('予想または結果を指定してください。')
    try{(kind==='predictions'?validatePrediction:validateJournalResult)(record)}catch(error){invalid(error.message)}
    checkTime(record.createdAt,now(),'登録日時')
    const base=`${prefix}/prediction-journal/${raceDate}`,path=`${base}/${kind}/${keyHash(record.id)}.json`
    const before=await store.get(path)
    if(before){if(contentHash(before.record)!==contentHash(record))conflict('同じIDの記録は変更できません。');return {ok:true,receivedAt:before.receivedAt}}
    const metaRows=await list(`${racePrefix(raceId,raceDate)}/observations`,{limit:1,order:'desc',column:'created_at'})
    const meta=metaRows.length?await store.get(metaRows[0].path):null
    if(!meta?.race?.race?.horses?.length)invalid('先にこのレースのデータを同期してください。')
    if(meta.ownerId!==ownerId||meta.race.raceId!==raceId||meta.race.raceDate!==raceDate)conflict('観測の保存範囲が一致しません。')
    const field=meta.race.race.horses.map(h=>Number(h.no))
    if(kind==='predictions'&&(record.field.length!==field.length||record.field.some(h=>!field.includes(h.no)))
      ||kind==='results'&&record.numbers.some(no=>!field.includes(no)))invalid('出走馬の馬番が一致しません。')
    if(kind==='predictions'){
      const stored=await store.get(`${racePrefix(raceId,raceDate)}/snapshot-ids/${keyHash(record.snapshot.id)}.json`)
      if(!stored||['id','kind','raceId','raceDate','observedAt','retrievedAt','odds'].some(key=>contentHash(stored[key])!==contentHash(record.snapshot[key]))
        ||record.race.postTime!==meta.race.race.postTime)invalid('同期済みの観測・発走時刻と一致しません。最新のレース情報を確認してください。')
    }
    if(kind==='results'){
      if(now()<Date.parse(raceTimestamp(meta.race.race,meta.race.race.postTime)))invalid('発走予定時刻前の結果は登録できません。')
      const rows=await list(`${base}/results`,{limit:1000,complete:true}),results=[]
      for(const row of rows){const value=await store.get(row.path);results.push(value.record)}
      const current=latestResult(results,raceId)
      if((current?.id??null)!==record.replacesId)conflict('結果が更新されています。同期してから訂正してください。')
      try{mergeJournal({predictions:[],results},{predictions:[],results:[record]})}catch(error){invalid(error.message)}
      // The unique parent reservation prevents competing corrections from overwriting one another.
      await immutable(`${base}/result-links/${keyHash(`${raceId}:${record.replacesId??'first'}`)}.json`,{id:record.id,hash:contentHash(record)})
    }
    const receivedAt=new Date(now()).toISOString()
    const created=await store.putImmutable(path,{ownerId,record,receivedAt})
    if(!created.created){if(contentHash(created.existing.record)!==contentHash(record))conflict('同じIDに異なる内容があります。');return {ok:true,receivedAt:created.existing.receivedAt}}
    return {ok:true,receivedAt}
  }
  return { getPredictionJournal, saveJournalRecord, saveGroupRegistration, ingestBundle, get, getDashboard, getCatalog, getRaceProgress, saveLedger, pullLedger, pullForecastRaces, requestCapture, pullCommands, acknowledgeCommand, getCaptureRequest }
}

export function safeTokenEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || right.length < 32) return false
  const a = Buffer.from(left), b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}
async function readBody(req) {
  const declared = Number(req.headers?.['content-length'] ?? 0)
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', '送信データは3MB以内にしてください。')
  let raw = req.body
  if (raw == null && req[Symbol.asyncIterator]) {
    const parts = []; let size = 0
    for await (const chunk of req) { const data = Buffer.from(chunk); size += data.length; if (size > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', '送信データは3MB以内にしてください。'); parts.push(data) }
    raw = Buffer.concat(parts)
  }
  if (Buffer.isBuffer(raw) || typeof raw === 'string') {
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw new ApiError(413, 'too_large', '送信データは3MB以内にしてください。')
    try { raw = JSON.parse(String(raw)) } catch { invalid('JSON形式を確認してください。') }
  }
  boundedJson(raw)
  return raw
}
export function createCompanionHandler({ service, authenticateUser, ownerId, companionToken, authenticateDevice, checkDeviceWrite }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('Vary', 'Authorization, Cookie')
    res.setHeader('X-Content-Type-Options', 'nosniff')
    try {
      if (!['GET', 'POST'].includes(req.method)) { res.setHeader('Allow', 'GET, POST'); throw new ApiError(405, 'method_not_allowed', 'この操作は利用できません。') }
      const authorization = req.headers?.authorization
      const token = typeof authorization === 'string' && /^Bearer [^\s]+$/i.test(authorization) ? authorization.slice(7) : null
      const isCompanion = req.method === 'POST' && safeTokenEqual(token, companionToken)
      if (!isCompanion) {
        const deviceUser = authenticateDevice ? await authenticateDevice(req) : null
        if (!token && !deviceUser) throw new ApiError(401, 'unauthorized', '端末の承認が必要です。')
        const user = deviceUser ?? await authenticateUser(token)
        if (!user?.id) throw new ApiError(401, 'unauthorized', 'ログインを確認できません。')
        if (user.id !== ownerId) throw new ApiError(403, 'forbidden', 'このデータへのアクセス権がありません。')
        if (deviceUser && req.method === 'POST') {
          if (!checkDeviceWrite) throw new ApiError(403,'invalid_origin','この画面から操作してください。')
          checkDeviceWrite(req)
        }
      }
      if (req.method === 'GET') {
        const query = req.query ?? Object.fromEntries(new URL(req.url, 'https://local.invalid').searchParams)
        if (query.catalog === '1' && Object.keys(query).length === 1) return res.status(200).json(await service.getCatalog())
        if(query.progress==='1'&&Object.keys(query).length===2&&typeof query.raceDate==='string')return res.status(200).json(await service.getRaceProgress({raceDate:query.raceDate}))
        if(query.journal==='1'&&Object.keys(query).length===2&&typeof query.raceDate==='string')return res.status(200).json(await service.getPredictionJournal({raceDate:query.raceDate}))
        if (query.dashboard === '1' && Object.keys(query).length === 1) return res.status(200).json(await service.getDashboard())
        if(query.capture==='1'&&Object.keys(query).length===3&&typeof query.raceId==='string'&&typeof query.raceDate==='string') return res.status(200).json(await service.getCaptureRequest({raceId:query.raceId,raceDate:query.raceDate}))
        if (Object.keys(query).some(key => !['raceId', 'raceDate'].includes(key)) || Object.values(query).some(value => typeof value !== 'string')) invalid('取得条件が不正です。')
        return res.status(200).json(await service.get(query))
      }
      if (!String(req.headers?.['content-type'] ?? '').toLowerCase().startsWith('application/json')) throw new ApiError(415, 'unsupported_type', 'application/json形式で送信してください。')
      const body = await readBody(req)
      if (isCompanion) {
        if (body?.action === 'pull-ledgers') {
          if (Object.keys(body).some(key => !['action', 'raceId', 'raceDate'].includes(key))) invalid('取得条件が不正です。')
          return res.status(200).json(await service.pullLedger(body))
        }
        if (body?.action === 'pull-forecast-races') {
          if (Object.keys(body).some(key => key !== 'action')) invalid('取得条件が不正です。')
          return res.status(200).json(await service.pullForecastRaces())
        }
        if (body?.action === 'pull-commands') {
          if (Object.keys(body).some(key => key !== 'action')) invalid('取得条件が不正です。')
          return res.status(200).json(await service.pullCommands())
        }
        if (body?.action === 'ack-command') {
          if (Object.keys(body).some(key => !['action', 'id', 'status'].includes(key))) invalid('取得条件が不正です。')
          return res.status(200).json(await service.acknowledgeCommand(body))
        }
        return res.status(200).json(await service.ingestBundle(body))
      }
      if(body?.action==='save-groups'){
        if(Object.keys(body).some(key=>!['action','record'].includes(key)))invalid('グループの保存条件が不正です。')
        return res.status(200).json(await service.saveGroupRegistration(body.record))
      }
      if(body?.action==='save-journal'){
        if(Object.keys(body).some(key=>!['action','record'].includes(key)))invalid('保存条件が不正です。')
        return res.status(200).json(await service.saveJournalRecord(body.record))
      }
      if (body?.action === 'request-capture') {
        if (Object.keys(body).some(key => !['action', 'raceId', 'raceDate'].includes(key))) invalid('取得条件が不正です。')
        return res.status(200).json(await service.requestCapture(body))
      }
      if (body?.action !== 'ledger' || Object.keys(body).some(key => !['action', 'ledger'].includes(key))) throw new ApiError(403, 'forbidden', 'この操作へのアクセス権がありません。')
      return res.status(200).json(await service.saveLedger(body.ledger))
    } catch (error) {
      const known = error instanceof ApiError
      return res.status(known ? error.status : 503).json({ error: { code: known ? error.code : 'sync_unavailable', message: known ? error.message : '同期を完了できませんでした。保存済みの記録は保持しています。' } })
    }
  }
}
