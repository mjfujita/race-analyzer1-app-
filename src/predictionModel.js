import { decisionCutoff, raceDateISO, raceTimestamp, validTimestamp } from './raceTime.js'
import { normalizedMarketShares } from './marketModel.js'

export const CONTEXT_FEATURES = Object.freeze(['goingAffinity', 'weatherAffinity', 'paceFit', 'dayBias', 'paddock'])
export const CONTEXT_LABELS = Object.freeze({ goingAffinity: '馬場状態との相性', weatherAffinity: '天候との相性',
  paceFit: '脚質の組合せ', dayBias: '能力差を考慮した当日傾向', paddock: 'パドックの相対評価' })
const front = style => ({ 1: 1, 2: 0.5, 3: -0.5, 4: -1 })[Number(style)] ?? null
const finite = value => typeof value === 'number' && Number.isFinite(value)
const dateDigits = value => String(value ?? '').replace(/[-/]/g, '')
const normalizeGoing = value => ({ 1: '良', 2: '稍重', 3: '重', 4: '不良', 稍: '稍重' })[String(value ?? '').trim()] ?? String(value ?? '').trim()
const softmax = values => {
  const high = Math.max(...values), weights = values.map(x => Math.exp(Math.max(-700, x - high)))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map(x => x / total)
}
const baseProbability = horse => Number(horse.pF ?? horse.probability)

/** A direct visible-page capture proves availability, without inventing publication time. */
export function availableAt(source, cutoffAt, maxAgeMinutes = Infinity) {
  if (!source || !validTimestamp(cutoffAt) || !validTimestamp(source.retrievedAt)) return false
  const retrieved = Date.parse(source.retrievedAt), cutoff = Date.parse(cutoffAt)
  if (retrieved > cutoff) return false
  if (source.timingEvidence === 'observed-visible-at' && validTimestamp(source.availabilityAt)
    && Date.parse(source.availabilityAt) === retrieved) {
    if (source.observedAt != null && (!validTimestamp(source.observedAt) || Date.parse(source.observedAt) > retrieved)) return false
    if (source.sourcePublishedAt != null && (!validTimestamp(source.sourcePublishedAt) || Date.parse(source.sourcePublishedAt) > retrieved)) return false
    return (cutoff - retrieved) / 60000 <= maxAgeMinutes
  }
  if (![source.observedAt, source.sourcePublishedAt].every(validTimestamp)) return false
  const observed = Date.parse(source.observedAt), published = Date.parse(source.sourcePublishedAt)
  return published <= observed && observed <= retrieved && (cutoff - observed) / 60000 <= maxAgeMinutes
}

function historyAffinity(horse, targetDate, surface, key, target) {
  if (!target || target === '—' || target === '?') return null
  const past = (horse.pastRuns ?? horse.past_runs ?? []).filter(run => {
    const date = dateDigits(run.raceDate ?? run.race_date ?? run.date)
    // Month-only legacy dates are safe only when strictly earlier than the target month.
    const earlier = /^\d{8}$/.test(date) ? date < targetDate : /^\d{6}$/.test(date) && date < targetDate.slice(0, 6)
    return earlier && Number.isInteger(Number(run.rank)) && Number(run.rank) >= 1
      && Number(run.field_size ?? run.fieldSize) >= Number(run.rank) && Number(run.field_size ?? run.fieldSize) >= 2
      && (!surface || (run.surface ?? run.dist?.slice(0, surface === 'ダート' ? 3 : 1)) === surface)
  }).sort((a, b) => dateDigits(b.raceDate ?? b.race_date ?? b.date).localeCompare(dateDigits(a.raceDate ?? a.race_date ?? a.date))).slice(0, 5)
  const known = past.filter(run => run[key] != null && run[key] !== '' && run[key] !== '—' && run[key] !== '?')
  if (!known.length) return null
  const matching = known.filter(run => (key === 'going' ? normalizeGoing(run[key]) : String(run[key]).trim()) === target)
  // Zero means no evidence in that condition, not poor suitability.
  return matching.reduce((sum, run) => sum + 0.5 - (Number(run.rank) - 1) / (Number(run.field_size ?? run.fieldSize) - 1), 0) / (matching.length + 3)
}

/** Construct measured features; none of these values are arbitrary probability bonuses. */
export function buildRaceContext({ race, horses = [], field = [], statistics = [], observation = null, observations = [], earlierResults = [], earlierRaces = [], cutoffAt = decisionCutoff(race) } = {}) {
  const targetDate = dateDigits(race?.raceDate), byNo = new Map(horses.map(h => [Number(h.no ?? h.horseNo), h]))
  const stats = new Map(statistics.map(s => [Number(s.horse_no ?? s.horseNo), s]))
  const records = (Array.isArray(observations) ? observations : observations?.observations ?? []).filter(row => !row.kind || ['LIVE_RACE', 'RACE_CONTEXT', 'observed'].includes(row.kind))
    .map(row => row.payload ? { ...row.payload, retrievedAt: row.payload.retrievedAt ?? row.retrievedAt } : row)
  const pastWeather = new Map()
  for (const row of [...records].sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt))) {
    const post = raceTimestamp({ raceDate: row.raceDate }, row.postTime)
    if (row.weather && dateDigits(row.raceDate) < targetDate && availableAt(row, post, 120)) pastWeather.set(String(row.raceId), row.weather)
  }
  for (const [no, horse] of byNo) byNo.set(no, { ...horse, pastRuns: (horse.pastRuns ?? horse.past_runs ?? []).map(run => ({ ...run,
    weather: run.weather ?? pastWeather.get(String(run.raceId ?? run.race_key)) })) })
  const source = (observation?.payload ? { ...observation.payload, retrievedAt: observation.payload.retrievedAt ?? observation.retrievedAt } : observation)
    ?? records.filter(row => String(row.raceId) === String(race?.id) && dateDigits(row.raceDate) === targetDate && availableAt(row, cutoffAt, 60))
      .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0]
  const sourceMatches = source && String(source.raceId) === String(race?.id) && dateDigits(source.raceDate) === targetDate
  const visible = sourceMatches && availableAt(source, cutoffAt, 60)
  const styles = field.map(h => front(h.style ?? stats.get(Number(h.no))?.running_style ?? byNo.get(Number(h.no))?.running_style))
  const completeStyles = styles.length >= 2 && styles.every(finite)
  const fractionFront = completeStyles ? styles.filter(x => x > 0).length / styles.length : null
  const paddockInput = Array.isArray(source?.paddock) ? source.paddock : Object.entries(source?.paddock ?? {}).map(([no, value]) => typeof value === 'object' ? { horseNo: Number(no), ...value } : { horseNo: Number(no), paddockIndex: value })
  const paddockMap = new Map(paddockInput.map(p => [Number(p.horseNo ?? p.no), p.paddockIndex]))
  const paddockValues = field.map(h => paddockMap.get(Number(h.no)))
  const completePaddock = visible && paddockValues.length >= 2 && paddockValues.every(finite)
  const mean = completePaddock ? paddockValues.reduce((a, b) => a + b, 0) / field.length : 0
  const sd = completePaddock ? Math.sqrt(paddockValues.reduce((a, b) => a + (b - mean) ** 2, 0) / field.length) : 0
  const dayCandidates = [...earlierResults, ...earlierRaces].filter(row => {
    const rowDate = dateDigits(row.raceDate ?? row.date)
    return rowDate === targetDate && String(row.placeCode) === String(race.placeCode)
      && String(row.surface ?? row.surfaceCode) === String(race.surface ?? race.surfaceCode)
      && String(row.raceId) !== String(race.id) && availableAt(row, cutoffAt)
      && Array.isArray(row.field) && row.field.length >= 2 && row.field.every(h => finite(baseProbability(h)) && front(h.style) !== null)
      && Math.abs(row.field.reduce((sum, h) => sum + baseProbability(h), 0) - 1) < 1e-6
      && row.field.some(h => Number(h.no) === Number(row.winnerNo))
  }).sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt))
  const dayRows = [...new Map(dayCandidates.map(row => [String(row.raceId), row])).values()]
  const dayResidual = dayRows.length ? dayRows.reduce((sum, row) => sum + front(row.field.find(h => Number(h.no) === Number(row.winnerNo)).style)
    - row.field.reduce((expected, h) => expected + baseProbability(h) * front(h.style), 0), 0) / (dayRows.length + 3) : null
  const features = Object.fromEntries(field.map((h, i) => [h.no, {
    goingAffinity: visible ? historyAffinity(byNo.get(Number(h.no)) ?? {}, targetDate, race.surface, 'going', normalizeGoing(source.going)) : null,
    weatherAffinity: visible ? historyAffinity(byNo.get(Number(h.no)) ?? {}, targetDate, race.surface, 'weather', String(source.weather ?? '').trim()) : null,
    paceFit: completeStyles ? styles[i] * (1 - 2 * fractionFront) : null,
    dayBias: completeStyles && dayResidual !== null ? styles[i] * dayResidual : null,
    paddock: completePaddock ? (sd > 0 ? Math.max(-3, Math.min(3, (paddockValues[i] - mean) / sd)) : 0) : null,
  }]))
  return { schemaVersion: 1, featureSchema: 'race-context-v1', raceId: race?.id, raceDate: race?.raceDate, cutoffAt, features,
    evidence: { goingAffinity: visible ? source.going ?? null : null, weatherAffinity: visible ? source.weather ?? null : null,
      paceFit: completeStyles ? { frontRunners: styles.filter(x => x > 0).length, fieldSize: field.length } : null,
      dayBias: { races: dayRows.length, residual: dayResidual }, paddock: { complete: Boolean(completePaddock), mean, sd } },
    source: sourceMatches ? source : null,
    availableFeatures: CONTEXT_FEATURES.filter(key => field.length && field.every(h => finite(features[h.no][key]))),
  }
}

export function validatePredictionModels(bundle) {
  if (!bundle || typeof bundle.id !== 'string' || !bundle.id.trim() || bundle.id.length > 200 || bundle.schemaVersion !== 1 || bundle.kind !== 'race-prediction-models' || typeof bundle.baseModel?.id !== 'string'
    || !validTimestamp(bundle.generatedAt) || (bundle.adoptedAt != null && !validTimestamp(bundle.adoptedAt))) throw new Error('予測モデル束の形式が不正です。')
  for (const [name, type] of [['contextModel', 'context-logit-v1'], ['marketModel', 't10-market-blend-v1'], ['closingOddsModel', 'closing-logratio-v1']]) {
    const model = bundle[name]
    if (!model || model.modelType !== type || !['ready', 'insufficient-data'].includes(model.status)) throw new Error('対応する予測モデルではありません。')
    if (model.status !== 'ready') continue
    if (!raceDateISO({ raceDate: model.trainedThrough }) || !validTimestamp(model.generatedAt) || model.baseModelId !== bundle.baseModel.id) throw new Error('モデルの学習時点・能力基準が不正です。')
    if (name === 'contextModel' && (!Array.isArray(model.features) || !model.features.length || new Set(model.features).size !== model.features.length
      || model.features.some(key => !CONTEXT_FEATURES.includes(key) || !finite(model.coefficients?.[key]) || Math.abs(model.coefficients[key]) > 20))) throw new Error('条件モデルの係数が不正です。')
    if (name === 'marketModel' && (!finite(model.gamma) || model.gamma <= 0 || model.gamma > 5 || !finite(model.abilityWeight) || model.abilityWeight < 0 || model.abilityWeight > 1)) throw new Error('市場モデルの係数が不正です。')
    if (name === 'closingOddsModel' && (!Array.isArray(model.coefficients) || model.coefficients.length !== 5 || model.coefficients.some(x => !finite(x) || Math.abs(x) > 100)
      || !finite(model.residualLower) || !finite(model.residualUpper) || model.residualLower > model.residualUpper)) throw new Error('最終価格モデルの係数が不正です。')
  }
  return bundle
}

export const validateRuntimeModels = validatePredictionModels

function usableModel(model, race, cutoffAt, abilityModelId) {
  return model?.status === 'ready' && model.baseModelId === abilityModelId && validTimestamp(cutoffAt)
    && dateDigits(model.trainedThrough) < dateDigits(race.raceDate)
    && validTimestamp(model.generatedAt) && Date.parse(model.generatedAt) <= Date.parse(cutoffAt)
}

export function closingPriceFeatures(odds, previousOdds, observedAt, previousAt, postAt) {
  if (!finite(odds) || odds < 1 || !validTimestamp(observedAt) || !validTimestamp(postAt)) return null
  const minutes = (Date.parse(postAt) - Date.parse(observedAt)) / 60000
  if (minutes < 10 || minutes > 30) return null
  const elapsed = validTimestamp(previousAt) ? (Date.parse(observedAt) - Date.parse(previousAt)) / 60000 : 0
  const hasPrevious = finite(previousOdds) && previousOdds >= 1 && elapsed >= 1 && elapsed <= 120
  const slope = hasPrevious ? Math.max(-2, Math.min(2, Math.log(odds / previousOdds) / elapsed * 10)) : 0
  return [1, Math.log(odds), slope, minutes / 10, hasPrevious ? 1 : 0]
}

/** Shared runtime contract for UI and the local capture/learning service. */
export function applyPredictionModels({ field = [], race, odds = {}, history = [], context = null, models = null,
  cutoffAt = decisionCutoff(race), abilityModelId = 'idm-temperature-baseline-v1' } = {}) {
  const issues = [], statuses = {}, prices = {}
  if (!field.length || field.some(h => !finite(baseProbability(h)) || baseProbability(h) <= 0)
    || Math.abs(field.reduce((sum, h) => sum + baseProbability(h), 0) - 1) > 1e-6) return { field: [], prices, issues: ['全頭の有効な能力確率が必要です。'], modelStatus: {}, context }
  let bundle = null
  try { bundle = models ? validatePredictionModels(models) : null } catch (error) { issues.push(error.message) }
  for (const name of ['contextModel', 'marketModel', 'closingOddsModel']) {
    const model = bundle?.[name]
    const adopted = !bundle?.adoptedAt || (validTimestamp(cutoffAt) && Date.parse(bundle.adoptedAt) <= Date.parse(cutoffAt))
    statuses[name] = adopted && usableModel(model, race, cutoffAt, abilityModelId) ? 'ready' : model?.status === 'ready' ? 'timing-or-version-mismatch' : 'insufficient-data'
  }
  const contextReady = context?.featureSchema === 'race-context-v1' && String(context.raceId) === String(race.id)
    && dateDigits(context.raceDate) === dateDigits(race.raceDate) && context.cutoffAt === cutoffAt
  const bounds = { goingAffinity: 0.5, weatherAffinity: 0.5, paceFit: 1, dayBias: 2, paddock: 3 }
  const enabled = statuses.contextModel === 'ready' && contextReady ? bundle.contextModel.features.filter(key =>
    field.every(h => finite(context.features?.[h.no]?.[key]) && Math.abs(context.features[h.no][key]) <= bounds[key])
    && (key === 'paceFit' || key === 'dayBias' || availableAt(context.source, cutoffAt, 60))) : []
  const contextLogits = field.map(h => Math.log(baseProbability(h)) + enabled.reduce((sum, key) => sum + context.features[h.no][key] * bundle.contextModel.coefficients[key], 0))
  const pContext = softmax(contextLogits), shares = normalizedMarketShares(field, odds)
  const eligibleHistory = history.filter(row => row.kind !== 'baseline' && String(row.raceId) === String(race.id) && availableAt(row, cutoffAt, 140)
    && validTimestamp(row.observedAt) && field.every(h => finite(row.odds?.[h.no]) && row.odds[h.no] >= 1))
    .sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt) || Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))
  const current = eligibleHistory.find(row => (Date.parse(cutoffAt) - Date.parse(row.observedAt)) / 60000 <= 20)
  const previous = current && eligibleHistory.find(row => Date.parse(row.observedAt) <= Date.parse(current.observedAt) - 60000)
  const currentMatches = current && field.every(h => current.odds[h.no] === odds[h.no])
  const pMarket = statuses.marketModel === 'ready' && shares && currentMatches ? softmax(field.map(h => bundle.marketModel.gamma * Math.log(shares[h.no]))) : null
  const pFinal = pMarket ? softmax(field.map((h, i) => bundle.marketModel.abilityWeight * Math.log(pContext[i]) + (1 - bundle.marketModel.abilityWeight) * Math.log(pMarket[i]))) : pContext
  for (const horse of field) {
    const observed = Number(odds[horse.no]), x = current && closingPriceFeatures(current.odds[horse.no], previous?.odds?.[horse.no], current.observedAt, previous?.observedAt, raceTimestamp(race, race.postTime ?? race.post_time))
    if (statuses.closingOddsModel === 'ready' && x && current.odds[horse.no] === observed) {
      const model = bundle.closingOddsModel, predictedLogChange = x.reduce((sum, value, i) => sum + value * model.coefficients[i], 0)
      const price = delta => Math.max(1, Math.min(9999999, observed * Math.exp(Math.max(-20, Math.min(20, delta)))))
      prices[horse.no] = { observed, median: price(predictedLogChange), lower: price(predictedLogChange + model.residualLower),
        upper: price(predictedLogChange + model.residualUpper), method: 'learned-closing-logratio', coverage: 0.8,
        interpretation: '校正期間の残差から作る予測幅。利益の信頼下限ではありません。', modelId: model.id }
    } else prices[horse.no] = { observed: finite(observed) && observed >= 1 ? observed : null, median: null, lower: null, upper: null, method: 'unavailable' }
  }
  if (!enabled.length) issues.push('当日条件の学習済み補正は未適用です。データ・時点・モデル版が揃った項目から反映します。')
  if (!pMarket) issues.push('10分前市場の校正・統合は未適用です。現在は能力と利用可能な条件の確率を使用します。')
  if (Object.values(prices).every(p => p.median === null)) issues.push('最終価格の学習予測は未適用です。実測価格と手動の下落感度を比較してください。')
  return { field: field.map((h, i) => ({ ...h, pF: baseProbability(h), pContext: pContext[i], pM: pMarket?.[i] ?? null,
    pStar: pFinal[i], probability: pFinal[i], contextContributions: enabled.map(key => ({ key, label: CONTEXT_LABELS[key],
      raw: context.features[h.no][key], coefficient: bundle.contextModel.coefficients[key], logit: context.features[h.no][key] * bundle.contextModel.coefficients[key] })) })),
    prices, issues, modelStatus: statuses, context, appliedFeatures: enabled, modelVersion: bundle?.id ?? null }
}
