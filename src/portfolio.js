// Shared exhaustive top-three outcomes keep probabilities across bet types coherent.
// The model assumes no dead heat; settlement uses official payouts separately.
/**
 * @typedef {import('./marketModel.js').ProbabilityHorse} ProbabilityHorse
 * @typedef {{type:string,numbers:number[],odds:number,upper?:number}} Quote
 * @typedef {Record<string,number>|Map<number,number>} FrameMap
 * @typedef {{field?:ProbabilityHorse[],quotes?:Quote[],tickets?:Quote[],budget?:number|string,
 * frames?:FrameMap,anchor?:number|string|null,minHit?:number|string,oddsFactor?:number|string,
 * profile?:'cautious'|'balanced'|'return',maxTickets?:number,placePositions?:number,
 * releaseFieldSize?:number,frameBettingAvailable?:boolean}} PortfolioConfig
 * @typedef {{invested:number,unspent:number,expectedPayout:number,expectedProfit:number,
 * expectedReturn:number|null,hitProbability:number,profitProbability:number,lossProbability:number,
 * allMissProbability:number|null,maxLoss:number,scenarioMaxLoss:number,standardDeviation:number}} PortfolioMetrics
 */
export const BET_TYPES = Object.freeze({ 単勝: 1, 複勝: 1, 枠連: 2, 馬連: 2, 馬単: 2, ワイド: 2, '3連複': 3, '3連単': 3 })
export const RISK_PROFILES = Object.freeze({
  cautious: { label: '損失変動を抑える', riskPenalty: 2, maxTicketFraction: 0.35 },
  balanced: { label: '回収と損失変動を比較', riskPenalty: 0.5, maxTicketFraction: 0.5 },
  return: { label: '期待利益を優先', riskPenalty: 0, maxTicketFraction: 1 },
})
const ORDERED = new Set(['馬単', '3連単'])
const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const asFrames = frames => frames instanceof Map ? Object.fromEntries(frames) : frames ?? {}
const clampProbability = p => Math.min(1, Math.max(0, p))

/** @param {string} type @param {number[]} numbers */
export function ticketKey(type, numbers) {
  return `${type}:${(ORDERED.has(type) ? [...numbers] : [...numbers].sort((a, b) => a - b)).join('-')}`
}

/** @param {ProbabilityHorse[]} field */
export function officialFrames(field) {
  const frames = {}
  for (const horse of field) {
    const frame = Number(horse.frameNo ?? horse.frame_no ?? horse.stat?.frame_no)
    if (!Number.isInteger(frame) || frame < 1 || frame > 8) return {}
    frames[horse.no] = frame
  }
  return frames
}

function validFrames(field, supplied) {
  const frames = asFrames(supplied)
  return field.every(horse => Number.isInteger(Number(frames[horse.no])) && Number(frames[horse.no]) >= 1 && Number(frames[horse.no]) <= 8)
    ? Object.fromEntries(field.map(horse => [horse.no, Number(frames[horse.no])])) : {}
}

/** @param {string} text @param {ProbabilityHorse[]|number[]} field @param {FrameMap} suppliedFrames */
export function parseQuotes(text, field, suppliedFrames = {}) {
  const fieldNumbers = new Set(field.map(horse => Number(horse.no ?? horse)))
  const frames = asFrames(suppliedFrames)
  const frameCounts = Object.values(frames).reduce((counts, frame) => ({ ...counts, [frame]: (counts[frame] ?? 0) + 1 }), {})
  const quotes = []
  const errors = []
  const seen = new Set()
  for (const [index, raw] of String(text ?? '').split(/\r?\n/).entries()) {
    if (!raw.trim()) continue
    const [type, selection, price, ...extra] = raw.normalize('NFKC').trim().split(/\s+/)
    if (extra.length || !Object.hasOwn(BET_TYPES, type) || !/^\d+(?:[-−－→]\d+)*$/.test(selection ?? '')
      || !/^\d+(?:\.\d+)?(?:[-−－~〜～]\d+(?:\.\d+)?)?$/.test(price ?? '')) {
      errors.push(`${index + 1}行目：券種・馬番・倍率を確認してください。`)
      continue
    }
    const numbers = selection.split(/[-−－→]/).map(Number)
    const [odds, upper = odds] = price.split(/[-−－~〜～]/).map(Number)
    const allowed = type === '枠連' ? new Set(Object.values(frames).map(Number)) : fieldNumbers
    const duplicate = new Set(numbers).size !== numbers.length
    if (numbers.length !== BET_TYPES[type] || numbers.some(no => !allowed.has(no)) || !Number.isFinite(odds)
      || !Number.isFinite(upper) || odds < 1 || upper < odds
      || (duplicate && (type !== '枠連' || (frameCounts[numbers[0]] ?? 0) < 2))) {
      errors.push(`${index + 1}行目：馬番・枠番・倍率の範囲が不正です。`)
      continue
    }
    const key = ticketKey(type, numbers)
    if (seen.has(key)) { errors.push(`${index + 1}行目：買い目が重複しています。`); continue }
    seen.add(key)
    quotes.push({ type, numbers: ORDERED.has(type) ? numbers : numbers.sort((a, b) => a - b), odds, upper })
  }
  return { quotes, errors }
}

function keysForOutcome(order, count, frames, placePositions) {
  const keys = [ticketKey('単勝', [order[0]])]
  if (count >= 5) for (const no of order.slice(0, placePositions)) keys.push(ticketKey('複勝', [no]))
  if (count >= 3) keys.push(ticketKey('馬連', order.slice(0, 2)), ticketKey('馬単', order.slice(0, 2)))
  if (Object.keys(frames).length) keys.push(ticketKey('枠連', order.slice(0, 2).map(no => frames[no])))
  if (count >= 4) {
    keys.push(ticketKey('3連複', order), ticketKey('3連単', order))
    for (const [a, b] of [[0, 1], [0, 2], [1, 2]]) keys.push(ticketKey('ワイド', [order[a], order[b]]))
  }
  return keys
}

/**
 * @param {ProbabilityHorse[]} field
 * @param {FrameMap} suppliedFrames
 * @param {number|undefined} placePositions
 * @param {{releaseFieldSize?:number,frameBettingAvailable?:boolean}} options
 */
export function createOutcomeModel(field, suppliedFrames = {}, placePositions,
  { releaseFieldSize = field.length, frameBettingAvailable } = {}) {
  const places = placePositions ?? (releaseFieldSize >= 8 ? 3 : 2)
  if (field.length < 2 || field.length > 18 || new Set(field.map(horse => Number(horse.no))).size !== field.length
    || field.some(horse => !finite(horse.probability) || Number(horse.probability) <= 0)
    || ![2, 3].includes(places) || !Number.isInteger(Number(releaseFieldSize))
    || Number(releaseFieldSize) < field.length || Number(releaseFieldSize) > 18) {
    return { outcomes: [], probabilities: new Map(), frames: {}, issues: ['着順確率または発売開始時の頭数が不正です。'] }
  }
  const total = field.reduce((sum, horse) => sum + Number(horse.probability), 0)
  if (Math.abs(total - 1) > 1e-7) return { outcomes: [], probabilities: new Map(), frames: {}, issues: ['全頭の勝率合計が1ではありません。'] }
  const supplied = validFrames(field, suppliedFrames)
  const frameSale = frameBettingAvailable ?? (releaseFieldSize >= 9 || new Set(Object.values(supplied)).size < Object.keys(supplied).length)
  const frames = frameSale ? supplied : {}
  const outcomes = []
  const maxLength = Math.min(3, field.length)
  function walk(order, remaining, probability) {
    if (order.length === maxLength) {
      outcomes.push({ order, probability, keys: keysForOutcome(order, Number(releaseFieldSize), frames, places) })
      return
    }
    const denominator = remaining.reduce((sum, horse) => sum + Number(horse.probability), 0)
    for (const horse of remaining) walk([...order, Number(horse.no)], remaining.filter(candidate => candidate !== horse), probability * horse.probability / denominator)
  }
  walk([], field, 1)
  const outcomeTotal = outcomes.reduce((sum, outcome) => sum + outcome.probability, 0)
  const probabilities = new Map()
  for (const outcome of outcomes) {
    outcome.probability /= outcomeTotal
    for (const key of outcome.keys) probabilities.set(key, (probabilities.get(key) ?? 0) + outcome.probability)
  }
  return { outcomes, probabilities, frames, issues: [] }
}

/** @param {number|string} budget @returns {PortfolioMetrics} */
function emptyMetrics(budget) {
  return { invested: 0, unspent: Math.max(0, Number(budget) || 0), expectedPayout: 0, expectedProfit: 0,
    expectedReturn: null, hitProbability: 0, profitProbability: 0, lossProbability: 0, allMissProbability: null,
    maxLoss: 0, scenarioMaxLoss: 0, standardDeviation: 0 }
}

export function portfolioMetrics(allocations, outcomes, budget) {
  const metrics = emptyMetrics(budget)
  const positive = allocations.filter(ticket => ticket.stake > 0)
  metrics.invested = positive.reduce((sum, ticket) => sum + ticket.stake, 0)
  metrics.unspent = Number(budget) - metrics.invested
  if (!metrics.invested) return metrics
  let squared = 0
  let miss = 0
  for (const outcome of outcomes) {
    const winners = new Set(outcome.keys)
    const payout = positive.reduce((sum, ticket) => sum + (winners.has(ticket.key) ? ticket.stake * ticket.stressOdds : 0), 0)
    const profit = payout - metrics.invested
    metrics.expectedPayout += outcome.probability * payout
    squared += outcome.probability * profit * profit
    if (payout > 0) metrics.hitProbability += outcome.probability
    else miss += outcome.probability
    if (profit > 1e-7) metrics.profitProbability += outcome.probability
    if (profit < -1e-7) metrics.lossProbability += outcome.probability
    metrics.scenarioMaxLoss = Math.max(metrics.scenarioMaxLoss, -profit)
  }
  metrics.expectedProfit = metrics.expectedPayout - metrics.invested
  metrics.expectedReturn = metrics.expectedPayout / metrics.invested
  metrics.standardDeviation = Math.sqrt(Math.max(0, squared - metrics.expectedProfit ** 2))
  metrics.hitProbability = clampProbability(metrics.hitProbability)
  metrics.profitProbability = clampProbability(metrics.profitProbability)
  metrics.lossProbability = clampProbability(metrics.lossProbability)
  metrics.allMissProbability = clampProbability(miss)
  // Always disclose the full stake at risk. The model omits special outcomes and variable payouts.
  metrics.maxLoss = metrics.invested
  return metrics
}

function coverageFor(probabilities, evaluated) {
  const byType = Object.fromEntries(Object.keys(BET_TYPES).map(type => [type, { priced: 0, total: 0, eligible: false }]))
  for (const key of probabilities.keys()) { const row = byType[key.split(':')[0]]; row.total++; row.eligible = true }
  for (const quote of evaluated) byType[quote.type].priced++
  const total = Object.values(byType).reduce((sum, row) => sum + row.total, 0)
  const priced = evaluated.length
  return { byType, total, priced, unpriced: total - priced, ratio: total ? priced / total : 0 }
}

/**
 * 100-yen greedy coordinate allocation; a reproducible policy, not a global optimum.
 * @param {PortfolioConfig} options
 */
export function buildPortfolio({ field = [], quotes, tickets, budget = 0, frames = {}, anchor = null,
  minHit = 0, oddsFactor = 0.9, profile = 'balanced', maxTickets = 8, placePositions,
  releaseFieldSize = field.length, frameBettingAvailable } = {}) {
  const model = createOutcomeModel(field, frames, placePositions, { releaseFieldSize, frameBettingAvailable })
  const issues = [...model.issues]
  const validBudget = Number.isSafeInteger(Number(budget)) && Number(budget) >= 0 && Number(budget) <= 10000000
  const factorValid = finite(oddsFactor) && Number(oddsFactor) > 0 && Number(oddsFactor) <= 1
  const hitValid = finite(minHit) && Number(minHit) >= 0 && Number(minHit) <= 1
  if (!validBudget) issues.push('予算は0〜1,000万円の整数で指定してください。')
  if (!factorValid) issues.push('オッズ評価倍率は0より大きく1以下にしてください。')
  if (!hitValid) issues.push('最低的中率は0〜100%にしてください。')
  const anchorNo = anchor === null || anchor === '' ? null : Number(anchor)
  if (anchorNo !== null && !field.some(horse => Number(horse.no) === anchorNo)) issues.push('選択した軸馬が出走馬にありません。')
  const supplied = quotes ?? tickets ?? []
  if (!Array.isArray(supplied)) issues.push('オッズ一覧の形式が不正です。')
  const seen = new Set()
  const evaluated = []
  for (const ticket of Array.isArray(supplied) ? supplied : []) {
    if (!ticket || !Object.hasOwn(BET_TYPES, ticket.type) || !Array.isArray(ticket.numbers)
      || ticket.numbers.length !== BET_TYPES[ticket.type] || !finite(ticket.odds) || Number(ticket.odds) < 1
      || (ticket.upper !== undefined && (!finite(ticket.upper) || Number(ticket.upper) < Number(ticket.odds)))) {
      issues.push('形式が不正なオッズがあるため配分を停止しました。'); continue
    }
    const numbers = ticket.numbers.map(Number)
    const key = ticketKey(ticket.type, numbers)
    const probability = model.probabilities.get(key)
    if (probability === undefined) { issues.push(`${key}は出走馬・正式な枠・発売条件を確認できません。`); continue }
    if (seen.has(key)) { issues.push(`${key}の価格が重複しています。`); continue }
    seen.add(key)
    const stressOdds = factorValid ? Math.max(1, Number(ticket.odds) * Number(oddsFactor)) : null
    const expectedReturn = stressOdds === null ? null : probability * stressOdds
    const includesAnchor = anchorNo === null || numbers.includes(ticket.type === '枠連' ? model.frames[anchorNo] : anchorNo)
    const reasons = []
    if (!includesAnchor) reasons.push('選択した軸を含まない')
    if (expectedReturn === null || expectedReturn <= 1 + 1e-10) reasons.push('価格ストレス後の試算回収率が100%以下')
    if (probability < Number(minHit)) reasons.push('最低的中率に届かない')
    evaluated.push({ ...ticket, numbers, odds: Number(ticket.odds), key,
      pair: numbers.join(ORDERED.has(ticket.type) ? '→' : '−'),
      probability: clampProbability(probability), stressOdds, expectedReturn,
      observedReturn: probability * Number(ticket.odds), breakEvenOdds: 1 / probability,
      qualifies: reasons.length === 0, reasons, reason: reasons.length ? reasons.join('・') : '価格ストレス後も試算回収率100%超' })
  }
  evaluated.sort((a, b) => (b.expectedReturn ?? -Infinity) - (a.expectedReturn ?? -Infinity) || b.probability - a.probability || a.key.localeCompare(b.key))
  const coverage = coverageFor(model.probabilities, evaluated)
  const method = '全着順上位3頭を列挙し共同損益を評価。試算回収率上位32候補を100円刻みで逐次配分する比較方針で、全候補の大域最適を保証しません。'
  const search = { scenarioCount: model.outcomes.length, candidateCount: 0, candidateLimit: 32, globalOptimal: false }
  if (issues.length || !validBudget || !model.outcomes.length || !factorValid || !hitValid) {
    return { evaluated, allocations: [], metrics: emptyMetrics(validBudget ? budget : 0), coverage, issues, method, search }
  }
  const candidates = evaluated.filter(ticket => ticket.qualifies).slice(0, 32)
  search.candidateCount = candidates.length
  if (!candidates.length || Number(budget) < 100) return { evaluated, allocations: [], metrics: emptyMetrics(budget), coverage, issues, method, search }
  const policy = RISK_PROFILES[profile] ?? RISK_PROFILES.balanced
  const candidateIndex = new Map(candidates.map((ticket, index) => [ticket.key, index]))
  const count = candidates.length
  const covariances = Array.from({ length: count }, () => new Float64Array(count))
  for (const outcome of model.outcomes) {
    const winners = outcome.keys.flatMap(key => candidateIndex.has(key) ? [candidateIndex.get(key)] : [])
    for (const a of winners) for (const b of winners) covariances[a][b] += outcome.probability * candidates[a].stressOdds * candidates[b].stressOdds
  }
  for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) {
    covariances[a][b] -= candidates[a].expectedReturn * candidates[b].expectedReturn
  }
  const stakes = new Float64Array(count)
  const covarianceWithPosition = new Float64Array(count)
  const ticketCap = Math.floor(Number(budget) * policy.maxTicketFraction / 100) * 100
  const pointLimit = Number.isInteger(Number(maxTickets)) ? Math.min(32, Math.max(1, Number(maxTickets))) : 8
  let points = 0
  let invested = 0
  // Utility = E[profit] - lambda Var(profit)/(2*budget); profile is an explicit policy.
  while (invested + 100 <= Number(budget)) {
    let best = -1
    let improvement = 1e-8
    for (let i = 0; i < count; i++) {
      if (stakes[i] + 100 > ticketCap || (stakes[i] === 0 && points >= pointLimit)) continue
      const deltaVariance = 200 * covarianceWithPosition[i] + 10000 * covariances[i][i]
      const delta = 100 * (candidates[i].expectedReturn - 1) - policy.riskPenalty * deltaVariance / (2 * Number(budget))
      if (delta > improvement) { improvement = delta; best = i }
    }
    if (best < 0) break
    if (stakes[best] === 0) points++
    stakes[best] += 100
    invested += 100
    for (let i = 0; i < count; i++) covarianceWithPosition[i] += 100 * covariances[i][best]
  }
  const allocations = candidates.flatMap((ticket, index) => stakes[index] > 0 ? [{ ...ticket, stake: stakes[index] }] : [])
  return { evaluated, allocations, metrics: portfolioMetrics(allocations, model.outcomes, Number(budget)), coverage,
    issues, method, search, policy: { ...policy, profile, ticketCap, pointLimit } }
}
