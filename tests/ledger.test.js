import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyLedger, appendForecast, appendPurchase, appendSettlement, exportLedger, importLedger,
  summarizeLedger, readLedger, writeLedger, writeLedgerExclusive, ledgerKey, parsePurchasedTickets, parseRaceObservations,
  mergeRaceObservations, settlementFromHjc } from '../src/forecastLedger.js'

const scope = { userId: 'test-only', raceId: 'race-test', raceDate: '20261115' }
const at = '2026-11-15T06:20:00.000Z'
const ticket = { key: '単勝:1', type: '単勝', numbers: [1], stake: 500 }
const proposal = () => ({ kind: 'ace', parentId: null, mode: 'replay', cutoffAt: at, modelVersion: 'test-unvalidated',
  inputs: { observedAt: at }, parameters: { budget: 1000, profile: 'balanced', minHit: 0, oddsFactor: .9, anchor: null }, field: [{ no: 1, probability: 0.5 }, { no: 2, probability: 0.5 }],
  allocations: [ticket], metrics: { invested: 500, unspent: 500, expectedPayout: 600, expectedProfit: 100, expectedReturn: 1.2,
    maxLoss: 500, hitProbability: .5, profitProbability: .5, lossProbability: .5, allMissProbability: .5 } })
const withForecast = () => appendForecast(emptyLedger(scope), proposal(), at)

test('forecast snapshot remains unchanged when inputs and later user opinions change', () => {
  const input = proposal()
  const base = appendForecast(emptyLedger(scope), input, at)
  input.allocations[0] = { ...ticket, stake: 1000 }
  const user = appendForecast(base.ledger, { ...proposal(), kind: 'user', parentId: base.record.id, note: '軸を変更' }, at)
  assert.equal(base.ledger.forecasts.length, 1)
  assert.equal(user.ledger.forecasts[0].allocations[0].stake, 500)
  assert.equal(user.ledger.forecasts[1].parentId, base.record.id)
})

test('proposal is not assumed purchased; explicit purchase and refund settle separately', () => {
  const base = withForecast()
  assert.equal(summarizeLedger(base.ledger).invested, 0)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket] }, at)
  assert.equal(summarizeLedger(bought.ledger).pendingCount, 1)
  const settled = appendSettlement(bought.ledger, { purchaseId: bought.record.id, payouts: { '単勝:1': 100 } }, at)
  assert.deepEqual(summarizeLedger(settled.ledger), { invested: 500, settledInvested: 500, payout: 500, profit: 0,
    returnRate: 1, purchaseCount: 1, settledCount: 1, pendingCount: 0 })
})

test('corrections append history and recompute effective money without double counting', () => {
  const base = withForecast()
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket] }, at)
  const paid = appendSettlement(bought.ledger, { purchaseId: bought.record.id, payouts: { '単勝:1': 200 } }, at)
  const corrected = appendPurchase(paid.ledger, { forecastId: base.record.id, replacesId: bought.record.id,
    tickets: [{ ...ticket, stake: 300 }], note: '購入額訂正' }, at)
  assert.equal(corrected.ledger.purchases.length, 2)
  assert.equal(summarizeLedger(corrected.ledger).invested, 300)
  assert.equal(summarizeLedger(corrected.ledger).pendingCount, 1)
  const newPaid = appendSettlement(corrected.ledger, { purchaseId: corrected.record.id, payouts: { '単勝:1': 300 } }, at)
  const revisedPaid = appendSettlement(newPaid.ledger, { purchaseId: corrected.record.id, replacesId: newPaid.record.id,
    payouts: { '単勝:1': 400 }, note: '正式払戻訂正' }, at)
  assert.equal(summarizeLedger(revisedPaid.ledger).payout, 1200)
  assert.equal(summarizeLedger(revisedPaid.ledger).profit, 900)
})

test('imports are idempotent and reject scope mismatch or same-id mutations', () => {
  const base = withForecast().ledger
  assert.deepEqual(importLedger(base, exportLedger(base)), base)
  const other = JSON.parse(exportLedger(base)); other.scope.userId = 'another-user'
  assert.throws(() => importLedger(base, JSON.stringify(other)), /ユーザー・レース/)
  const mutated = JSON.parse(exportLedger(base)); mutated.forecasts[0].note = '変更内容'
  assert.throws(() => importLedger(base, JSON.stringify(mutated)), /異なる記録/)
  assert.equal(base.forecasts[0].parameters.budget, 1000)
})

test('corrupt and inaccessible storage are surfaced and not overwritten on read', () => {
  let writes = 0
  const storage = { getItem: () => '{broken', setItem: () => writes++ }
  const result = readLedger(storage, scope)
  assert.match(result.error, /上書きせず保護/)
  assert.equal(writes, 0)
  assert.throws(() => writeLedger({ getItem: () => null, setItem: () => { throw new Error('quota') } }, withForecast().ledger), /quota/)
  assert.notEqual(ledgerKey(scope), ledgerKey({ ...scope, userId: 'other' }))
})

test('bad probabilities, stakes, references and payouts cannot enter the ledger', () => {
  assert.throws(() => appendForecast(emptyLedger(scope), { ...proposal(), field: [{ no: 1, probability: .9 }, { no: 2, probability: .9 }] }, at), /合計/)
  const base = withForecast()
  assert.throws(() => appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [{ ...ticket, stake: 55 }] }, at), /100円/)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket] }, at)
  assert.throws(() => appendSettlement(bought.ledger, { purchaseId: bought.record.id, payouts: {} }, at), /全購入/)
  assert.throws(() => appendPurchase(base.ledger, { forecastId: 'missing', tickets: [] }, at), /参照/)
  assert.throws(() => importLedger(base.ledger, '{"schemaVersion":1,"__proto__":{}}'), /許可/)
})

test('actual purchase parser preserves order, canonicalizes unordered tickets and supports explicit no purchase', () => {
  const field = [{ no: 1 }, { no: 2 }, { no: 3 }]
  assert.equal(parsePurchasedTickets('馬単 2-1 200', field)[0].key, '馬単:2-1')
  assert.equal(parsePurchasedTickets('馬連 2-1 200', field)[0].key, '馬連:1-2')
  assert.deepEqual(parsePurchasedTickets('', field), [])
  assert.throws(() => parsePurchasedTickets('単勝 4 100', field), /出走しない/)
  assert.throws(() => parsePurchasedTickets('馬連 1-2 100\n馬連 2-1 100', field), /重複/)
})

test('live labels require source, retrieval and freeze timestamps before the decision cutoff', () => {
  const input = { ...proposal(), mode: 'live' }
  assert.throws(() => appendForecast(emptyLedger(scope), input, at), /時刻証跡/)
  input.inputs = { sourcePublishedAt: at, observedAt: at, retrievedAt: at }
  assert.equal(appendForecast(emptyLedger(scope), input, at).record.mode, 'live')
  assert.throws(() => appendForecast(emptyLedger(scope), input, '2026-11-15T06:30:00.000Z'), /時刻証跡/)
})

test('no-bet forecast can be frozen, exported, recorded as not purchased, and settled at zero', () => {
  const input = { ...proposal(), allocations: [], metrics: { invested: 0, unspent: 1000, expectedPayout: 0,
    expectedProfit: 0, expectedReturn: null, maxLoss: 0, hitProbability: 0, profitProbability: 0,
    lossProbability: 0, allMissProbability: null } }
  const base = appendForecast(emptyLedger(scope), input, at)
  assert.deepEqual(importLedger(base.ledger, exportLedger(base.ledger)), base.ledger)
  const skipped = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [] }, at)
  const settled = appendSettlement(skipped.ledger, { purchaseId: skipped.record.id, payouts: {} }, at)
  const result = summarizeLedger(settled.ledger)
  assert.equal(result.invested, 0)
  assert.equal(result.profit, 0)
  assert.equal(result.returnRate, null)
  assert.equal(result.pendingCount, 0)
})

test('race data import isolates race, preserves revisions and requires refund check before HJC settlement', () => {
  const event = { eventId: 'hjc-test', kind: 'HJC', retrievedAt: at, sourceHash: 'synthetic-hash', payload: {
    raceId: scope.raceId, raceDate: scope.raceDate, status: 'published', refunds: null,
    payouts: [{ key: '単勝:1', type: '単勝', numbers: [1], per100: 250 }] } }
  const other = { ...event, eventId: 'other-race', payload: { ...event.payload, raceId: 'other' } }
  const raw = JSON.stringify({ schemaVersion: 1, kind: 'race-market-observations', observations: [event, other] })
  const parsed = parseRaceObservations(raw, scope)
  assert.equal(parsed.observations.length, 1)
  assert.equal(mergeRaceObservations(parsed, parsed, scope).observations.length, 1)
  const purchase = { tickets: [ticket, { key: '単勝:2', type: '単勝', numbers: [2], stake: 100 }] }
  assert.throws(() => settlementFromHjc(purchase, event), /取消・返還/)
  assert.deepEqual(settlementFromHjc(purchase, event, true).payouts, { '単勝:1': 250, '単勝:2': 0 })
  assert.throws(() => settlementFromHjc({ tickets: [{ type: '複勝', key: '複勝:1' }] }, event, true), /確認できません/)
  assert.throws(() => parseRaceObservations(raw, { ...scope, raceId: 'missing' }), /含まれていません/)
})

function memoryStorage() {
  const data = new Map()
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
}

test('stale tabs merge independent additions and return the actual persisted ledger', () => {
  const storage = memoryStorage()
  const base = withForecast()
  writeLedger(storage, base.ledger)
  const tabA = appendForecast(base.ledger, { ...proposal(), note: 'tab A' }, at)
  const tabB = appendForecast(base.ledger, { ...proposal(), note: 'tab B' }, at)
  writeLedger(storage, tabA.ledger)
  const saved = writeLedger(storage, tabB.ledger)
  assert.equal(saved.forecasts.length, 3)
  assert.deepEqual(saved, readLedger(storage, scope).ledger)
  assert.equal(writeLedger(storage, base.ledger).forecasts.length, 3)
  const mutated = JSON.parse(exportLedger(base.ledger)); mutated.forecasts[0].note = 'mutated original'
  assert.throws(() => writeLedger(storage, mutated), /異なる記録/)
  assert.deepEqual(readLedger(storage, scope).ledger, saved)
})

test('stale purchase and settlement corrections cannot branch or overwrite confirmed money', () => {
  const storage = memoryStorage()
  const base = withForecast()
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket] }, at)
  writeLedger(storage, bought.ledger)
  const a = appendPurchase(bought.ledger, { forecastId: base.record.id, tickets: [{ ...ticket, stake: 300 }], replacesId: bought.record.id, note: 'A' }, at)
  const b = appendPurchase(bought.ledger, { forecastId: base.record.id, tickets: [{ ...ticket, stake: 700 }], replacesId: bought.record.id, note: 'B' }, at)
  const saved = writeLedger(storage, a.ledger)
  assert.throws(() => writeLedger(storage, b.ledger), /購入訂正/)
  assert.equal(summarizeLedger(readLedger(storage, scope).ledger).invested, 300)
  const paid = appendSettlement(saved, { purchaseId: a.record.id, payouts: { '単勝:1': 200 } }, at)
  writeLedger(storage, paid.ledger)
  const payA = appendSettlement(paid.ledger, { purchaseId: a.record.id, payouts: { '単勝:1': 300 }, replacesId: paid.record.id, note: 'A' }, at)
  const payB = appendSettlement(paid.ledger, { purchaseId: a.record.id, payouts: { '単勝:1': 400 }, replacesId: paid.record.id, note: 'B' }, at)
  const final = writeLedger(storage, payA.ledger)
  assert.throws(() => writeLedger(storage, payB.ledger), /払戻訂正/)
  assert.deepEqual(readLedger(storage, scope).ledger, final)
  assert.equal(summarizeLedger(final).payout, 900)
})

test('writing protects unreadable persisted state and never replaces it with empty state', () => {
  const storage = memoryStorage()
  storage.setItem(ledgerKey(scope), '{broken')
  assert.throws(() => writeLedger(storage, withForecast().ledger))
  assert.equal(storage.getItem(ledgerKey(scope)), '{broken')
})

test('exclusive save uses a shared lock and merges simultaneous tab requests', async () => {
  const storage = memoryStorage()
  let queue = Promise.resolve(), active = 0, maximum = 0
  const names = []
  const locks = { request(name, options, callback) {
    names.push(name); assert.equal(options.mode, 'exclusive')
    const task = queue.then(async () => { active++; maximum = Math.max(maximum, active); await Promise.resolve(); try { return callback() } finally { active-- } })
    queue = task.catch(() => {})
    return task
  } }
  const a = withForecast().ledger, b = withForecast().ledger
  const [, last] = await Promise.all([writeLedgerExclusive(storage, a, locks), writeLedgerExclusive(storage, b, locks)])
  assert.equal(maximum, 1)
  assert.equal(names[0], names[1])
  assert.equal(last.forecasts.length, 2)
  assert.equal(readLedger(storage, scope).ledger.forecasts.length, 2)
  await assert.rejects(writeLedgerExclusive(storage, a, {}), /同時保存を保護できません/)
})

test('frame tickets require every official frame, existing frames and two runners for same-frame selection', () => {
  const fields = [{ no: 1, frameNo: 1 }, { no: 2, frameNo: 2 }]
  assert.throws(() => parsePurchasedTickets('枠連 8-8 100', fields), /出走馬のいない枠/)
  assert.throws(() => parsePurchasedTickets('枠連 1-1 100', fields), /2頭以上/)
  assert.throws(() => parsePurchasedTickets('枠連 1-2 100', [{ no: 1, frameNo: 1 }, { no: 2 }]), /正式な枠番号/)
  assert.equal(parsePurchasedTickets('枠連 2-1 100', fields)[0].key, '枠連:1-2')
  assert.equal(parsePurchasedTickets('枠連 1-1 100', [{ no: 1, frameNo: 1 }, { no: 2, frameNo: 1 }])[0].key, '枠連:1-1')
  const invalidFrame = { key: '枠連:8-8', type: '枠連', numbers: [8, 8], stake: 500 }
  const input = { ...proposal(), field: proposal().field.map((horse, index) => ({ ...horse, frameNo: index + 1 })) }
  assert.throws(() => appendForecast(emptyLedger(scope), { ...input, allocations: [invalidFrame] }, at), /出走馬のいない枠/)
  const base = appendForecast(emptyLedger(scope), input, at)
  assert.throws(() => appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [invalidFrame] }, at), /出走馬のいない枠/)
  const unknown = withForecast()
  assert.throws(() => appendPurchase(unknown.ledger, { forecastId: unknown.record.id, tickets: [{ ...invalidFrame, key: '枠連:1-2', numbers: [1, 2] }] }, at), /正式な枠番号/)
})
