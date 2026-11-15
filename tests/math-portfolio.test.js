import test from 'node:test'
import assert from 'node:assert/strict'
import { buildPortfolio, createOutcomeModel, officialFrames, parseQuotes, portfolioMetrics, ticketKey } from '../src/portfolio.js'

const equalField = count => Array.from({ length: count }, (_, i) => ({ no: i + 1, probability: 1 / count }))
const close = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`)

test('all bet types derive coherent probabilities from one exhaustive order distribution', () => {
  const field = equalField(8)
  const { outcomes, probabilities } = createOutcomeModel(field)
  assert.equal(outcomes.length, 8 * 7 * 6)
  close(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0), 1)
  for (const [key, expected] of [
    ['単勝:1', 1 / 8], ['複勝:1', 3 / 8], ['馬連:1-2', 1 / 28], ['馬単:1-2', 1 / 56],
    ['ワイド:1-2', 3 / 28], ['3連複:1-2-3', 1 / 56], ['3連単:1-2-3', 1 / 336],
  ]) close(probabilities.get(key), expected)
  for (const type of ['単勝', '馬連', '馬単', '3連複', '3連単']) {
    close([...probabilities].filter(([key]) => key.startsWith(`${type}:`)).reduce((sum, [, p]) => sum + p, 0), 1)
  }
  close([...probabilities].filter(([key]) => key.startsWith('ワイド:')).reduce((sum, [, p]) => sum + p, 0), 3)
})

test('five to seven runner places use top two; release-time place rule may be explicit', () => {
  close(createOutcomeModel(equalField(7)).probabilities.get('複勝:1'), 2 / 7)
  close(createOutcomeModel(equalField(7), {}, 3).probabilities.get('複勝:1'), 3 / 7)
  close(createOutcomeModel(equalField(7), {}, undefined, { releaseFieldSize: 8 }).probabilities.get('複勝:1'), 3 / 7)
  assert.equal(createOutcomeModel(equalField(4)).probabilities.has('複勝:1'), false)
  assert.equal(createOutcomeModel(equalField(3)).probabilities.has('3連複:1-2-3'), false)
})

test('frame probabilities require official assignments and aggregate two distinct horses', () => {
  const field = equalField(9).map((horse, i) => ({ ...horse, frameNo: i < 7 ? i + 1 : 8 }))
  const frames = officialFrames(field)
  const { probabilities } = createOutcomeModel(field, frames)
  close(probabilities.get('枠連:8-8'), 2 / (9 * 8))
  close([...probabilities].filter(([key]) => key.startsWith('枠連:')).reduce((sum, [, p]) => sum + p, 0), 1)
  assert.deepEqual(officialFrames(equalField(9)), {})
  assert.equal(createOutcomeModel(field).probabilities.has('枠連:8-8'), false)
  const onePerFrame = Object.fromEntries(equalField(8).map(horse => [horse.no, horse.no]))
  assert.equal(createOutcomeModel(equalField(8), onePerFrame).probabilities.has('枠連:1-2'), false)
  assert.equal(createOutcomeModel(equalField(8), onePerFrame, undefined, { releaseFieldSize: 9 }).probabilities.has('枠連:1-2'), true)
})

test('ordered and unordered parsing, ranges and duplicate rejection are exact', () => {
  const field = equalField(9)
  const frames = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 8 }
  const parsed = parseQuotes('複勝 １ ２.０〜３.０\n馬単 2→1 30\n枠連 8-8 20', field, frames)
  assert.deepEqual(parsed.errors, [])
  assert.equal(parsed.quotes[0].odds, 2)
  assert.equal(parsed.quotes[0].upper, 3)
  assert.equal(ticketKey('馬単', parsed.quotes[1].numbers), '馬単:2-1')
  for (const text of ['馬連 1-2 10\n馬連 2-1 11', '単勝 99 10', '枠連 1-1 10', '複勝 1 3-2', '馬連 1-1 10', '馬単 1-2 NaN']) {
    assert.ok(parseQuotes(text, field, frames).errors.length, text)
  }
})

test('a full two-outcome portfolio has joint probability, not summed individual losses', () => {
  const { outcomes } = createOutcomeModel(equalField(2))
  const allocations = [1, 2].map(no => ({ key: `単勝:${no}`, stake: 100, stressOdds: 2.2 }))
  const metrics = portfolioMetrics(allocations, outcomes, 1000)
  close(metrics.hitProbability, 1)
  close(metrics.allMissProbability, 0)
  close(metrics.profitProbability, 1)
  close(metrics.lossProbability, 0)
  close(metrics.expectedProfit, 20)
  close(metrics.scenarioMaxLoss, 0)
  assert.equal(metrics.maxLoss, 200) // Disclosed exposure bound, not simulated worst outcome.
})

test('a hit may still lose money across the complete portfolio', () => {
  const { outcomes } = createOutcomeModel(equalField(2))
  const metrics = portfolioMetrics([
    { key: '単勝:1', stake: 100, stressOdds: 1.5 }, { key: '単勝:2', stake: 100, stressOdds: 3 },
  ], outcomes, 1000)
  close(metrics.hitProbability, 1)
  close(metrics.profitProbability, 0.5)
  close(metrics.lossProbability, 0.5)
  close(metrics.expectedProfit, 25)
})

test('balanced allocation diversifies correlated risk while respecting cap and increments', () => {
  const field = equalField(8)
  const result = buildPortfolio({ field, quotes: field.map(horse => ({ type: '単勝', numbers: [horse.no], odds: 10 })), budget: 10000, oddsFactor: 1 })
  assert.equal(result.issues.length, 0)
  assert.ok(result.allocations.length > 1)
  assert.ok(result.metrics.invested <= 10000)
  for (const ticket of result.allocations) { assert.equal(ticket.stake % 100, 0); assert.ok(ticket.stake <= 5000) }
  close(result.metrics.expectedReturn, 1.25)
  assert.equal(result.search.globalOptimal, false)
  assert.equal(result.coverage.byType['単勝'].priced, 8)
  assert.equal(result.coverage.byType['3連単'].priced, 0)
  assert.equal(result.coverage.byType['3連単'].total, 336)
})

test('anchor and minimum probability filter do not change any race probabilities', () => {
  const field = equalField(8)
  const quotes = field.map(horse => ({ type: '単勝', numbers: [horse.no], odds: 10 }))
  const anchored = buildPortfolio({ field, quotes, budget: 10000, anchor: 2, oddsFactor: 1, profile: 'return' })
  assert.deepEqual(anchored.allocations.map(ticket => ticket.numbers), [[2]])
  close(anchored.evaluated[0].probability, 1 / 8)
  assert.equal(buildPortfolio({ field, quotes, budget: 10000, minHit: 0.2, oddsFactor: 1 }).allocations.length, 0)
  assert.ok(buildPortfolio({ field, quotes, budget: 10000, anchor: 99 }).issues.length)
})

test('no edge, invalid entries and inadequate budgets produce zero stake, not forced spending', () => {
  const field = equalField(8)
  const quotes = [{ type: '単勝', numbers: [1], odds: 5 }]
  const pass = buildPortfolio({ field, quotes, budget: 10000 })
  assert.equal(pass.metrics.invested, 0)
  assert.equal(pass.metrics.unspent, 10000)
  assert.equal(pass.metrics.expectedReturn, null)
  assert.equal(pass.metrics.allMissProbability, null)
  for (const budget of [-1, NaN, 10000001]) assert.ok(buildPortfolio({ field, quotes, budget }).issues.length)
  assert.equal(buildPortfolio({ field, quotes: [{ ...quotes[0], odds: 100 }], budget: 99 }).metrics.invested, 0)
  assert.ok(buildPortfolio({ field, quotes: [quotes[0], quotes[0]], budget: 10000 }).issues.length)
  assert.equal(buildPortfolio({ field, quotes: [quotes[0], quotes[0]], budget: 10000 }).metrics.invested, 0)
  assert.ok(buildPortfolio({ field, quotes: [null], budget: 10000 }).issues.length)
  assert.ok(buildPortfolio({ field, quotes: {}, budget: 10000 }).issues.length)
})

test('an 18-horse field is enumerated without Monte Carlo noise or probability leakage', () => {
  const result = buildPortfolio({ field: equalField(18), quotes: [{ type: '単勝', numbers: [1], odds: 25 }], budget: 10000, oddsFactor: 1 })
  assert.equal(result.search.scenarioCount, 4896)
  close(result.evaluated[0].probability, 1 / 18)
  close(result.evaluated[0].expectedReturn, 25 / 18)
  close(result.metrics.hitProbability + result.metrics.allMissProbability, 1)
})

test('near-certain favourite uses remaining sums without division by a rounded zero', () => {
  const field = [{ no: 1, probability: 1 - 1e-12 }, { no: 2, probability: 5e-13 },
    { no: 3, probability: 3e-13 }, { no: 4, probability: 2e-13 }]
  const { outcomes, probabilities, issues } = createOutcomeModel(field)
  assert.deepEqual(issues, [])
  assert.equal(outcomes.length, 24)
  assert.ok(outcomes.every(outcome => Number.isFinite(outcome.probability) && outcome.probability >= 0))
  close(outcomes.reduce((sum, outcome) => sum + outcome.probability, 0), 1)
  close(probabilities.get('単勝:1'), 1 - 1e-12)
})

test('infinite prices and fractional or nonfinite budget never allocate', () => {
  const field = equalField(8)
  for (const odds of [Infinity, -Infinity, NaN]) {
    const result = buildPortfolio({ field, quotes: [{ type: '単勝', numbers: [1], odds }], budget: 10000 })
    assert.equal(result.allocations.length, 0)
    assert.ok(result.issues.length)
  }
  for (const budget of [Infinity, 100.1]) assert.equal(buildPortfolio({ field, budget }).allocations.length, 0)
})

test('one million yen remains bounded with all 18-horse market quotes', () => {
  const field = equalField(18)
  const frames = Object.fromEntries(field.map(horse => [horse.no, Math.min(8, Math.ceil(horse.no / 2))]))
  const model = createOutcomeModel(field, frames)
  const quotes = [...model.probabilities].map(([key, probability]) => {
    const [type, selection] = key.split(':')
    return { type, numbers: selection.split('-').map(Number), odds: 1.25 / probability }
  })
  const result = buildPortfolio({ field, quotes, frames, budget: 1000001, oddsFactor: 1, profile: 'return' })
  assert.deepEqual(result.issues, [])
  assert.equal(result.coverage.ratio, 1)
  assert.equal(result.metrics.invested, 1000000)
  assert.equal(result.metrics.unspent, 1)
  assert.ok(result.allocations.length <= 8)
  assert.equal(result.search.candidateCount, 32)
  assert.ok(Object.values(result.metrics).every(value => value === null || Number.isFinite(value)))
})
