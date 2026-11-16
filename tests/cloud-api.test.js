import test from 'node:test'
import assert from 'node:assert/strict'
import { createCompanionService, createCompanionHandler, MAX_BODY_BYTES, ApiError } from '../server/companion.js'
import { createSupabaseObjectStore } from '../server/supabaseStore.js'
import { jraSchedule } from '../server/jraCalendar.js'
import { emptyLedger, appendForecast, appendPurchase, appendSettlement, summarizeLedger } from '../src/forecastLedger.js'
import { memoryStore, request } from './fixtures/companion.js'

const ownerId = 'test-owner'
const at = '2026-01-01T06:20:00.000Z'
const scope = { userId: ownerId, raceId: '08260111', raceDate: '20260101' }
const clone = value => JSON.parse(JSON.stringify(value))
const model = () => ({ schemaVersion: 1, modelType: 'idm-temperature', id: 'test-model', temperature: 8, trainedThrough: '2025-01-01', status: 'research', generatedAt: at, validation: {} })
const bundle = () => ({ schemaVersion: 1, kind: 'race-companion-bundle', generatedAt: at, status: { state: 'ready', lastRunAt: at },
  models: { abilityModel: model(), runtimeModel: null }, races: [{ raceId: scope.raceId, raceDate: scope.raceDate,
    race: { id: scope.raceId, raceDate: scope.raceDate, name: 'Synthetic', postTime: '1540', fieldSize: 2 },
    snapshots: [{ schemaVersion: 2, id: 'odds-1', raceId: scope.raceId, raceDate: scope.raceDate, kind: 'observed', time: '15:20',
      observedAt: at, sourcePublishedAt: at, retrievedAt: at, source: 'synthetic', odds: { 1: 3, 2: 4 }, revisionOf: null }],
    observations: [{ eventId: 'live-1', kind: 'LIVE_RACE', retrievedAt: at, sourceHash: 'synthetic',
      payload: { raceId: scope.raceId, raceDate: scope.raceDate, fieldSize: 2, horses: [{ no: 1 }, { no: 2 }] } }],
  }] })
const proposal = () => ({ kind: 'ace', parentId: null, mode: 'replay', cutoffAt: at, modelVersion: 'test-model',
  inputs: { observedAt: at }, parameters: { budget: 1000, profile: 'balanced', minHit: 0, oddsFactor: .9, anchor: null },
  field: [{ no: 1, probability: .5 }, { no: 2, probability: .5 }], allocations: [],
  metrics: { invested: 0, unspent: 1000, expectedPayout: 0, expectedProfit: 0, expectedReturn: null, maxLoss: 0,
    hitProbability: null, profitProbability: null, lossProbability: null, allMissProbability: null } })
const ticket = (no = 1, stake = 100) => ({ key: `単勝:${no}`, type: '単勝', numbers: [no], stake })
function setup() {
  const store = memoryStore(), service = createCompanionService({ store, ownerId, now: () => Date.parse(at) + 1000 })
  const handler = createCompanionHandler({ service, ownerId, companionToken: 'companion-only-secret-for-tests-123456',
    authenticateUser: async token => token === 'owner-token' ? { id: ownerId } : token === 'other-token' ? { id: 'another-user' } : null })
  return { store, service, handler }
}

test('cloud API distinguishes unauthenticated, wrong owner, and collector-only privilege', async () => {
  const { handler, store } = setup()
  assert.equal((await request(handler, { token: null })).status, 401)
  assert.equal((await request(handler, { token: 'other-token' })).status, 403)
  assert.equal((await request(handler, { method: 'POST', body: bundle() })).status, 403)
  assert.equal((await request(handler, { token: 'companion-only-secret-for-tests-123456' })).status, 401)
  assert.equal(store.files.size, 0)
  const response = await request(handler)
  assert.equal(response.status, 200); assert.equal(response.body.status.state, 'not_connected')
  assert.equal(response.headers['Access-Control-Allow-Origin'], undefined)
  assert.match(response.headers['Cache-Control'], /no-store/)
})

test('collector bundle reaches owner GET with availability, models and immutable observations', async () => {
  const { handler, service, store } = setup()
  const sent = await request(handler, { method: 'POST', token: 'companion-only-secret-for-tests-123456', body: bundle() })
  assert.equal(sent.status, 200)
  const fileCount = store.files.size
  assert.equal((await request(handler, { method: 'POST', token: 'companion-only-secret-for-tests-123456', body: bundle() })).status, 200)
  assert.equal(store.files.size, fileCount)
  const meta = await service.get()
  assert.equal(meta.availableRaces[0].id, scope.raceId)
  assert.equal(meta.models.abilityModel.id, 'test-model')
  const response = await request(handler, { query: { raceId: scope.raceId, raceDate: scope.raceDate } })
  assert.equal(response.status, 200); assert.equal(response.body.snapshots.length, 1)
  assert.equal(response.body.observations[0].kind, 'LIVE_RACE'); assert.equal(response.body.ledger.forecasts.length, 0)
  assert.equal(JSON.stringify(response.body).includes('companion-only-secret'), false)
})

test('dashboard returns only owner-scoped evidence for the current JST day', async () => {
  const { service, handler, store } = setup()
  const data = bundle()
  data.status.lastFullSyncAt = at
  data.races[0].race.horses = [{ no: 1 }, { no: 2 }]
  await service.ingestBundle(data)
  const query = { dashboard: '1' }
  assert.equal((await request(handler, { query, token: null })).status, 401)
  assert.equal((await request(handler, { query, token: 'other-token' })).status, 403)
  assert.equal((await request(handler, { query: { ...query, raceDate: scope.raceDate } })).status, 400)
  const before = store.files.size
  const summary = await request(handler, { query })
  assert.equal(summary.status, 200)
  assert.match(summary.headers['Cache-Control'], /private, no-store/)
  assert.deepEqual(summary.body, {
    schemaVersion: 1, date: scope.raceDate, lastMeeting: null, lastDataSentAt: at, schedule: 'scheduled',
    races: [{ id: scope.raceId, raceDate: scope.raceDate, name: 'Synthetic', postTime: '1540', fieldSize: 2,
      oddsRetrievedAt: at, hasForecast: false, receipt: null, review: null }],
  })
  assert.equal(store.files.size, before)
  const saved = appendForecast(emptyLedger(scope), proposal(), at)
  await service.saveLedger(saved.ledger)
  const { races } = await service.getDashboard()
  assert.equal(races[0].hasForecast, true)
  assert.equal(races[0].receipt, null)
})

test('empty dashboard distinguishes the published calendar and the absence of programme data', async () => {
  const atMidnight = Date.parse('2026-11-16T15:00:00.000Z')
  const store = memoryStore()
  for (const schedule of ['no-races', 'scheduled', 'unconfirmed']) {
    const service = createCompanionService({ store, ownerId, now: () => atMidnight, schedule: async day => {
      assert.equal(day, '20261117')
      return schedule
    } })
    const summary = await service.getDashboard()
    assert.equal(summary.date, '20261117')
    assert.equal(summary.schedule, schedule)
    assert.equal(summary.lastDataSentAt, null)
    assert.deepEqual(summary.races, [])
  }
})

test('JRA calendar separates JRA races from local simulcasts and rejects invalid responses', async () => {
  let calls = 0
  const feed = async url => {
    calls++
    assert.equal(url, 'https://www.jra.go.jp/keiba/common/calendar/json/202611.json')
    return Response.json([{ month: '11', data: [
      { date: '15', info: [{ race: [{ name: '5回京都' }] }] },
      { date: '17', info: [{ option: [{ local: true }] }] },
    ] }])
  }
  assert.equal(await jraSchedule('20261115', feed), 'scheduled')
  assert.equal(await jraSchedule('20261117', feed), 'no-races')
  assert.equal(calls, 1)
  assert.equal(await jraSchedule('20261201', async () => Response.json([{ month: '11', data: [] }])), 'unconfirmed')
  assert.equal(await jraSchedule('20270101', async () => new Response('', { status: 404 })), 'unconfirmed')
})

test('worker can pull one owner-bound ledger without broader reads, writes or cross-owner scope', async () => {
  const { service, handler, store } = setup()
  await service.ingestBundle(bundle())
  const base = appendForecast(emptyLedger(scope), proposal(), at)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket()] }, at)
  await service.saveLedger(bought.ledger)
  const size = store.files.size
  const body = { action: 'pull-ledgers', raceId: scope.raceId, raceDate: scope.raceDate }
  const send = extra => request(handler, { method: 'POST', token: 'companion-only-secret-for-tests-123456', body: { ...body, ...extra } })
  const response = await send()
  assert.equal(response.status, 200)
  assert.deepEqual(Object.keys(response.body).sort(), ['conflicts', 'ledger', 'schemaVersion'])
  assert.equal(response.body.ledger.scope.userId, ownerId)
  assert.equal(summarizeLedger(response.body.ledger).invested, 100)
  assert.equal(store.files.size, size)
  assert.equal((await send({ userId: 'another-user' })).status, 400)
  assert.equal((await send({ raceId: '../another-user' })).status, 400)
  assert.equal((await send({ raceDate: '20260230' })).status, 400)
  assert.equal((await request(handler, { method: 'POST', body })).status, 403)
  assert.equal((await request(handler, { method: 'POST', token: 'other-token', body })).status, 403)
  assert.equal((await request(handler, { method: 'POST', token: null, body })).status, 401)
  assert.equal((await request(handler, { method: 'POST', token: 'companion-only-secret-for-tests-123456', body: { action: 'ledger', ledger: bought.ledger } })).status, 400)
  assert.equal((await request(handler, { token: 'companion-only-secret-for-tests-123456', query: { raceId: scope.raceId, raceDate: scope.raceDate } })).status, 401)
  const empty = await send({ raceId: 'another-race' })
  assert.equal(empty.status, 200); assert.equal(empty.body.ledger.forecasts.length, 0)
})

test('owner capture requests are deduplicated, private and acknowledged only by the worker', async () => {
  const { handler, service } = setup()
  const requestBody = { action: 'request-capture', raceId: scope.raceId, raceDate: scope.raceDate }
  const created = await Promise.all(Array.from({ length: 4 }, () => request(handler, { method: 'POST', body: requestBody })))
  assert.ok(created.every(response => response.status === 200))
  assert.equal(new Set(created.map(response => response.body.command.id)).size, 1)
  const command = created[0].body.command
  assert.equal(Date.parse(command.expiresAt) - Date.parse(command.requestedAt), 300_000)
  const worker = body => request(handler, { method: 'POST', token: 'companion-only-secret-for-tests-123456', body })
  const pending = await worker({ action: 'pull-commands' })
  assert.deepEqual(pending.body.commands, [command])
  assert.equal((await service.get()).status.pendingCaptureCount, 1)
  assert.equal((await worker(requestBody)).status, 400)
  assert.equal((await request(handler, { method: 'POST', body: { action: 'pull-commands' } })).status, 403)
  assert.equal((await request(handler, { method: 'POST', token: 'other-token', body: requestBody })).status, 403)
  assert.equal((await request(handler, { method: 'POST', token: null, body: requestBody })).status, 401)
  assert.equal((await request(handler, { method: 'POST', body: { ...requestBody, url: 'https://example.invalid/' } })).status, 400)
  assert.equal((await worker({ action: 'pull-commands', userId: 'another-user' })).status, 400)
  assert.equal((await worker({ action: 'ack-command', id: '../another-user', status: 'completed' })).status, 400)
  assert.equal((await worker({ action: 'ack-command', id: command.id, status: 'completed' })).status, 200)
  assert.equal((await worker({ action: 'ack-command', id: command.id, status: 'completed' })).status, 200)
  assert.equal((await worker({ action: 'ack-command', id: command.id, status: 'failed' })).status, 409)
  assert.equal((await service.get()).status.pendingCaptureCount, 0)
  const next = await request(handler, { method: 'POST', body: requestBody })
  assert.equal(next.status, 200); assert.notEqual(next.body.command.id, command.id)
})

test('capture commands expire after five minutes and recover an interrupted publication', async () => {
  const store = memoryStore(), initial = Date.parse(at)
  let clock = initial
  const service = createCompanionService({ store, ownerId, now: () => clock })
  const original = store.putImmutable
  let fail = true
  store.putImmutable = async (path, value) => {
    if (path.includes('/capture-commands/') && fail) { fail = false; throw new ApiError(503, 'transport', 'Temporary failure') }
    return original(path, value)
  }
  await assert.rejects(service.requestCapture(scope), /Temporary/)
  const first = await service.requestCapture(scope)
  assert.equal((await service.pullCommands()).commands.length, 1)
  clock += 300_000
  assert.equal((await service.pullCommands()).commands.length, 0)
  const next = await service.requestCapture(scope)
  assert.notEqual(next.command.id, first.command.id)
  assert.equal((await service.pullCommands()).commands.length, 1)
})

test('input validation rejects paths, mismatched races, malformed models and secrets before writing', async () => {
  const { service, handler, store } = setup()
  assert.equal((await request(handler, { query: { raceId: '../../other', raceDate: scope.raceDate } })).status, 400)
  assert.equal((await request(handler, { query: { userId: 'another-user' } })).status, 400)
  const malformed = bundle(); malformed.races[0].observations[0].payload.raceId = 'another-race'
  await assert.rejects(service.ingestBundle(malformed), /観測記録/)
  const modelBad = bundle(); modelBad.models.abilityModel.temperature = -1
  await assert.rejects(service.ingestBundle(modelBad), /モデル/)
  const secret = bundle(); secret.races[0].observations[0].payload.source = 'https://jrdb.com/member/?PHPSESSID=secret'
  await assert.rejects(service.ingestBundle(secret), /機密/)
  assert.equal(store.files.size, 0)
})

test('collector ID reuse is rejected atomically and leaves the prior readable race unchanged', async () => {
  const { service } = setup()
  await service.ingestBundle(bundle())
  const wrong = bundle(); wrong.races[0].snapshots[0].odds[1] = 99
  await assert.rejects(service.ingestBundle(wrong), error => error.status === 409)
  const result = await service.get(scope)
  assert.equal(result.snapshots[0].odds[1], 3)
})

test('later heartbeats can resend identical race data without creating duplicate observations or clearing models', async () => {
  const { service } = setup()
  await service.ingestBundle(bundle())
  const heartbeat = bundle(); heartbeat.generatedAt = '2026-01-01T06:20:01.000Z'; heartbeat.models = null
  heartbeat.status = { state: 'waiting', lastRunAt: heartbeat.generatedAt }
  await service.ingestBundle(heartbeat)
  const result = await service.get(scope)
  assert.equal(result.snapshots.length, 1); assert.equal(result.observations.length, 1)
  assert.equal(result.models.abilityModel.id, 'test-model')
})

test('bundle ingestion bounds network concurrency and reuses fully verified races on retry', async () => {
  const store = memoryStore(), original = store.putImmutable, delay = 12
  let active = 0, peak = 0, identityWrites = 0, maxActiveRaces = 0, maxPerRace = 0
  const activeRaces = new Map()
  store.putImmutable = async (path, value) => {
    const raceId = path.match(/\/races\/\d{8}\/([^/]+)\/(?:snapshot-ids|observation-ids)\//)?.[1]
    active++; peak = Math.max(peak, active)
    if (raceId) {
      identityWrites++
      activeRaces.set(raceId, (activeRaces.get(raceId) ?? 0) + 1)
      maxActiveRaces = Math.max(maxActiveRaces, activeRaces.size)
      maxPerRace = Math.max(maxPerRace, activeRaces.get(raceId))
    }
    try { await new Promise(resolve => setTimeout(resolve, delay)); return await original(path, value) }
    finally {
      active--
      if (raceId) { const count = activeRaces.get(raceId) - 1; if (count) activeRaces.set(raceId, count); else activeRaces.delete(raceId) }
    }
  }
  const input = bundle(), template = clone(input.races[0])
  input.races = Array.from({ length: 8 }, (_, index) => {
    const raceId = `race-${index}`, race = clone(template)
    race.raceId = raceId; race.race.id = raceId; race.snapshots[0].raceId = raceId
    race.observations = Array.from({ length: 12 }, (_, i) => ({ ...clone(template.observations[0]), eventId: `live-${i}`, payload: { ...template.observations[0].payload, raceId } }))
    return race
  })
  const service = createCompanionService({ store, ownerId, now: () => Date.parse(at) + 1000 })
  const start = performance.now()
  await service.ingestBundle(input)
  const elapsed = performance.now() - start
  assert.equal(active, 0); assert.equal(maxActiveRaces, 4); assert.equal(maxPerRace, 4)
  assert.ok(peak <= 16 && peak >= 8, `peak=${peak}`)
  assert.ok(elapsed < (8 * 15 + 2) * delay * .65, `parallel ingestion took ${elapsed}ms`)
  const writes = identityWrites
  await service.ingestBundle(input)
  assert.equal(identityWrites, writes, 'fully published immutable races do not redo identity requests')
})

test('parallel ingestion drains in-flight writes before reporting failure and retries the valid partial state', async () => {
  const store = memoryStore(), original = store.putImmutable
  let active = 0, fail = true
  store.putImmutable = async (path, value) => {
    active++
    try {
      await new Promise(resolve => setTimeout(resolve, 5))
      if (path.includes('/observation-ids/') && fail) { fail = false; throw new ApiError(503, 'transport', 'Temporary failure') }
      return await original(path, value)
    } finally { active-- }
  }
  const service = createCompanionService({ store, ownerId, now: () => Date.parse(at) + 1000 })
  await assert.rejects(service.ingestBundle(bundle()), /Temporary/)
  assert.equal(active, 0, 'no write continues after the failed request completes')
  assert.equal((await service.get(scope)).observations.length, 0)
  await service.ingestBundle(bundle())
  assert.equal((await service.get(scope)).observations.length, 1)
})

test('oversized and malformed bodies fail without writing or leaking internal exceptions', async () => {
  const { handler } = setup()
  assert.equal((await request(handler, { method: 'POST', body: '{}', headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })).status, 413)
  assert.equal((await request(handler, { method: 'POST', body: '{bad' })).status, 400)
  assert.equal((await request(handler, { method: 'POST', body: {}, headers: { 'content-type': 'text/plain' } })).status, 415)
  const broken = createCompanionHandler({ service: {}, ownerId, authenticateUser: async () => { throw new Error('SECRET_SENTINEL') } })
  const response = await request(broken)
  assert.equal(response.status, 503); assert.equal(JSON.stringify(response).includes('SECRET_SENTINEL'), false)
})

test('stale concurrent ledger saves retain both independent purchases and round-trip actual accounting', async () => {
  const { service } = setup()
  const base = appendForecast(emptyLedger(scope), proposal(), at)
  await service.saveLedger(base.ledger)
  const a = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket(1, 100)] }, at)
  const b = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket(2, 200)] }, at)
  await Promise.all([service.saveLedger(a.ledger), service.saveLedger(b.ledger)])
  const { ledger } = await service.get(scope)
  assert.equal(ledger.purchases.length, 2); assert.equal(summarizeLedger(ledger).invested, 300)
  const paid = appendSettlement(ledger, { purchaseId: a.record.id, payouts: { '単勝:1': 500 } }, at)
  await service.saveLedger(paid.ledger)
  const returned = await service.get(scope)
  assert.equal(summarizeLedger(returned.ledger).payout, 500)
})

test('atomic correction slots reject simultaneous branches without poisoning accepted ledger', async () => {
  const { service } = setup()
  const base = appendForecast(emptyLedger(scope), proposal(), at)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket()] }, at)
  await service.saveLedger(bought.ledger)
  const correction = stake => appendPurchase(bought.ledger, { forecastId: base.record.id, tickets: [ticket(1, stake)], replacesId: bought.record.id, note: 'Synthetic correction' }, at).ledger
  const results = await Promise.allSettled([service.saveLedger(correction(200)), service.saveLedger(correction(300))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  const rejected = results.find(result => result.status === 'rejected')
  assert.equal(rejected.reason.status, 409)
  const { ledger } = await service.get(scope)
  assert.equal(ledger.purchases.length, 2)
  assert.ok([200, 300].includes(summarizeLedger(ledger).invested))
})

test('same-id mutations, wrong owner and initial settlement races cannot overwrite money', async () => {
  const { service, handler } = setup()
  const base = appendForecast(emptyLedger(scope), proposal(), at)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket()] }, at)
  await service.saveLedger(bought.ledger)
  const bad = clone(bought.ledger); bad.purchases[0].tickets[0].stake = 200
  await assert.rejects(service.saveLedger(bad), error => error.status === 409)
  const wrong = clone(bought.ledger); wrong.scope.userId = 'another-user'
  assert.equal((await request(handler, { method: 'POST', body: { action: 'ledger', ledger: wrong } })).status, 403)
  const initial = per100 => appendSettlement(bought.ledger, { purchaseId: bought.record.id, payouts: { '単勝:1': per100 } }, at).ledger
  const results = await Promise.allSettled([service.saveLedger(initial(200)), service.saveLedger(initial(300))])
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
  assert.equal((await service.get(scope)).ledger.settlements.length, 1)
})

test('retry after partial transport failure preserves valid prefix and completes idempotently', async () => {
  const store = memoryStore(); const original = store.putImmutable
  let failOnce = true
  store.putImmutable = async (path, value) => {
    if (path.includes('/purchases/') && failOnce) { failOnce = false; throw new ApiError(503, 'transport', 'Temporary failure') }
    return original(path, value)
  }
  const service = createCompanionService({ store, ownerId })
  const base = appendForecast(emptyLedger(scope), proposal(), at)
  const bought = appendPurchase(base.ledger, { forecastId: base.record.id, tickets: [ticket()] }, at)
  await assert.rejects(service.saveLedger(bought.ledger), /Temporary/)
  const first = await service.get(scope)
  assert.equal(first.ledger.forecasts.length, 1); assert.equal(first.ledger.purchases.length, 0)
  await service.saveLedger(bought.ledger)
  assert.equal((await service.get(scope)).ledger.purchases.length, 1)
})

test('object store uses create-only writes and recognizes duplicate conflicts without exposing errors', async () => {
  const calls = []
  const object = { example: true }
  const store = createSupabaseObjectStore({ storage: { from: bucket => ({
    upload: async (path, raw, options) => { calls.push({ bucket, path, raw, options }); return { error: { statusCode: '409', message: 'already exists' } } },
    download: async () => ({ data: new Blob([JSON.stringify(object)]) }),
    list: async () => ({ data: [] }),
  }) } })
  assert.deepEqual(await store.putImmutable('owner/v1/item.json', object), { created: false, existing: object })
  assert.equal(calls[0].options.upsert, false); assert.equal(calls[0].bucket, 'race-research')
  await assert.rejects(store.get('../secrets'), /保存先/)
})

test('server attests only matching live forecasts submitted before the official cutoff', async () => {
  const store = memoryStore()
  let clock = Date.parse(at) + 1000
  const service = createCompanionService({ store, ownerId, now: () => clock })
  await service.ingestBundle(bundle())
  const cutoffAt = '2026-01-01T06:30:00.000Z'
  const snapshot = { ...proposal(), mode: 'live', cutoffAt,
    inputs: { observedAt: at, sourcePublishedAt: at, retrievedAt: at, sourceId: 'odds-1',
      winOdds: { 1: 3, 2: 4 }, probabilityStack: '["test-model",null,[],null]', probabilityCalibration: null },
    field: [{ no: 1, probability: .8, pStar: .8 }, { no: 2, probability: .2, pStar: .2 }] }
  const wrong = appendForecast(emptyLedger(scope), { ...snapshot, inputs: { ...snapshot.inputs, winOdds: { 1: 2, 2: 4 } } }, at)
  assert.deepEqual((await service.saveLedger(wrong.ledger)).receipts, {})
  assert.deepEqual((await service.pullForecastRaces()).races, [])
  const valid = appendForecast(wrong.ledger, snapshot, at)
  const saved = await service.saveLedger(valid.ledger)
  assert.equal(saved.receipts[valid.record.id].receivedAt, new Date(clock).toISOString())
  assert.deepEqual((await service.pullForecastRaces()).races, [{ raceId: scope.raceId, raceDate: scope.raceDate }])
  const replay = appendForecast(valid.ledger, snapshot, at)
  clock = Date.parse(cutoffAt) + 1
  const replayed = await service.saveLedger(replay.ledger)
  assert.deepEqual(replayed.receipts, saved.receipts)
  assert.equal(replayed.receipts[replay.record.id], undefined)
  const history = await service.pullLedger(scope)
  assert.equal(history.ledger.forecasts.length, 3)
  assert.deepEqual(history.receipts.map(receipt => receipt.forecastId), [valid.record.id])
  const dashboard = await service.getDashboard()
  assert.deepEqual(dashboard.races[0].receipt, { ownerId, raceId: scope.raceId, raceDate: scope.raceDate,
    forecastId: valid.record.id, receivedAt: saved.receipts[valid.record.id].receivedAt })
})

test('a later report stopping calibration wins over a replayed older companion bundle', async () => {
  const { service, handler } = setup()
  const adopted = { schemaVersion: 1, algorithm: 'win-temperature-v1', id: 'win-temp-1234567890abcdef12345678',
    stack: '["test-model",null,[],null]', temperature: 1.5, decision: 'adopted', createdAt: at, activatedAt: at,
    trainedThrough: '20251101', testedThrough: '20251130' }
  const report = { schemaVersion: 1, generatedAt: at, ownerId, totalForecasts: 0,
    eligibleRaces: 0, active: [adopted], versions: [adopted], statesByStack: [], races: [] }
  const first = { ...bundle(), forecastReview: report }
  await service.ingestBundle(first)
  assert.deepEqual((await service.get()).forecastReview.active, [adopted])
  const stopped = { ...report, generatedAt: '2026-01-01T06:20:00.500Z', active: [] }
  await service.ingestBundle({ ...bundle(), forecastReview: stopped })
  await service.ingestBundle(first)
  assert.equal((await service.get()).forecastReview.active.length, 0)
  await assert.rejects(service.ingestBundle({ ...first, forecastReview: { ...report, ownerId: 'another-user' } }), /振り返り/)
  assert.equal((await request(handler, { token: 'other-token' })).status, 403)
  assert.equal((await request(handler, { method: 'POST', body: { action: 'pull-forecast-races' } })).status, 403)
})
