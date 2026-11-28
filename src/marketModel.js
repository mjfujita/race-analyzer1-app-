// A probability baseline for research, not a claim of calibrated betting edge.
/**
 * @typedef {{no:number|string, name?:string, idm?:number|null, frameNo?:number|null,
 * frame_no?:number|null, running_style?:number|string, cancelled?:boolean, scratched?:boolean}} HorseInput
 * @typedef {{horse_no:number|string, idm?:number|null, running_style?:number|string,
 * frame_no?:number|null, frameNo?:number|null, distance_top3?:number, distance_runs?:number,
 * venue_top3?:number, venue_runs?:number, course_top3?:number, course_runs?:number}} AbilityStatistics
 * @typedef {{id?:string, raceDate?:string, fieldSize?:number|string, activeFieldSize?:number|string}} AbilityRace
 * @typedef {{no:number, probability:number, pF?:number, idm?:number|null, name?:string,
 * frameNo?:number|null, frame_no?:number|null, stat?:AbilityStatistics}} ProbabilityHorse
 * @typedef {{schemaVersion:number, modelType:string, temperature:number, id?:string,
 * status?:string, trainedThrough?:string, generatedAt?:string, adoptedAt?:string,
 * informationTiming?:string, validation?:object, coefficients?:Record<string,number>,
 * featureSchema?:string, featureSpec?:object, selection?:object}} AbilityModel
 */
export const DEFAULT_MODEL = Object.freeze({
  id: 'idm-temperature-baseline-v1', modelType: 'idm-temperature', status: 'uncalibrated', temperature: 8,
  label: 'IDM基準モデル・未校正',
})

const CONDITION_FIELDS = Object.freeze({
  distance: ['distance_top3', 'distance_runs'], venue: ['venue_top3', 'venue_runs'], course: ['course_top3', 'course_runs'],
})
const CONDITION_LABELS = Object.freeze({ distance: '近い距離', venue: '同じ競馬場', course: '同じ競馬場・距離' })

const finite = value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
const validOdds = value => finite(value) && Number(value) >= 1
const raceDate = value => {
  const digits = String(value ?? '').replaceAll('-', '')
  if (!/^\d{8}$/.test(digits)) return null
  const date = new Date(`${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10).replaceAll('-', '') === digits ? digits : null
}

/** @param {AbilityModel|null|undefined} model */
export function isSupportedAbilityModel(model) {
  if (!model || model.schemaVersion !== 1 || !['idm-temperature', 'idm-conditions-v1'].includes(model.modelType)
    || typeof model.temperature !== 'number' || !Number.isFinite(model.temperature) || model.temperature <= 0 || model.temperature > 1000) return false
  if (model.modelType === 'idm-temperature') return true
  const spec = model.featureSpec
  if (model.featureSchema !== 'race-ability-last5-v1' || spec?.version !== 1 || spec.window !== 5
    || spec.distanceTolerance !== 200 || spec.priorStrength !== 3 || typeof spec.priorRate !== 'number'
    || !Number.isFinite(spec.priorRate) || spec.priorRate < 0 || spec.priorRate > 1
    || !model.coefficients || Object.keys(model.coefficients).length !== 3) return false
  return Object.entries(CONDITION_FIELDS).every(([key, fields]) =>
    typeof model.coefficients[key] === 'number' && Number.isFinite(model.coefficients[key]) && Math.abs(model.coefficients[key]) <= 100
    && Array.isArray(spec.fields?.[key]) && fields.every((field, i) => spec.fields[key][i] === field) && spec.fields[key].length === 2)
    && !(model.selection?.selected === 'incumbent' && Object.values(model.coefficients).some(value => value !== 0))
}

/**
 * @param {{horses?:HorseInput[], statistics?:AbilityStatistics[], race?:AbilityRace, model?:AbilityModel|null}} options
 */
export function buildAbilityField({ horses = [], statistics = [], race = {}, model = null } = {}) {
  const issues = []
  const active = horses.filter(horse => !horse.cancelled && !horse.scratched)
  const declared = Number(race.fieldSize)
  const listed = horses.map(horse => Number(horse.no))
  // PACI can retain the pre-withdrawal count. Infer the remaining count only
  // when the complete, unique original field and explicit withdrawals exist.
  // Missing runners alone must never make an incomplete field look complete.
  const fullOriginalField = Number.isInteger(declared) && declared >= 2 && declared <= 18 && declared === horses.length
    && new Set(listed).size === declared && listed.every(no => Number.isInteger(no) && no >= 1 && no <= 18)
  const expected = Number(race.activeFieldSize ?? (fullOriginalField && active.length < horses.length ? active.length : race.fieldSize))
  const numbers = active.map(horse => Number(horse.no))
  if (!Number.isInteger(expected) || expected < 2 || expected !== active.length) issues.push('正式な出走頭数と取得済み全頭が一致していません。')
  if (active.length < 2 || active.length > 18 || new Set(numbers).size !== numbers.length
    || numbers.some(no => !Number.isInteger(no) || no < 1 || no > 18)) issues.push('出走馬番が不足、重複、または範囲外です。')
  const byHorse = new Map(statistics.map(stat => [Number(stat.horse_no), stat]))
  const records = active.map(horse => {
    const stat = byHorse.get(Number(horse.no)) ?? {}
    const idm = stat.idm ?? horse.idm
    if (!finite(idm)) issues.push(`${horse.no}番の出走時IDMがありません。`)
    return { no: Number(horse.no), name: horse.name ?? '', idm: finite(idm) ? Number(idm) : null,
      style: Number(stat.running_style ?? horse.running_style) || null, stat,
      frameNo: Number(horse.frameNo ?? horse.frame_no ?? stat.frame_no ?? stat.frameNo) || null }
  })
  let selected = { ...DEFAULT_MODEL }
  const modelIssues = []
  if (model) {
    const trainedThrough = raceDate(model.trainedThrough)
    const targetDate = raceDate(race.raceDate)
    if (!isSupportedAbilityModel(model)) {
      modelIssues.push('学習モデルの形式を確認できないため、未校正のIDM基準モデルを使用します。')
    } else if (!trainedThrough || !targetDate || trainedThrough >= targetDate) {
      modelIssues.push('対象レースより前に学習を終えたモデルではないため、未校正のIDM基準モデルを使用します。')
    } else {
      selected = { id: String(model.id ?? 'idm-temperature-research').slice(0, 200), modelType: model.modelType, status: 'research',
        label: model.modelType === 'idm-conditions-v1' ? model.selection?.selected === 'incumbent'
          ? 'IDM基準を採用・条件効果は比較検証で不採用' : 'IDM・距離・会場・コース学習モデル・検証中'
          : 'IDM学習モデル・収益性検証中', temperature: Number(model.temperature),
        trainedThrough: model.trainedThrough, informationTiming: model.informationTiming ?? 'unknown',
        validation: model.validation ?? null, generatedAt: model.generatedAt ?? null, adoptedAt: model.adoptedAt ?? null,
        coefficients: model.coefficients ?? null, featureSpec: model.featureSpec ?? null, featureSchema: model.featureSchema ?? null,
        selection: model.selection ?? null }
    }
  }
  if (issues.length) return { field: [], complete: false, issues: [...issues, ...modelIssues], model: selected, modelStatus: selected.status }

  if (selected.modelType === 'idm-conditions-v1') {
    const invalid = records.filter(horse => Object.values(CONDITION_FIELDS).some(([top3, runs]) =>
      !Number.isInteger(horse.stat[runs]) || !Number.isInteger(horse.stat[top3])
      || horse.stat[runs] < 0 || horse.stat[runs] > 5 || horse.stat[top3] < 0 || horse.stat[top3] > horse.stat[runs]))
    if (invalid.length) {
      modelIssues.push(`${invalid.map(horse => horse.no).join('・')}番の過去5走条件集計が不足・不正のため、全頭を未校正のIDM基準モデルへ戻しました。`)
      selected = { ...DEFAULT_MODEL }
    }
  }
  const components = records.map(horse => {
    const terms = [{ key: 'idm', label: '出走時IDM', raw: horse.idm, coefficient: 1 / selected.temperature,
      logit: horse.idm / selected.temperature, evidence: { description: '今回の出走前IDM。結果IDMではありません。' } }]
    if (selected.modelType === 'idm-conditions-v1') for (const [key, [top3Field, runsField]] of Object.entries(CONDITION_FIELDS)) {
      const top3 = horse.stat[top3Field], runs = horse.stat[runsField]
      const { priorRate, priorStrength } = selected.featureSpec
      const raw = (top3 - priorRate * runs) / (runs + priorStrength)
      const coefficient = selected.coefficients[key]
      terms.push({ key, label: CONDITION_LABELS[key], raw, coefficient, logit: coefficient * raw,
        evidence: { top3, runs, window: 5, priorRate, priorStrength,
          description: '対象日より前の有効な過去5走から同馬場種別で集計。寄与は学習係数によるスコア差で、因果効果や勝率の増減幅ではありません。' } })
    }
    return terms
  })
  const means = Object.fromEntries(components[0].map(term => [term.key,
    components.reduce((sum, terms) => sum + terms.find(item => item.key === term.key).logit, 0) / components.length]))
  const scores = components.map(terms => terms.reduce((sum, term) => sum + term.logit, 0))
  const top = Math.max(...scores)
  const weights = scores.map(score => Math.exp(Math.max(-700, score - top)))
  const total = weights.reduce((sum, value) => sum + value, 0)
  const bestIdm = Math.max(...records.map(horse => horse.idm))
  const idmWeights = records.map(horse => Math.exp(Math.max(-700, (horse.idm - bestIdm) / selected.temperature)))
  const idmTotal = idmWeights.reduce((sum, weight) => sum + weight, 0)
  const ranked = records.map((horse, index) => ({ ...horse, score: scores[index], weight: weights[index],
    idmProbability: idmWeights[index] / idmTotal,
    contributions: components[index].map(term => ({ ...term, centeredLogit: term.logit - means[term.key] })),
    probability: weights[index] / total, pF: weights[index] / total }))
    .sort((a, b) => b.probability - a.probability || a.no - b.no)
  const field = ranked.map(horse => ({ ...horse, abilityRank: ranked.findIndex(other => other.score === horse.score) + 1 }))
  return { field, complete: true, issues: modelIssues, model: selected, modelStatus: selected.status }
}

/** @param {ProbabilityHorse[]} field @param {Record<string,number>} odds */
export function normalizedMarketShares(field, odds = {}) {
  if (!field.length || field.some(horse => !validOdds(odds[horse.no]))) return null
  const total = field.reduce((sum, horse) => sum + 1 / Number(odds[horse.no]), 0)
  return Object.fromEntries(field.map(horse => [horse.no, (1 / Number(odds[horse.no])) / total]))
}

/** @param {{field?:ProbabilityHorse[], odds?:Record<string,number>, baselineOdds?:Record<string,number>, previousOdds?:Record<string,number>, priceFactor?:number}} options */
export function analyzeMarket({ field = [], odds = {}, baselineOdds = {}, previousOdds = {}, priceFactor = 0.9 } = {}) {
  const shares = normalizedMarketShares(field, odds)
  const baseline = normalizedMarketShares(field, baselineOdds)
  const previous = normalizedMarketShares(field, previousOdds)
  const factor = finite(priceFactor) && Number(priceFactor) > 0 && Number(priceFactor) <= 1 ? Number(priceFactor) : null
  const issues = []
  if (!shares) issues.push('全頭の同時点オッズが揃うまで市場支持率と評価差を保留します。')
  if (factor === null) issues.push('価格ストレスは0より大きく1以下の倍率を指定してください。')
  const rankedOdds = field.map(horse => odds[horse.no]).filter(validOdds).map(Number).sort((a, b) => a - b)
  const rows = field.map(horse => {
    const p = Number(horse.probability)
    const pF = Number(horse.pF ?? horse.probability)
    const observed = validOdds(odds[horse.no]) ? Number(odds[horse.no]) : null
    const before = validOdds(previousOdds[horse.no]) ? Number(previousOdds[horse.no]) : null
    const stressOdds = observed !== null && factor !== null ? Math.max(1, observed * factor) : null
    const marketShare = shares?.[horse.no] ?? null
    const baselineShare = baseline?.[horse.no] ?? null
    const gapLog = marketShare !== null && pF > 0 ? Math.log(pF / marketShare) : null
    const expectedReturn = observed === null ? null : p * observed
    const stressReturn = stressOdds === null ? null : p * stressOdds
    const judgment = gapLog === null || stressReturn === null ? '判定保留'
      : stressReturn > 1 ? '価格面の候補（試算）'
        : gapLog > 0 ? '市場より高評価・価格不足' : '価格が見合わない（試算）'
    return { ...horse, pF, odds: observed, stressOdds, marketShare, baselineShare,
      previousShare: previous?.[horse.no] ?? null, marketProbability: null,
      marketRank: shares && observed !== null ? rankedOdds.indexOf(observed) + 1 : null,
      gapLog, abilityBaselineGap: baselineShare !== null && pF > 0 ? Math.log(pF / baselineShare) : null,
      baselineMarketGap: baselineShare !== null && marketShare !== null ? Math.log(baselineShare / marketShare) : null,
      breakEvenProbability: observed === null ? null : 1 / observed,
      fairOdds: p > 0 ? 1 / p : null, expectedReturn, stressReturn,
      movement: observed !== null && before !== null ? observed / before - 1 : null,
      judgment }
  })
  return { rows, complete: Boolean(shares) && factor !== null, issues,
    priceMethod: '指定した下落率による感度分析。学習済み最終オッズ予測・信頼下限ではありません。' }
}
