import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeMarket, buildAbilityField, isSupportedAbilityModel, normalizedMarketShares } from '../src/marketModel.js'

const close = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)
const horses = [{ no: 1, name: '架空A' }, { no: 2, name: '架空B' }]
const statistics = [{ horse_no: 1, idm: 60 }, { horse_no: 2, idm: 52 }]
const race = { fieldSize: 2, raceDate: '20261115' }

test('IDM baseline is explicit, complete, finite, normalized and translation invariant', () => {
  const a = buildAbilityField({ horses, statistics, race })
  const b = buildAbilityField({ horses, statistics: statistics.map(row => ({ ...row, idm: row.idm + 200 })), race })
  assert.equal(a.complete, true)
  assert.equal(a.model.status, 'uncalibrated')
  close(a.field.reduce((sum, horse) => sum + horse.probability, 0), 1)
  close(a.field[0].probability, 1 / (1 + Math.exp(-1)))
  close(a.field[0].probability, b.field[0].probability)
})

test('missing IDM, duplicate horse and incomplete official fields cannot create forecasts', () => {
  for (const options of [
    { horses, statistics: [], race },
    { horses, statistics, race: { ...race, fieldSize: 3 } },
    { horses: [horses[0], horses[0]], statistics, race },
    { horses, statistics, race: {} },
  ]) {
    const result = buildAbilityField(options)
    assert.equal(result.complete, false)
    assert.equal(result.field.length, 0)
    assert.ok(result.issues.length)
  }
})

test('a complete original field with an explicit withdrawal uses the remaining runners without changing the model',()=>{
  for(const flag of ['cancelled','scratched']){
    const withdrawn={no:3,name:'取消馬',idm:null,[flag]:true}
    const result=buildAbilityField({horses:[...horses,withdrawn],statistics,race:{...race,fieldSize:3}})
    const active=buildAbilityField({horses,statistics,race})
    assert.equal(result.complete,true);assert.deepEqual(result.field,active.field);assert.deepEqual(result.model,active.model)
  }
})

test('withdrawals never hide a missing runner, duplicate original field or conflicting explicit active count',()=>{
  const withdrawn={no:3,name:'取消馬',cancelled:true}
  for(const options of [
    {horses:[...horses,withdrawn],statistics,race:{...race,fieldSize:4}},
    {horses:[...horses,{...withdrawn,no:2}],statistics,race:{...race,fieldSize:3}},
    {horses:[...horses,withdrawn],statistics,race:{...race,fieldSize:3,activeFieldSize:3}},
    {horses:[horses[0],withdrawn],statistics,race:{...race,fieldSize:3}},
  ])assert.equal(buildAbilityField(options).complete,false)
})

test('learned temperature is date gated and never promoted from research by imported labels', () => {
  const model = { schemaVersion: 1, modelType: 'idm-temperature', id: 'fixture', temperature: 4,
    trainedThrough: '2026-11-14', status: 'guaranteed' }
  const accepted = buildAbilityField({ horses, statistics, race, model })
  assert.equal(accepted.model.status, 'research')
  assert.equal(accepted.model.temperature, 4)
  for (const trainedThrough of ['2026-11-15', '2026-11-16', '', '2026-02-31']) {
    const rejected = buildAbilityField({ horses, statistics, race, model: { ...model, trainedThrough } })
    assert.equal(rejected.model.status, 'uncalibrated')
    assert.ok(rejected.issues.length)
  }
})

test('market share and break-even are distinct, even when ability exceeds market share', () => {
  const field = [{ no: 1, probability: 0.12 }, { no: 2, probability: 0.88 }]
  const result = analyzeMarket({ field, odds: { 1: 8, 2: 8 / 9 }, priceFactor: 1 })
  // Odds below 1 are invalid; do not normalize a partial market.
  assert.equal(result.complete, false)
  const full = Array.from({ length: 10 }, (_, i) => ({ no: i + 1, probability: i ? 0.88 / 9 : 0.12 }))
  const market = analyzeMarket({ field: full, odds: Object.fromEntries(full.map(h => [h.no, 8])), priceFactor: 1 })
  const row = market.rows[0]
  close(row.marketShare, 0.1)
  close(row.breakEvenProbability, 0.125)
  close(row.expectedReturn, 0.96)
  assert.equal(row.judgment, '市場より高評価・価格不足')
})

test('log gap decomposition holds and missing baseline is not invented', () => {
  const field = [{ no: 1, probability: 0.4 }, { no: 2, probability: 0.6 }]
  const full = analyzeMarket({ field, odds: { 1: 4, 2: 2 }, baselineOdds: { 1: 3, 2: 3 }, priceFactor: 0.9 })
  close(full.rows[0].gapLog, full.rows[0].abilityBaselineGap + full.rows[0].baselineMarketGap)
  const missing = analyzeMarket({ field, odds: { 1: 4, 2: 2 } })
  assert.equal(missing.rows[0].baselineMarketGap, null)
  assert.equal(missing.rows[0].marketProbability, null)
  assert.equal(normalizedMarketShares(field, { 1: 4 }), null)
})

test('stress changes prices, not probabilities, and never double deducts takeout', () => {
  const field = [{ no: 1, probability: 0.16 }, { no: 2, probability: 0.84 }]
  const { rows } = analyzeMarket({ field, odds: { 1: 8, 2: 1.2 }, priceFactor: 0.875 })
  close(rows[0].expectedReturn, 1.28)
  close(rows[0].stressOdds, 7)
  close(rows[0].stressReturn, 1.12)
  close(rows[0].probability, 0.16)
  assert.equal(analyzeMarket({ field, odds: { 1: 8, 2: 1.2 }, priceFactor: 0 }).complete, false)
})

// Artificial coefficients, not an exported model fitted to private race data.
const conditionModel = {
  schemaVersion: 1, modelType: 'idm-conditions-v1', featureSchema: 'race-ability-last5-v1',
  id: 'synthetic-conditions', temperature: 10, trainedThrough: '2026-11-14', status: 'research',
  coefficients: { distance: 1, venue: 0.5, course: -0.2 },
  featureSpec: { version: 1, priorRate: 0.25, priorStrength: 3, window: 5, distanceTolerance: 200,
    fields: { distance: ['distance_top3', 'distance_runs'], venue: ['venue_top3', 'venue_runs'], course: ['course_top3', 'course_runs'] } },
  selection: { selected: 'challenger', method: 'calibration-only' },
}
const conditionStatistics = [
  { horse_no: 1, idm: 70, distance_runs: 5, distance_top3: 3, venue_runs: 2, venue_top3: 1, course_runs: 0, course_top3: 0 },
  { horse_no: 2, idm: 60, distance_runs: 2, distance_top3: 1, venue_runs: 0, venue_top3: 0, course_runs: 1, course_top3: 1 },
]

test('learned condition formula matches Python training and additive evidence remains exact', () => {
  const result = buildAbilityField({ horses, statistics: conditionStatistics, race, model: conditionModel })
  assert.equal(result.model.modelType, 'idm-conditions-v1')
  assert.equal(result.model.status, 'research')
  close(result.field[0].score, 7 + 0.21875 + 0.05)
  close(result.field[1].score, 6 + 0.1 - 0.0375)
  close(result.field[0].probability, 1 / (1 + Math.exp(6.0625 - 7.26875)))
  close(result.field[0].idmProbability, 1 / (1 + Math.exp(-1)))
  const meanScore = result.field.reduce((sum, horse) => sum + horse.score, 0) / result.field.length
  for (const horse of result.field) {
    assert.equal(horse.contributions.length, 4)
    close(horse.contributions.reduce((sum, term) => sum + term.logit, 0), horse.score)
    close(horse.contributions.reduce((sum, term) => sum + term.centeredLogit, 0), horse.score - meanScore)
  }
  const noCourseHistory = result.field[0].contributions.find(term => term.key === 'course')
  assert.equal(noCourseHistory.raw, 0)
  assert.equal(noCourseHistory.evidence.runs, 0)
})

test('condition features need verified compatible counts for every horse', () => {
  for (const broken of [
    { ...conditionStatistics[1], course_runs: undefined },
    { ...conditionStatistics[1], course_runs: 6 },
    { ...conditionStatistics[1], course_top3: 2 },
  ]) {
    const result = buildAbilityField({ horses, statistics: [conditionStatistics[0], broken], race, model: conditionModel })
    assert.equal(result.complete, true)
    assert.equal(result.model.status, 'uncalibrated')
    assert.ok(result.issues.length)
    assert.ok(result.field.every(horse => horse.contributions.length === 1))
    close(result.field[0].probability, 1 / (1 + Math.exp(-10 / 8)))
  }
})

test('condition feature schemas, date boundaries and discarded coefficients cannot silently alter forecasts', () => {
  assert.equal(isSupportedAbilityModel(conditionModel), true)
  assert.equal(isSupportedAbilityModel({ ...conditionModel, featureSpec: { ...conditionModel.featureSpec, window: 10 } }), false)
  assert.equal(isSupportedAbilityModel({ ...conditionModel, selection: { selected: 'incumbent' } }), false)
  const incumbent = { ...conditionModel, selection: { selected: 'incumbent' }, coefficients: { distance: 0, venue: 0, course: 0 } }
  assert.equal(isSupportedAbilityModel(incumbent), true)
  const result = buildAbilityField({ horses, statistics: conditionStatistics, race, model: incumbent })
  close(result.field[0].probability, result.field[0].idmProbability)
  assert.match(result.model.label, /不採用/)
  const future = buildAbilityField({ horses, statistics: conditionStatistics, race,
    model: { ...conditionModel, trainedThrough: '2026-11-15' } })
  assert.equal(future.model.status, 'uncalibrated')
})
