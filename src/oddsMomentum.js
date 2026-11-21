import { readOddsHistory } from './oddsHistory.js'
import { decisionCutoff, raceDateISO, snapshotTiming, validTimestamp } from './raceTime.js'
import { normalizedMarketShares } from './marketModel.js'

/** Use only observed, full-field snapshots already known when the selected snapshot was received. */
export function oddsMomentum({ race, field, current, events = [], cutoffAt = decisionCutoff(race) }) {
  const empty = { reference: null, rows: new Map() }
  if (!current || current.kind !== 'observed' || !snapshotTiming(current, race, { cutoffAt, maxAgeMinutes: Infinity }).eligible
    || raceDateISO(current) !== raceDateISO(race) || String(current.raceId) !== String(race.id)) return empty
  const fullField = row => Object.keys(row.odds ?? {}).length === field.length && field.every(horse =>
    typeof row.odds?.[horse.no] === 'number' && Number.isFinite(row.odds[horse.no]) && row.odds[horse.no] >= 1)
  if (!fullField(current)) return empty
  const storage = { getItem: () => JSON.stringify(events.filter(row => String(row.raceId) === String(race.id)
    && raceDateISO(row) === raceDateISO(race))) }
  const history = readOddsHistory('anchor-momentum', { storage, asOf: current.retrievedAt })
    .filter(row => row.raceId === String(race.id) && raceDateISO(row) === raceDateISO(race) && fullField(row)
      && snapshotTiming(row, race, { cutoffAt, maxAgeMinutes: Infinity }).eligible
      && validTimestamp(row.observedAt) && Date.parse(row.observedAt) < Date.parse(current.observedAt))
  const reference = history.at(-1)
  if (!reference) return empty
  const oldShares = normalizedMarketShares(field, reference.odds)
  const newShares = normalizedMarketShares(field, current.odds)
  if (!oldShares || !newShares) return empty
  const rank = (odds, no) => 1 + field.filter(horse => odds[horse.no] < odds[no]).length
  return { reference, rows: new Map(field.map(horse => {
    const no = horse.no, priceChange = current.odds[no] / reference.odds[no] - 1
    const shareChange = newShares[no] / oldShares[no] - 1
    return [no, { priceChange, shareChange, previousRank: rank(reference.odds, no), currentRank: rank(current.odds, no),
      rising: priceChange < -1e-10 && shareChange > 1e-10 }]
  })) }
}
