import { validTimestamp } from './raceTime.js'

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
