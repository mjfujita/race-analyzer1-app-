export const LEDGER_VERSION = 1
const MAX_RECORDS = 500
const MAX_BYTES = 4_000_000
const TYPES = new Set(['単勝', '複勝', '枠連', '馬連', '馬単', 'ワイド', '3連複', '3連単'])
const NUMBER_COUNTS = { 単勝: 1, 複勝: 1, 枠連: 2, 馬連: 2, 馬単: 2, ワイド: 2, '3連複': 3, '3連単': 3 }
const fail = message => { throw new Error(message) }
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const finite = value => typeof value === 'number' && Number.isFinite(value)
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
  && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const clone = value => JSON.parse(JSON.stringify(value))
const id = () => globalThis.crypto?.randomUUID?.() ?? `record-${Date.now()}-${Math.random().toString(36).slice(2)}`

function inspectJson(value, depth = 0) {
  if (depth > 16) fail('記録の階層が深すぎます。')
  if (value === null || typeof value === 'boolean') return
  if (typeof value === 'string') { if (value.length > 100_000) fail('記録の文字列が長すぎます。'); return }
  if (typeof value === 'number') { if (!Number.isFinite(value)) fail('記録に無効な数値があります。'); return }
  if (Array.isArray(value)) {
    if (value.length > 10_000) fail('記録の項目が多すぎます。')
    value.forEach(item => inspectJson(item, depth + 1)); return
  }
  if (!plain(value)) fail('JSON形式の記録を指定してください。')
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('許可されていない項目があります。')
    inspectJson(child, depth + 1)
  }
}

export function ledgerScope(userId, race) {
  const date = String(race?.raceDate ?? '').replaceAll('-', '')
  if (!userId || !race?.id || !/^\d{8}$/.test(date)) fail('ユーザーとレースを確認できません。')
  return { userId: String(userId), raceId: String(race.id), raceDate: date }
}

export function ledgerKey(scope) {
  return `race-forecast-ledger:v${LEDGER_VERSION}:${encodeURIComponent(scope.userId)}:${scope.raceDate}:${encodeURIComponent(scope.raceId)}`
}

export function emptyLedger(scope) {
  return { schemaVersion: LEDGER_VERSION, scope: clone(scope), forecasts: [], purchases: [], settlements: [] }
}

function sameScope(a, b) {
  return a?.userId === b?.userId && a?.raceId === b?.raceId && a?.raceDate === b?.raceDate
}

function validateTicket(ticket, needsStake = false) {
  if (!plain(ticket) || !TYPES.has(ticket.type) || typeof ticket.key !== 'string' || !ticket.key.length
    || !Array.isArray(ticket.numbers) || ticket.numbers.length !== NUMBER_COUNTS[ticket.type]
    || ticket.numbers.some(number => !Number.isInteger(number) || number < 1 || number > (ticket.type === '枠連' ? 8 : 18))
    || (ticket.type !== '枠連' && new Set(ticket.numbers).size !== ticket.numbers.length)) fail('買い目の形式が正しくありません。')
  const canonical = (['馬単', '3連単'].includes(ticket.type) ? ticket.numbers : [...ticket.numbers].sort((a, b) => a - b))
  if (ticket.key !== `${ticket.type}:${canonical.join('-')}`) fail('買い目の識別子が一致しません。')
  if (needsStake && (!Number.isSafeInteger(ticket.stake) || ticket.stake < 100 || ticket.stake % 100 !== 0 || ticket.stake > 10_000_000)) fail('購入金額は100円単位で入力してください。')
}

function validateTicketField(ticket, field) {
  if (ticket.type !== '枠連') {
    if (ticket.numbers.some(no => !field.some(horse => horse.no === no))) fail('出走しない馬が買い目に含まれています。')
    return
  }
  if (!field.length || field.some(horse => !Number.isInteger(horse.frameNo) || horse.frameNo < 1 || horse.frameNo > 8)) {
    fail('枠連は全出走馬の正式な枠番号が必要です。')
  }
  const counts = new Map()
  for (const horse of field) counts.set(horse.frameNo, (counts.get(horse.frameNo) ?? 0) + 1)
  if (ticket.numbers.some(frame => !counts.has(frame))) fail('枠連に出走馬のいない枠が含まれています。')
  if (ticket.numbers[0] === ticket.numbers[1] && counts.get(ticket.numbers[0]) < 2) fail('同枠の枠連は、その枠に2頭以上の出走馬が必要です。')
}

function validateBase(record) {
  if (!plain(record) || typeof record.id !== 'string' || !record.id || record.id.length > 120 || !validDate(record.createdAt)) fail('記録ID・保存時刻が正しくありません。')
}

export function validateLedger(value, scope) {
  inspectJson(value)
  if (!plain(value) || value.schemaVersion !== LEDGER_VERSION || !sameScope(value.scope, scope)) fail('このユーザー・レースの記録ファイルではありません。')
  if (Object.keys(value).some(key => !['schemaVersion', 'scope', 'forecasts', 'purchases', 'settlements'].includes(key))) fail('未対応の記録項目があります。')
  for (const name of ['forecasts', 'purchases', 'settlements']) {
    if (!Array.isArray(value[name]) || value[name].length > MAX_RECORDS) fail('記録件数または形式が正しくありません。')
  }
  const ids = new Set()
  const forecasts = new Map()
  for (const record of value.forecasts) {
    validateBase(record)
    if (ids.has(record.id)) fail('重複した記録IDがあります。')
    ids.add(record.id)
    if (!['ace', 'user'].includes(record.kind) || !['live', 'replay'].includes(record.mode)
      || !validDate(record.cutoffAt) || typeof record.modelVersion !== 'string' || !record.modelVersion
      || !plain(record.inputs) || !plain(record.parameters) || !Array.isArray(record.field)
      || !Array.isArray(record.allocations) || !plain(record.metrics)
      || !Number.isSafeInteger(record.parameters.budget) || record.parameters.budget < 0 || record.parameters.budget > 10_000_000
      || !['cautious', 'balanced', 'return'].includes(record.parameters.profile)
      || !finite(record.parameters.minHit) || record.parameters.minHit < 0 || record.parameters.minHit > 1
      || !finite(record.parameters.oddsFactor) || record.parameters.oddsFactor <= 0 || record.parameters.oddsFactor > 1) fail('予想の形式が正しくありません。')
    if (record.mode === 'live') {
      const times = [record.inputs.sourcePublishedAt, record.inputs.observedAt, record.inputs.retrievedAt, record.createdAt]
      if (times.some(time => !validDate(time) || Date.parse(time) > Date.parse(record.cutoffAt))
        || times.some((time, index) => index > 0 && Date.parse(time) < Date.parse(times[index - 1]))) fail('締切前記録の時刻証跡が不正です。')
      if (record.inputs.quotes?.some(ticket => ticket.type !== '単勝')) {
        if (![record.inputs.quoteObservedAt, record.inputs.quoteRetrievedAt].every(time => validDate(time) && Date.parse(time) <= Date.parse(record.cutoffAt))
          || Date.parse(record.inputs.quoteObservedAt) > Date.parse(record.inputs.quoteRetrievedAt)) fail('組合せオッズの取得時刻を確認できません。')
      }
      if (record.inputs.model) {
        const modelTimes = [record.inputs.model.generatedAt, record.inputs.model.adoptedAt ?? record.inputs.model.importedAt]
        if (modelTimes.some(time => !validDate(time) || Date.parse(time) > Date.parse(record.cutoffAt))) fail('学習モデルの作成・採用時刻が締切前と確認できません。')
      }
    }
    if (record.kind === 'ace' && record.parentId !== null) fail('ACE原案に親予想は指定できません。')
    if (record.kind === 'user' && forecasts.get(record.parentId)?.kind !== 'ace') fail('利用者案に対応するACE原案がありません。')
    const numbers = new Set()
    for (const horse of record.field) {
      if (!plain(horse) || !Number.isInteger(horse.no) || horse.no < 1 || horse.no > 18 || numbers.has(horse.no)
        || !finite(horse.probability) || horse.probability <= 0 || horse.probability > 1) fail('予想の出走馬・確率が正しくありません。')
      numbers.add(horse.no)
    }
    if (record.field.length < 2 || Math.abs(record.field.reduce((sum, horse) => sum + horse.probability, 0) - 1) > 1e-6) fail('予想確率の合計が1になっていません。')
    if (record.parameters.anchor !== null && !numbers.has(record.parameters.anchor)) fail('軸馬が出走馬にありません。')
    const keys = new Set()
    for (const ticket of record.allocations) {
      validateTicket(ticket, true)
      validateTicketField(ticket, record.field)
      if (keys.has(ticket.key)) fail('配分に同じ買い目が重複しています。')
      keys.add(ticket.key)
    }
    const invested = record.allocations.reduce((sum, ticket) => sum + ticket.stake, 0)
    if (invested > record.parameters.budget) fail('予想の配分が予算を超えています。')
    if (record.metrics.invested !== invested || record.metrics.unspent !== record.parameters.budget - invested) fail('予想の配分と集計金額が一致しません。')
    for (const metric of ['expectedPayout', 'expectedProfit', 'maxLoss']) if (!finite(record.metrics[metric])) fail('予想の集計値が正しくありません。')
    for (const metric of ['hitProbability', 'profitProbability', 'lossProbability', 'allMissProbability']) {
      if (invested === 0 && record.metrics[metric] === null) continue
      if (!finite(record.metrics[metric]) || record.metrics[metric] < 0 || record.metrics[metric] > 1) fail('予想のリスク確率が正しくありません。')
    }
    if (invested === 0 ? record.metrics.expectedReturn !== null : !finite(record.metrics.expectedReturn) || record.metrics.expectedReturn < 0) fail('予想の回収率が正しくありません。')
    forecasts.set(record.id, record)
  }
  const purchases = new Map()
  const supersededPurchases = new Set()
  for (const record of value.purchases) {
    validateBase(record)
    if (ids.has(record.id) || !forecasts.has(record.forecastId) || !Array.isArray(record.tickets) || record.tickets.length > 100) fail('購入記録の参照が正しくありません。')
    ids.add(record.id)
    if (record.replacesId !== null) {
      const previous = purchases.get(record.replacesId)
      if (!previous || previous.forecastId !== record.forecastId || supersededPurchases.has(record.replacesId)) fail('購入訂正の参照が正しくありません。')
      supersededPurchases.add(record.replacesId)
    }
    const keys = new Set()
    const field = forecasts.get(record.forecastId).field
    for (const ticket of record.tickets) {
      validateTicket(ticket, true)
      validateTicketField(ticket, field)
      if (keys.has(ticket.key)) fail('購入記録に同じ買い目が重複しています。')
      keys.add(ticket.key)
    }
    purchases.set(record.id, record)
  }
  const settlements = new Map()
  const supersededSettlements = new Set()
  for (const record of value.settlements) {
    validateBase(record)
    const purchase = purchases.get(record.purchaseId)
    if (ids.has(record.id) || !purchase || !plain(record.payouts)) fail('払戻記録の参照が正しくありません。')
    ids.add(record.id)
    if (record.replacesId !== null) {
      const previous = settlements.get(record.replacesId)
      if (!previous || previous.purchaseId !== record.purchaseId || supersededSettlements.has(record.replacesId)) fail('払戻訂正の参照が正しくありません。')
      supersededSettlements.add(record.replacesId)
    } else if ([...settlements.values()].some(item => item.purchaseId === record.purchaseId)) fail('払戻の変更は訂正記録で保存してください。')
    const keys = purchase.tickets.map(ticket => ticket.key)
    if (Object.keys(record.payouts).length !== keys.length || keys.some(key => !Object.hasOwn(record.payouts, key))) fail('全購入馬券の払戻を入力してください。')
    for (const key of keys) {
      const payout = record.payouts[key]
      if (!Number.isSafeInteger(payout) || payout < 0 || payout > 1_000_000_000) fail('払戻は100円あたりの円額で入力してください。')
    }
    settlements.set(record.id, record)
  }
  return value
}

export function readLedger(storage, scope) {
  try {
    const raw = storage.getItem(ledgerKey(scope))
    if (!raw) return { ledger: emptyLedger(scope), error: null }
    if (raw.length > MAX_BYTES) fail('記録ファイルが大きすぎます。')
    return { ledger: clone(validateLedger(JSON.parse(raw), scope)), error: null }
  } catch (error) {
    return { ledger: emptyLedger(scope), error: `記録を読み込めませんでした。保存済みデータは上書きせず保護しています。${error.message}` }
  }
}

export function writeLedger(storage, ledger) {
  validateLedger(ledger, ledger.scope)
  const key = ledgerKey(ledger.scope)
  const stored = storage.getItem(key)
  if (stored && stored.length > MAX_BYTES) fail('保存済み記録が大きすぎます。上書きせず保護しています。')
  const persisted = stored ? validateLedger(JSON.parse(stored), ledger.scope) : emptyLedger(ledger.scope)
  // Read the persisted state again at write time: another tab may have appended records.
  // A branch in a correction chain is rejected by validateLedger during the merge.
  const merged = importLedger(persisted, JSON.stringify(ledger))
  const raw = JSON.stringify(merged)
  if (raw.length > MAX_BYTES) fail('保存容量の上限です。記録を書き出してください。')
  storage.setItem(key, raw)
  return merged
}

export async function writeLedgerExclusive(storage, ledger, lockManager = globalThis.navigator?.locks) {
  if (!lockManager?.request) fail('このブラウザは記録の同時保存を保護できません。対応するChrome等の安全な接続で開いてください。')
  return lockManager.request(`race-ledger-write:${ledgerKey(ledger.scope)}`, { mode: 'exclusive' }, () => writeLedger(storage, ledger))
}

export function appendForecast(ledger, snapshot, now = new Date().toISOString()) {
  const record = { ...clone(snapshot), id: id(), createdAt: now }
  const next = { ...ledger, forecasts: [...ledger.forecasts, record] }
  validateLedger(next, ledger.scope)
  return { ledger: next, record }
}

export function appendPurchase(ledger, { forecastId, tickets, note = '', replacesId = null }, now = new Date().toISOString()) {
  if (replacesId && !note.trim()) fail('購入記録を訂正する理由を入力してください。')
  const record = { id: id(), createdAt: now, forecastId, tickets: clone(tickets), note, replacesId }
  const next = { ...ledger, purchases: [...ledger.purchases, record] }
  validateLedger(next, ledger.scope)
  return { ledger: next, record }
}

export function appendSettlement(ledger, { purchaseId, payouts, note = '', replacesId = null, source = null }, now = new Date().toISOString()) {
  if (replacesId && !note.trim()) fail('払戻を訂正する理由を入力してください。')
  const record = { id: id(), createdAt: now, purchaseId, payouts: clone(payouts), note, replacesId, source: clone(source) }
  const next = { ...ledger, settlements: [...ledger.settlements, record] }
  validateLedger(next, ledger.scope)
  return { ledger: next, record }
}

export function activePurchases(ledger) {
  const replaced = new Set(ledger.purchases.map(record => record.replacesId))
  return ledger.purchases.filter(record => !replaced.has(record.id))
}

export function latestSettlement(ledger, purchaseId) {
  return [...ledger.settlements].reverse().find(record => record.purchaseId === purchaseId) ?? null
}

export function summarizeLedger(ledger) {
  const purchases = activePurchases(ledger)
  let invested = 0, settledInvested = 0, payout = 0, settledCount = 0
  for (const purchase of purchases) {
    const cost = purchase.tickets.reduce((sum, ticket) => sum + ticket.stake, 0)
    invested += cost
    const settlement = latestSettlement(ledger, purchase.id)
    if (!settlement) continue
    settledCount++
    settledInvested += cost
    payout += purchase.tickets.reduce((sum, ticket) => sum + settlement.payouts[ticket.key] * ticket.stake / 100, 0)
  }
  return { invested, settledInvested, payout, profit: payout - settledInvested,
    returnRate: settledInvested ? payout / settledInvested : null, purchaseCount: purchases.length,
    settledCount, pendingCount: purchases.length - settledCount }
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (plain(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function importLedger(existing, raw) {
  if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail('記録ファイルのサイズを確認してください。')
  const incoming = validateLedger(JSON.parse(raw), existing.scope)
  const next = { ...existing }
  for (const name of ['forecasts', 'purchases', 'settlements']) {
    const known = new Map(existing[name].map(record => [record.id, record]))
    const addition = []
    for (const record of incoming[name]) {
      const prior = known.get(record.id)
      if (prior && canonical(prior) !== canonical(record)) fail('同じIDの異なる記録があります。元データを保護するため取込みを中止しました。')
      if (!prior) addition.push(record)
    }
    next[name] = [...existing[name], ...addition]
  }
  validateLedger(next, existing.scope)
  return clone(next)
}

export function exportLedger(ledger) {
  validateLedger(ledger, ledger.scope)
  return JSON.stringify(ledger, null, 2)
}

export function parsePurchasedTickets(text, field) {
  if (typeof text !== 'string' || text.length > 30_000) fail('購入内容が長すぎます。')
  const lines = text.trim() ? text.trim().split(/\r?\n/) : []
  const tickets = [], keys = new Set()
  for (const line of lines) {
    const [type, selection, amount, ...extra] = line.trim().split(/\s+/)
    if (extra.length || !TYPES.has(type) || !/^\d+(?:[-－→]\d+)*$/.test(selection ?? '') || !/^\d+$/.test(amount ?? '')) fail('購入内容は「券種 馬番 金額」を1行ずつ入力してください。')
    const numbers = selection.split(/[-－→]/).map(Number)
    const ordered = ['馬単', '3連単'].includes(type) ? numbers : [...numbers].sort((a, b) => a - b)
    const ticket = { type, numbers: ordered, key: `${type}:${ordered.join('-')}`, stake: Number(amount) }
    validateTicket(ticket, true)
    validateTicketField(ticket, field)
    if (keys.has(ticket.key)) fail('同じ買い目が重複しています。金額を合計して1行で入力してください。')
    keys.add(ticket.key); tickets.push(ticket)
  }
  return tickets
}

export function parseRaceObservations(raw, scope) {
  if (typeof raw !== 'string' || raw.length > 15_000_000) fail('15MB以下の観測データJSONを指定してください。')
  const input = JSON.parse(raw)
  inspectJson(input)
  if (input?.schemaVersion !== 1 || input.kind !== 'race-market-observations' || !Array.isArray(input.observations)) fail('自動取込みで出力したobservations.jsonを指定してください。')
  const observations = input.observations.filter(event => String(event?.payload?.raceId) === scope.raceId
    && String(event?.payload?.raceDate ?? '').replaceAll('-', '') === scope.raceDate && ['TYB', 'HJC'].includes(event.kind))
  if (!observations.length) fail('このレースのTYB・HJCデータが含まれていません。')
  const ids = new Set()
  for (const event of observations) {
    if (typeof event.eventId !== 'string' || !event.eventId || event.eventId.length > 200 || ids.has(event.eventId)
      || !validDate(event.retrievedAt) || !plain(event.payload)) fail('観測データのID・取得時刻が不正です。')
    ids.add(event.eventId)
    if (event.kind === 'TYB' && (!Number.isInteger(event.payload.horseNo) || event.payload.horseNo < 1 || event.payload.horseNo > 18)) fail('TYBの馬番が不正です。')
    if (event.kind === 'HJC') {
      if (!['pending', 'published'].includes(event.payload.status) || !Array.isArray(event.payload.payouts)) fail('HJCの状態・払戻形式が不正です。')
      const keys = new Set()
      for (const payout of event.payload.payouts) {
        validateTicket(payout)
        if (!Number.isSafeInteger(payout.per100) || payout.per100 < 0 || payout.per100 > 1_000_000_000 || keys.has(payout.key)) fail('HJCの払戻金・買い目が不正です。')
        keys.add(payout.key)
      }
    }
  }
  return { schemaVersion: 1, kind: 'race-market-observations', observations: clone(observations) }
}

export function mergeRaceObservations(existing, incoming, scope) {
  const current = existing?.observations ?? []
  const known = new Map(current.map(event => [event.eventId, event]))
  const merged = [...current]
  for (const event of incoming.observations) {
    if (known.has(event.eventId) && canonical(known.get(event.eventId)) !== canonical(event)) fail('同じIDの異なる観測データがあります。上書きしませんでした。')
    if (!known.has(event.eventId)) { merged.push(event); known.set(event.eventId, event) }
  }
  return parseRaceObservations(JSON.stringify({ schemaVersion: 1, kind: 'race-market-observations', observations: merged }), scope)
}

export function settlementFromHjc(purchase, event, refundsChecked = false) {
  if (!refundsChecked) fail('主催者情報で、この購入に取消・返還がないことを確認してください。')
  if (event?.kind !== 'HJC' || event.payload?.status !== 'published') fail('確定払戻を含むHJCが必要です。')
  const payouts = {}
  for (const ticket of purchase.tickets) {
    const available = event.payload.payouts.filter(item => item.type === ticket.type)
    if (!available.length) fail(`${ticket.type}の確定払戻をこのデータで確認できません。手入力してください。`)
    payouts[ticket.key] = available.find(item => item.key === ticket.key)?.per100 ?? 0
  }
  return { payouts, source: { kind: 'HJC', eventId: event.eventId, sourceHash: event.sourceHash ?? null,
    retrievedAt: event.retrievedAt, refundsCheckedAt: new Date().toISOString() } }
}
