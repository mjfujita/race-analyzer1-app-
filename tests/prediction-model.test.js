import test from 'node:test'
import assert from 'node:assert/strict'
import { availableAt, buildRaceContext, applyPredictionModels, closingPriceFeatures, validateRuntimeModels } from '../src/predictionModel.js'

const race = { id: 'synthetic', raceDate: '20260101', postTime: '1540', placeCode: '08', surface: '芝' }
const cutoffAt = '2026-01-01T06:30:00.000Z'
const field = [{ no: 1, style: 1, pF: .6, probability: .6 }, { no: 2, style: 4, pF: .4, probability: .4 }]
const snapshot = (minute = 30, odds = { 1: 3, 2: 4 }) => ({ raceId: race.id, raceDate: race.raceDate, kind: 'observed', odds,
  sourcePublishedAt: `2026-01-01T06:${minute}:00.000Z`, observedAt: `2026-01-01T06:${minute}:00.000Z`, retrievedAt: `2026-01-01T06:${minute}:00.000Z` })
const live = (extra = {}) => ({ ...snapshot(25), winOdds: { 1: 3, 2: 4 }, going: '重', weather: '雨',
  paddock: [{ horseNo: 1, paddockIndex: 3 }, { horseNo: 2, paddockIndex: 1 }], ...extra })
const model = () => {
  const common = { status: 'ready', baseModelId: 'synthetic-base', trainedThrough: '2025-01-01', generatedAt: '2025-01-02T00:00:00Z', id: 'synthetic' }
  return { id: 'synthetic-bundle', schemaVersion: 1, kind: 'race-prediction-models', generatedAt: common.generatedAt, baseModel: { id: common.baseModelId },
    contextModel: { ...common, modelType: 'context-logit-v1', features: ['paddock'], coefficients: { paddock: .2 } },
    marketModel: { ...common, modelType: 't10-market-blend-v1', gamma: 1.1, abilityWeight: .5 },
    closingOddsModel: { ...common, modelType: 'closing-logratio-v1', coefficients: [0, 0, .5, 0, 0], residualLower: -.1, residualUpper: .1 } }
}

test('live visibility proves availability without fabricating a source publication time', () => {
  const visible = { retrievedAt: '2026-01-01T06:25:00Z', availabilityAt: '2026-01-01T06:25:00Z', timingEvidence: 'observed-visible-at' }
  assert.equal(availableAt(visible, cutoffAt), true)
  assert.equal(availableAt({ ...visible, availabilityAt: '2026-01-01T06:24:00Z' }, cutoffAt), false)
  assert.equal(availableAt({ ...visible, timingEvidence: 'zip-import' }, cutoffAt), false)
  assert.equal(availableAt({ ...visible, retrievedAt: '2026-01-01T06:31:00Z' }, cutoffAt), false)
})

test('context selection filters cutoff before selecting revisions and rejects unknown/future histories', () => {
  const horses = [1, 2].map(no => ({ no, pastRuns: [
    { date: '20251220', going: '重', weather: '雨', dist: '芝2000m', rank: no, field_size: 5 },
    { date: '202601', going: '重', weather: '雨', dist: '芝2000m', rank: 1, field_size: 5 },
    { date: '20260102', going: '重', weather: '雨', dist: '芝2000m', rank: 1, field_size: 5 },
  ] }))
  const late = live({ ...snapshot(35), going: '良', weather: '晴', paddock: [] })
  const context = buildRaceContext({ race, horses, field, observations: [live(), late], cutoffAt })
  assert.equal(context.evidence.goingAffinity, '重')
  assert.equal(context.features[1].goingAffinity, .5 / 4)
  assert.equal(context.features[2].weatherAffinity, .25 / 4)
  assert.equal(context.features[1].paddock, 1)
  assert.equal(context.features[2].paddock, -1)
  assert.equal(context.features[1].dayBias, null)
})

test('same-day bias deduplicates races and adjusts for prior ability within surface and venue', () => {
  const result = { raceId: 'earlier', raceDate: race.raceDate, placeCode: '08', surface: '芝', winnerNo: 1, field,
    ...Object.fromEntries(Object.entries(snapshot(10)).filter(([key]) => ['retrievedAt', 'sourcePublishedAt', 'observedAt'].includes(key))) }
  const context = buildRaceContext({ race, field, earlierRaces: [result, result, { ...result, raceId: 'dirt', surface: 'ダート' }], cutoffAt })
  // Observed front score 1 - expected (.6*1 + .4*-1) = .8, shrunk by 1+3 races.
  assert.equal(context.evidence.dayBias.races, 1)
  assert.ok(Math.abs(context.features[1].dayBias - .2) < 1e-12)
})

test('context, calibrated market and closing prices remain distinct and sum to one', () => {
  const models = model(), context = buildRaceContext({ race, field, observation: live(), cutoffAt })
  const result = applyPredictionModels({ field, race, odds: { 1: 3, 2: 4 }, history: [snapshot(20, { 1: 4, 2: 3 }), snapshot()],
    context, models, cutoffAt, abilityModelId: 'synthetic-base' })
  assert.deepEqual(result.field.map(h => h.pF), [.6, .4])
  for (const name of ['pContext', 'pM', 'pStar', 'probability']) assert.ok(Math.abs(result.field.reduce((sum, h) => sum + h[name], 0) - 1) < 1e-12)
  assert.ok(result.field[0].pContext > .6)
  assert.equal(result.prices[1].method, 'learned-closing-logratio')
  assert.ok(result.prices[1].median < 3)
  assert.ok(result.prices[1].lower < result.prices[1].median && result.prices[1].upper > result.prices[1].median)
})

test('post-cutoff prices and mismatched base model cannot masquerade as calibrated predictions', () => {
  const models = model()
  const unknown = applyPredictionModels({ field, race, odds: { 1: 1.5, 2: 8 }, history: [snapshot(), snapshot(35, { 1: 1.5, 2: 8 })], models, cutoffAt, abilityModelId: 'synthetic-base' })
  assert.equal(unknown.field[0].pM, null)
  assert.equal(unknown.prices[1].median, null)
  const changed = applyPredictionModels({ field, race, odds: snapshot().odds, history: [snapshot()], models, cutoffAt, abilityModelId: 'other' })
  assert.equal(changed.field[0].pM, null)
  assert.deepEqual(changed.field.map(h => h.probability), [.6, .4])
})

test('insufficient data abstains; invalid coefficients and model dates are rejected', () => {
  const empty = applyPredictionModels({ field, race, cutoffAt })
  assert.deepEqual(empty.field.map(h => h.probability), [.6, .4])
  assert.equal(empty.prices[1].median, null)
  assert.throws(() => validateRuntimeModels({ ...model(), id: undefined }))
  const invalid = model(); invalid.contextModel.coefficients.paddock = Infinity
  assert.throws(() => validateRuntimeModels(invalid))
  const future = model(); future.marketModel.generatedAt = '2026-01-01T06:31:00Z'
  assert.equal(applyPredictionModels({ field, race, models: future, odds: snapshot().odds, history: [snapshot()], abilityModelId: 'synthetic-base' }).field[0].pM, null)
})

test('closing slope uses elapsed minutes and never extrapolates from a later observation', () => {
  const post = '2026-01-01T06:40:00Z'
  const x = closingPriceFeatures(3, 4, '2026-01-01T06:30:00Z', '2026-01-01T06:20:00Z', post)
  assert.ok(Math.abs(x[2] - Math.log(.75)) < 1e-12)
  assert.equal(closingPriceFeatures(3, 4, '2026-01-01T06:35:00Z', '2026-01-01T06:20:00Z', post), null)
  assert.equal(closingPriceFeatures(3, 4, '2026-01-01T06:30:00Z', '2026-01-01T06:31:00Z', post)[4], 0)
})
