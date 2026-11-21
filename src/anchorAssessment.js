import { createOutcomeModel } from './portfolio.js'

const validOdds = value => typeof value === 'number' && Number.isFinite(value) && value >= 1
const validProbability = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
const isValue = row => row.stressReturn != null && row.stressReturn > 1 + 1e-10
export const ANCHOR_METHOD = 'win-value-two-v1'
export const SINGLE_ANCHOR_METHOD = 'place-value-single-v2'

/** Compare two candidates with the full race probability distribution and observed win odds. */
export function assessAnchors({ field = [], odds = {}, oddsFactor = 0.9, selected = null } = {}) {
  const issues = []
  const numbers = field.map(horse => horse.no)
  if (field.length < 2 || field.length > 18 || new Set(numbers).size !== field.length
    || field.some(horse => !Number.isInteger(horse.no) || horse.no < 1 || horse.no > 18 || !validProbability(horse.probability))
    || Math.abs(field.reduce((sum, horse) => sum + horse.probability, 0) - 1) > 1e-6) {
    return { rows: [], suggested: [], anchors: [], complete: false, issues: ['正式な全出走馬の勝率が必要です。'],
      combinedWinProbability: null, equalWinReturn: null, equalStressReturn: null, valueCount: null }
  }
  const factorValid = typeof oddsFactor === 'number' && Number.isFinite(oddsFactor) && oddsFactor >= 0.2 - 1e-12 && oddsFactor <= 1
  if (!factorValid) issues.push('オッズ下落率は0〜80%で入力してください。')
  const rows = field.map(horse => {
    const price = validOdds(odds[horse.no]) ? odds[horse.no] : null
    const stressOdds = price != null && factorValid ? Math.max(1, price * oddsFactor) : null
    return { ...horse, odds: price, breakEvenOdds: 1 / horse.probability,
      expectedReturn: price == null ? null : horse.probability * price,
      stressReturn: stressOdds == null ? null : horse.probability * stressOdds }
  }).sort((a, b) => b.probability - a.probability || a.no - b.no)
  const completePrices = rows.every(row => row.odds != null)
  if (!completePrices) issues.push('同じ時点の全頭の単勝オッズが揃うと、AIの2頭候補と妙味判断を表示します。')
  const complete = completePrices && factorValid
  // Probability is the primary order inside both the value group and the fallback group.
  const suggested = complete ? [...rows.filter(isValue), ...rows.filter(row => !isValue(row))].slice(0, 2).map(row => row.no) : []
  const selection = selected ?? suggested
  const validSelection = Array.isArray(selection) && selection.length === 2 && selection[0] !== selection[1]
    && selection.every(no => numbers.includes(no))
  if (selected != null && !validSelection) issues.push('異なる出走馬を2頭選んでください。')
  const anchors = validSelection ? selection.map(no => rows.find(row => row.no === no)) : []
  return { rows, suggested, anchors, complete: complete && validSelection, issues,
    combinedWinProbability: anchors.length === 2 ? anchors.reduce((sum, row) => sum + row.probability, 0) : null,
    equalWinReturn: complete && validSelection ? (anchors[0].expectedReturn + anchors[1].expectedReturn) / 2 : null,
    equalStressReturn: complete && validSelection ? (anchors[0].stressReturn + anchors[1].stressReturn) / 2 : null,
    valueCount: complete && validSelection ? anchors.filter(isValue).length : null }
}

/** Shortlist at most two qualifying horses, then record one anchor or an explicit skip. */
export function assessAnchorCandidates({ field = [], odds = {}, placeQuotes = [], oddsFactor = 0.9,
  minTop3 = 0.5, releaseFieldSize = field.length, placePositions, selected = null, skip = false } = {}) {
  const base = assessAnchors({ field, odds, oddsFactor })
  const issues = [...base.issues]
  const thresholdValid = typeof minTop3 === 'number' && Number.isFinite(minTop3) && minTop3 >= 0 && minTop3 <= 1
  if (!thresholdValid) issues.push('3着内率の下限は0〜100%で入力してください。')
  const model = base.rows.length ? createOutcomeModel(field, {}, placePositions, { releaseFieldSize }) : null
  if (model?.issues.length) issues.push(...model.issues)
  const top3 = new Map(field.map(horse => [horse.no, 0]))
  for (const outcome of model?.outcomes ?? []) {
    for (const no of outcome.order) top3.set(no, top3.get(no) + outcome.probability)
  }
  const places = placePositions ?? (releaseFieldSize >= 8 ? 3 : 2)
  const quotes = new Map()
  for (const quote of placeQuotes) {
    if (quote?.type !== '複勝' || quote.numbers?.length !== 1 || !top3.has(quote.numbers[0])
      || !validOdds(quote.odds) || quote.upper != null && (!validOdds(quote.upper) || quote.upper < quote.odds)) continue
    if (quotes.has(quote.numbers[0])) {
      issues.push('複勝オッズが重複しているため、候補判定を保留します。')
      continue
    }
    quotes.set(quote.numbers[0], quote)
  }
  const rows = base.rows.map(horse => {
    const placeProbability = model?.probabilities.get(`複勝:${horse.no}`) ?? null
    const placeOdds = placeProbability != null ? quotes.get(horse.no)?.odds ?? null : null
    const placeReturn = placeOdds == null ? null : placeProbability * placeOdds
    const placeStressReturn = placeOdds == null ? null : placeProbability * Math.max(1, placeOdds * oddsFactor)
    const top3Probability = model?.outcomes.length ? Math.min(1, top3.get(horse.no)) : null
    const valueTypes = []
    if (isValue(horse)) valueTypes.push('単勝')
    if (placeStressReturn != null && placeStressReturn > 1 + 1e-10) valueTypes.push('複勝')
    return { ...horse, top3Probability, placeProbability, placePositions: places, placeOdds, placeReturn, placeStressReturn, valueTypes,
      qualifies: top3Probability != null && thresholdValid && top3Probability + 1e-10 >= minTop3 && valueTypes.length > 0 }
  }).sort((a, b) => (b.top3Probability ?? 0) - (a.top3Probability ?? 0) || b.probability - a.probability || a.no - b.no)
  // A missing price or invalid outcome model is a hold, never a confirmed no-candidate decision.
  const complete = base.rows.length > 0 && !issues.length
  const suggested = complete ? rows.filter(row => row.qualifies).slice(0, 2).map(row => row.no) : []
  const anchor = selected != null && suggested.includes(selected) && !skip ? rows.find(row => row.no === selected) : null
  const invalidSelection = suggested.length > 0 && !skip && selected != null && !anchor
  const decision = !complete || invalidSelection ? 'hold' : skip || !suggested.length ? 'skip' : anchor ? 'selected' : 'pending'
  const candidates = new Set(suggested)
  const pair = suggested.length === 2 ? (model?.outcomes ?? []).reduce((sum, outcome) => {
    const hits = outcome.order.filter(no => candidates.has(no)).length
    return { eitherTop3: sum.eitherTop3 + (hits ? outcome.probability : 0),
      bothTop3: sum.bothTop3 + (hits === 2 ? outcome.probability : 0) }
  }, { eitherTop3: 0, bothTop3: 0 }) : null
  return { rows, suggested, anchor, complete, issues, decision, invalidSelection, pair }
}
