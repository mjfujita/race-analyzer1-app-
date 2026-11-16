import { raceDateISO, snapshotTiming, validTimestamp } from './raceTime.js'

const isStack = value => typeof value === 'string' && value.length > 0 && value.length <= 800
const validVersionId = value => /^win-temp-[a-f0-9]{24}$/.test(value ?? '')
const rate = value => Number.isFinite(value) && value >= 0 && value <= 1
export const reviewStack = ({ ability, context = null, features = [], market = null }) => JSON.stringify([ability, context, features, market])

function temperatureScale(probabilities, temperature) {
  const logits = probabilities.map(p => Math.log(p) / temperature)
  const top = Math.max(...logits)
  const weights = logits.map(logit => Math.exp(Math.max(-700, logit - top)))
  const total = weights.reduce((a, b) => a + b, 0)
  return weights.map(weight => weight / total)
}

export function validCalibrationEvidence(record) {
  const { probabilityStack: stack, probabilityCalibration: id, probabilityTemperature: temperature } = record.inputs
  if (!isStack(stack) || (id == null ? temperature != null : !validVersionId(id) || !Number.isFinite(temperature) || temperature < 0.5 || temperature > 2)) return false
  const raw = record.field.map(horse => horse.pStar)
  if (raw.some(p => !rate(p) || p <= 0 || p >= 1) || Math.abs(raw.reduce((a, b) => a + b, 0) - 1) > 1e-6) return false
  const expected = id ? temperatureScale(raw, temperature) : raw
  return record.field.every((horse, i) => Math.abs(horse.probability - expected[i]) <= 1e-8)
}

export function validateForecastReview(review, ownerId) {
  if (!review || review.schemaVersion !== 1 || (review.ownerId != null && review.ownerId !== ownerId)
    || !validTimestamp(review.generatedAt) || !Array.isArray(review.active) || review.active.length > 8
    || !Array.isArray(review.versions) || review.versions.length > 20 || !Array.isArray(review.races) || review.races.length > 48
    || !Array.isArray(review.statesByStack) || review.statesByStack.length > 20
    || !Number.isSafeInteger(review.eligibleRaces) || !Number.isSafeInteger(review.totalForecasts)
    || review.eligibleRaces < 0 || review.totalForecasts < review.eligibleRaces
    || (review.ownerId == null && (review.active.length || review.totalForecasts))) throw new Error('振り返りデータの形式が不正です。')
  for (const model of [...review.active, ...review.versions]) {
    if (model.algorithm !== 'win-temperature-v1' || !validVersionId(model.id) || !isStack(model.stack)
      || !Number.isFinite(model.temperature) || model.temperature < 0.5 || model.temperature > 2
      || !raceDateISO({ raceDate: model.trainedThrough }) || !raceDateISO({ raceDate: model.testedThrough })
      || model.trainedThrough >= model.testedThrough || !validTimestamp(model.createdAt)
      || !['adopted', 'rejected'].includes(model.decision)
      || (model.decision === 'adopted' && (!validTimestamp(model.activatedAt) || Date.parse(model.activatedAt) < Date.parse(model.createdAt)))) throw new Error('確率校正モデルの形式が不正です。')
  }
  if (new Set(review.active.map(model => model.stack)).size !== review.active.length
    || review.active.some(model => model.decision !== 'adopted' || Date.parse(model.activatedAt) > Date.parse(review.generatedAt))
    || review.races.some(row => !raceDateISO(row) || !Array.isArray(row.field) || row.field.length < 2 || row.field.length > 18
      || row.field.some(h => !Number.isInteger(h.no) || h.no < 1 || h.no > 18 || !rate(h.probability)))) throw new Error('振り返りの対象レース・モデルが不正です。')
  return review
}

export function calibrateForecast(prediction, { review, stack, race, current, cutoffAt, now = Date.now() }) {
  const model = review?.active?.find(item => item.stack === stack)
  const day = raceDateISO(race)?.replaceAll('-', '')
  if (!model || !day || model.testedThrough >= day || !validTimestamp(review.receivedAt) || !validTimestamp(cutoffAt)
    || Date.parse(review.receivedAt) > now || Date.parse(review.receivedAt) > Date.parse(cutoffAt)
    || Date.parse(model.activatedAt) > Date.parse(review.receivedAt) || now > Date.parse(cutoffAt)
    || now - Date.parse(review.receivedAt) > 14 * 86400000 || !snapshotTiming(current, race).eligible) return prediction
  if (!prediction.field.length) return prediction
  const calibrated = temperatureScale(prediction.field.map(horse => horse.pStar), model.temperature)
  return { ...prediction, calibrationId: model.id, calibrationTemperature: model.temperature,
    field: prediction.field.map((horse, i) => ({ ...horse, probability: calibrated[i] })) }
}
