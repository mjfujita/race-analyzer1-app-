const validOdds = value => typeof value === 'number' && Number.isFinite(value) && value >= 1
const validProbability = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= 1
const isValue = row => row.stressReturn != null && row.stressReturn > 1 + 1e-10
export const ANCHOR_METHOD = 'win-value-two-v1'

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
