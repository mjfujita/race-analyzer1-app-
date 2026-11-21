import test from 'node:test'
import assert from 'node:assert/strict'
import { assessAnchors, assessAnchorCandidates, ANCHOR_METHOD, SINGLE_ANCHOR_METHOD } from '../src/anchorAssessment.js'
import { appendForecast, emptyLedger, appendPurchase, exportLedger, importLedger, summarizeLedger } from '../src/forecastLedger.js'

const field = [.4, .25, .2, .1, .05].map((probability, index) => ({ no: index + 1, name: `架空馬${index + 1}`, probability }))
const odds = { 1: 2, 2: 5, 3: 6, 4: 15, 5: 10 }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12)

test('single-axis shortlist never fills non-value horses and supports no-candidate skips', () => {
  const singleOdds = { 1: 4, 2: 2, 3: 2, 4: 2, 5: 2 }
  const result = assessAnchorCandidates({ field, odds: singleOdds })
  assert.deepEqual(result.suggested, [1])
  assert.equal(result.decision, 'pending')
  assert.equal(assessAnchorCandidates({ field, odds: singleOdds, selected: 1 }).decision, 'selected')
  assert.equal(assessAnchorCandidates({ field, odds: singleOdds, selected: 2 }).decision, 'hold')
  const none = assessAnchorCandidates({ field, odds: singleOdds, oddsFactor: .2, selected: 1 })
  assert.deepEqual(none.suggested, [])
  assert.equal(none.decision, 'skip')
  assert.equal(assessAnchorCandidates({ field, odds: { ...odds, 2: null } }).decision, 'hold')
  assert.equal(assessAnchorCandidates({ field, odds, minTop3: NaN }).decision, 'hold')
})

test('joint top-three probabilities use dependent finishing outcomes', () => {
  const uniform = [1, 2, 3, 4].map(no => ({ no, probability: .25 }))
  const result = assessAnchorCandidates({ field: uniform, odds: { 1: 5, 2: 5, 3: 2, 4: 2 } })
  assert.deepEqual(result.suggested, [1, 2])
  result.rows.forEach(row => close(row.top3Probability, .75))
  close(result.pair.eitherTop3, 1)
  close(result.pair.bothTop3, .5)
  assert.notEqual(result.pair.bothTop3, .75 * .75)
})

test('place-only value uses observed lower prices and the official place payout range', () => {
  const uniform = [1, 2, 3, 4, 5].map(no => ({ no, probability: .2 }))
  const winOdds = Object.fromEntries(uniform.map(h => [h.no, 2]))
  const options = { field: uniform, odds: winOdds, placeQuotes: [{ type: '複勝', numbers: [1], odds: 3, upper: 5 }] }
  const result = assessAnchorCandidates(options)
  assert.deepEqual(result.suggested, [1])
  const horse = result.rows.find(h => h.no === 1)
  close(horse.top3Probability, .6)
  close(horse.placeProbability, .4)
  close(horse.placeReturn, 1.2)
  assert.deepEqual(horse.valueTypes, ['複勝'])
  assert.equal(assessAnchorCandidates({ ...options, placeQuotes: [] }).decision, 'skip')
  assert.equal(assessAnchorCandidates({ ...options, placeQuotes: [{ type: '複勝', numbers: [1], odds: 1.5, upper: 8 }] }).decision, 'skip')
  close(assessAnchorCandidates({ ...options, releaseFieldSize: 8 }).rows.find(h => h.no === 1).placeProbability, .6)
  assert.equal(assessAnchorCandidates({ ...options, placeQuotes: [...options.placeQuotes, ...options.placeQuotes] }).decision, 'hold')
})

test('new frozen decisions preserve one axis, allow manual skips, reject forged candidates and keep old schemas', () => {
  const scope = { userId: 'synthetic-single', raceId: 'TEST11', raceDate: '20261115' }, at = '2026-11-15T06:20:00Z'
  const summary = assessAnchorCandidates({ field, odds })
  const record = { kind: 'ace', parentId: null, mode: 'replay', cutoffAt: at, modelVersion: 'synthetic', field,
    inputs: { observedAt: at, winOdds: odds, quotes: [], releaseFieldSize: 5 },
    parameters: { budget: 0, anchor: null, profile: 'balanced', minHit: 0, oddsFactor: .9,
      anchorSelection: { method: SINGLE_ANCHOR_METHOD, minTop3: .5, suggested: summary.suggested, selected: null, decision: 'pending' } },
    allocations: [], metrics: { invested: 0, unspent: 0, expectedPayout: 0, expectedProfit: 0, maxLoss: 0,
      expectedReturn: null, hitProbability: null, profitProbability: null, lossProbability: null, allMissProbability: null } }
  const base = appendForecast(emptyLedger(scope), record, at)
  for (const [decision, selected] of [['selected', summary.suggested[0]], ['skip', null]]) {
    const saved = appendForecast(base.ledger, { ...record, kind: 'user', parentId: base.record.id,
      parameters: { ...record.parameters, anchorSelection: { ...record.parameters.anchorSelection, decision, selected } } }, at)
    const restored = importLedger(emptyLedger(scope), exportLedger(saved.ledger))
    assert.equal(restored.forecasts[1].parameters.anchorSelection.selected, selected)
    assert.deepEqual(restored.purchases, [])
    assert.equal(summarizeLedger(restored).invested, 0)
  }
  for (const override of [{ suggested: [1, 4] }, { selected: [2, 3], decision: 'selected' },
    { selected: 1, decision: 'selected' }, { selected: summary.suggested[0], decision: 'skip' }]) {
    assert.throws(() => appendForecast(base.ledger, { ...record, kind: 'user', parentId: base.record.id,
      parameters: { ...record.parameters, anchorSelection: { ...record.parameters.anchorSelection, ...override } } }, at))
  }
})

test('two anchors prefer probability within positive stressed returns and combine disjoint win chances', () => {
  const result = assessAnchors({ field, odds })
  assert.deepEqual(result.suggested, [2, 3])
  close(result.combinedWinProbability, .45)
  close(result.equalWinReturn, 1.225)
  close(result.equalStressReturn, 1.1025)
  assert.equal(result.valueCount, 2)
  const manual = assessAnchors({ field, odds, selected: [1, 4] })
  close(manual.combinedWinProbability, .5)
  close(manual.equalWinReturn, 1.15)
  assert.equal(manual.valueCount, 1)
  assert.equal(manual.rows.find(row => row.no === 1).probability, .4)
})

test('no edge, missing prices, duplicate anchors and invalid probabilities do not become positive judgements', () => {
  const noValue = assessAnchors({ field, odds: { 1: 2, 2: 2, 3: 2, 4: 2, 5: 2 } })
  assert.deepEqual(noValue.suggested, [1, 2])
  assert.equal(noValue.valueCount, 0)
  for (const missing of [null, undefined, '5', NaN, Infinity, .5]) {
    const result = assessAnchors({ field, odds: { ...odds, 2: missing } })
    assert.equal(result.complete, false)
    assert.deepEqual(result.suggested, [])
    assert.equal(result.valueCount, null)
  }
  assert.equal(assessAnchors({ field, odds, selected: [1, 1] }).complete, false)
  assert.equal(assessAnchors({ field, odds, selected: [1, 18] }).complete, false)
  assert.equal(assessAnchors({ field: field.slice(1), odds }).complete, false)
  assert.equal(assessAnchors({ field, odds, oddsFactor: 1 - 80 / 100 }).complete, true)
})

test('frozen anchors round-trip independently of allocations and can receive actual purchase records later', () => {
  const scope = { userId: 'synthetic-anchor-user', raceId: 'TEST11', raceDate: '20261115' }
  const at = '2026-11-15T06:20:00Z'
  const record = { kind: 'ace', parentId: null, mode: 'replay', cutoffAt: at, modelVersion: 'synthetic',
    field, inputs: { observedAt: at, winOdds: odds },
    parameters: { budget: 0, anchor: null, profile: 'balanced', minHit: 0, oddsFactor: .9,
      anchorSelection: { method: ANCHOR_METHOD, suggested: [2, 3], selected: [2, 3] } },
    allocations: [], metrics: { invested: 0, unspent: 0, expectedPayout: 0, expectedProfit: 0, maxLoss: 0,
      expectedReturn: null, hitProbability: null, profitProbability: null, lossProbability: null, allMissProbability: null } }
  const saved = appendForecast(emptyLedger(scope), record, at)
  const changed = appendForecast(saved.ledger, { ...record, kind: 'user', parentId: saved.record.id,
    parameters: { ...record.parameters, anchorSelection: { ...record.parameters.anchorSelection, selected: [1, 4] } } }, at)
  const roundTrip = importLedger(emptyLedger(scope), exportLedger(changed.ledger))
  assert.deepEqual(roundTrip.forecasts[0].parameters.anchorSelection.selected, [2, 3])
  assert.deepEqual(roundTrip.forecasts[1].parameters.anchorSelection.selected, [1, 4])
  assert.equal(summarizeLedger(roundTrip).invested, 0)
  const bought = appendPurchase(roundTrip, { forecastId: changed.record.id,
    tickets: [{ key: '馬連:1-4', type: '馬連', numbers: [1, 4], stake: 500 }] }, at)
  assert.equal(summarizeLedger(bought.ledger).invested, 500)
  assert.throws(() => appendForecast(emptyLedger(scope), {
    ...record, parameters: { ...record.parameters, anchorSelection: { method: ANCHOR_METHOD, suggested: [1, 4], selected: [1, 4] } },
  }, at), /一致しません/)
})
