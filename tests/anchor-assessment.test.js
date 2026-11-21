import test from 'node:test'
import assert from 'node:assert/strict'
import { assessAnchors, ANCHOR_METHOD } from '../src/anchorAssessment.js'
import { appendForecast, emptyLedger, appendPurchase, exportLedger, importLedger, summarizeLedger } from '../src/forecastLedger.js'

const field = [.4, .25, .2, .1, .05].map((probability, index) => ({ no: index + 1, name: `架空馬${index + 1}`, probability }))
const odds = { 1: 2, 2: 5, 3: 6, 4: 15, 5: 10 }
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-12)

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
