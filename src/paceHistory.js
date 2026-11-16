import { availableAt } from './predictionModel.js'
import { raceDateISO, raceTimestamp, validTimestamp } from './raceTime.js'

export function readPaceResults(userId, race, { cutoffAt = null, storage = globalThis.localStorage } = {}) {
  const key = `pace-results:v1:${userId}:${race.raceDate}:${race.placeCode}`
  try {
    // Unknown legacy retrieval times cannot establish information available at a cutoff.
    const legacy = cutoffAt ? {} : {
      ...JSON.parse(storage.getItem(`${key}:芝`)),
      ...JSON.parse(storage.getItem(`${key}:ダート`)),
      ...JSON.parse(storage.getItem(key)),
    }
    const events = JSON.parse(storage.getItem(`pace-events:v2:${userId}:${race.raceDate}:${race.placeCode}`) ?? '[]')
    if (!Array.isArray(events)) return legacy
    return events.filter(event => !cutoffAt || (
      validTimestamp(cutoffAt) && validTimestamp(event.publishedAt) && validTimestamp(event.retrievedAt)
      && Date.parse(event.publishedAt) <= Date.parse(event.retrievedAt)
      && Date.parse(event.retrievedAt) <= Date.parse(cutoffAt)
    )).sort((a, b) => (Date.parse(a.retrievedAt) || 0) - (Date.parse(b.retrievedAt) || 0))
      .reduce((map, event) => ({ ...map, [event.raceNo]: event }), legacy)
  } catch { return {} }
}

export function recordedPaceRows(earlierRaces, recorded, { cutoffAt } = {}) {
  return earlierRaces.filter(row => {
    const entry = recorded[row.race_no]
    if (!entry || !Array.isArray(entry.positions) || !Number.isInteger(entry.field) || entry.field < 3 || entry.field > 18
      || entry.positions.length !== 3 || entry.positions.some(p => !Number.isInteger(p) || p < 1 || p > entry.field)) return false
    return !cutoffAt || (validTimestamp(entry.publishedAt) && validTimestamp(entry.retrievedAt)
      && Date.parse(entry.publishedAt) <= Date.parse(entry.retrievedAt)
      && Date.parse(entry.retrievedAt) <= Date.parse(cutoffAt))
  }).map(row => {
    const { field, positions, publishedAt, retrievedAt } = recorded[row.race_no]
    return { ...row, field_size: field, top_count: positions.length,
      front_top_count: positions.filter(pos => pos <= Math.ceil(field / 3)).length, publishedAt, retrievedAt }
  })
}

export function capturedPaceRows(race, observations, { cutoffAt } = {}) {
  const day = raceDateISO(race)
  const targetStart = raceTimestamp(race, race.postTime ?? race.post_time)
  const targetNo = Number(race.raceNo ?? String(race.id ?? '').slice(-2))
  const byRace = new Map()
  for (const row of observations) {
    const sourceNo = Number(row.raceNo ?? String(row.raceId ?? '').slice(-2))
    const start = raceTimestamp(row, row.postTime)
    if (!day || raceDateISO(row) !== day || String(row.placeCode) !== String(race.placeCode)
      || !Number.isInteger(sourceNo) || sourceNo < 1 || sourceNo >= targetNo || !targetStart
      || (start && (start >= targetStart || Date.parse(row.retrievedAt) <= Date.parse(start)))
      || !Array.isArray(row.results) || !validTimestamp(row.retrievedAt) || (cutoffAt && !availableAt(row, cutoffAt))) continue
    const surface = String(row.surfaceCode ?? ({ '芝': '1', 'ダート': '2' })[row.surface] ?? '')
    const fieldSize = Number(row.fieldSize ?? row.field?.length)
    const top = row.results.filter(horse => Number(horse.rank) >= 1 && Number(horse.rank) <= 3)
      .sort((a, b) => Number(a.rank) - Number(b.rank))
    if (!['1', '2'].includes(surface) || !Number.isInteger(fieldSize) || fieldSize < 3 || fieldSize > 18 || top.length !== 3
      || top.some((horse, i) => Number(horse.rank) !== i + 1 || !Number.isInteger(horse.cornerPass4)
        || horse.cornerPass4 < 1 || horse.cornerPass4 > fieldSize)) continue
    const previous = byRace.get(sourceNo)
    if (previous && Date.parse(previous.retrievedAt) > Date.parse(row.retrievedAt)) continue
    byRace.set(sourceNo, { race_no: sourceNo, surface_code: surface, field_size: fieldSize, distance: row.distance,
      top_count: 3, front_top_count: top.filter(horse => horse.cornerPass4 <= Math.ceil(fieldSize / 3)).length,
      retrievedAt: row.retrievedAt, source: 'JRDB自動取得' })
  }
  return [...byRace.values()].sort((a, b) => a.race_no - b.race_no)
}
