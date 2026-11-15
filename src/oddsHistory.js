import { raceTimestamp, validTimestamp } from './raceTime.js'

export function oddsStorageKey(userId, race) {
  return `race-ability-odds:v1:${userId}:${race?.raceDate}:${race?.id}`
}

function validOddsMap(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length > 0 && Object.keys(value).length <= 18
    && Object.entries(value).every(([no, price]) => /^(?:[1-9]|1[0-8])$/.test(no)
      && typeof price === 'number' && Number.isFinite(price) && price >= 1 && price <= 9999999)
}

function sameEvent(a, b) {
  const fields = ['schemaVersion', 'id', 'raceId', 'raceDate', 'kind', 'time', 'observedAt', 'sourcePublishedAt', 'retrievedAt', 'source', 'revisionOf', 'timingEvidence', 'availabilityAt']
  return fields.every(key => (a[key] ?? null) === (b[key] ?? null))
    && JSON.stringify(Object.entries(a.odds).sort()) === JSON.stringify(Object.entries(b.odds).sort())
}

function validAvailability(row) {
  const direct = row?.timingEvidence === 'observed-visible-at' && validTimestamp(row.availabilityAt)
    && Date.parse(row.availabilityAt) === Date.parse(row.retrievedAt)
  return (direct || validTimestamp(row.sourcePublishedAt))
    && (row.sourcePublishedAt == null ? direct : validTimestamp(row.sourcePublishedAt) && Date.parse(row.sourcePublishedAt) <= Date.parse(row.observedAt))
}

function validEvent(row) {
  return row?.schemaVersion === 2 && typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 100
    && typeof row.raceId === 'string' && ['observed', 'baseline'].includes(row.kind) && validOddsMap(row.odds)
    && validTimestamp(row.observedAt) && validTimestamp(row.retrievedAt) && validAvailability(row) && Date.parse(row.observedAt) <= Date.parse(row.retrievedAt)
    && /^\d{2}:\d{2}$/.test(row.time ?? '')
    && new Date(Date.parse(row.observedAt) + 9 * 3600000).toISOString().slice(11, 16) === row.time
}

export function readOddsEvents(key, storage = globalThis.localStorage) {
  const raw = storage.getItem(key)
  if (!raw) return []
  const saved = JSON.parse(raw)
  const rows = Array.isArray(saved) ? saved : saved?.time && saved?.odds ? [saved] : null
  if (!rows || rows.some(row => !/^\d{2}:\d{2}$/.test(row.time ?? '') || !validOddsMap(row.odds) || (row.schemaVersion === 2 && !validEvent(row)))) {
    throw new Error('オッズの保存形式を読み取れません。既存記録は上書きしていません。')
  }
  const normalized = rows.map((row, i) => ({ ...row, id: row.id ?? `legacy-${row.time}-${i}`, kind: row.kind ?? 'observed' }))
  if (new Set(normalized.map(row => row.id)).size !== normalized.length) throw new Error('重複した記録IDがあります。上書きはしません。')
  return normalized
}

export function readOddsHistory(key, { kind = 'observed', storage = globalThis.localStorage, asOf = null } = {}) {
  try {
    const latest = new Map()
    for (const row of readOddsEvents(key, storage).filter(row => row.kind === kind)) {
      if (asOf && (!validTimestamp(asOf) || !validEvent(row) || ![row.observedAt, row.sourcePublishedAt, row.retrievedAt].filter(Boolean).every(t => validTimestamp(t) && Date.parse(t) <= Date.parse(asOf)))) continue
      const group = validTimestamp(row.observedAt) ? Date.parse(row.observedAt) : row.time
      const prior = latest.get(group)
      if (!prior || !row.retrievedAt || Date.parse(row.retrievedAt) >= Date.parse(prior.retrievedAt ?? '1970-01-01')) latest.set(group, row)
    }
    return [...latest.values()].sort((a, b) => (Date.parse(b.observedAt) || 0) - (Date.parse(a.observedAt) || 0)
      || b.time.localeCompare(a.time) || String(b.retrievedAt).localeCompare(String(a.retrievedAt)))
  } catch {
    return []
  }
}

export function createOddsSnapshot({ race, time, odds, kind = 'observed', source = 'manual-jrdb', date, retrievedAt = new Date().toISOString() }) {
  const observedAt = raceTimestamp(race, time, date)
  if (!race?.id || !observedAt || !validTimestamp(retrievedAt) || Date.parse(observedAt) > Date.parse(retrievedAt)) {
    throw new Error('観測日時が不正、または現在より未来になっています。')
  }
  if (!['observed', 'baseline'].includes(kind) || !validOddsMap(odds)) throw new Error('オッズの種類・馬番・倍率を確認してください。')
  return { schemaVersion: 2, id: crypto.randomUUID(), raceId: String(race.id), raceDate: race.raceDate,
    kind, time: `${String(time).replace(':', '').slice(0, 2)}:${String(time).replace(':', '').slice(2)}`,
    observedAt, sourcePublishedAt: observedAt, retrievedAt, source, odds: { ...odds }, revisionOf: null }
}

export function appendOddsSnapshot(key, snapshot, storage = globalThis.localStorage) {
  if (!validEvent(snapshot)) throw new Error('日時と出典を確認できない記録は追記できません。')
  const rows = readOddsEvents(key, storage)
  if (rows.length >= 2000) throw new Error('記録が多いため、JSONを書き出して保管してください。')
  const existing = rows.find(row => row.id === snapshot.id)
  if (existing) {
    if (!sameEvent(existing, snapshot)) throw new Error('同じIDに異なる記録があります。上書きしませんでした。')
    return rows
  }
  const previous = rows.findLast(row => row.kind === snapshot.kind && row.time === snapshot.time && Date.parse(row.observedAt) === Date.parse(snapshot.observedAt))
  const next = [...rows, { ...snapshot, revisionOf: previous?.id ?? null }]
  storage.setItem(key, JSON.stringify(next))
  return next
}

export function importOddsSnapshots(key, input, race, numbers, storage = globalThis.localStorage) {
  const incoming = Array.isArray(input) ? input : input?.snapshots
  if (!Array.isArray(incoming) || incoming.length === 0 || incoming.length > 2000) throw new Error('snapshots配列を含むJSONを指定してください。')
  const allowed = new Set(numbers.map(Number))
  const rows = readOddsEvents(key, storage)
  const ids = new Map(rows.map(row => [row.id, row]))
  const next = [...rows]
  for (const row of incoming) {
    if (row.schemaVersion !== 2 || typeof row.id !== 'string' || row.id.length > 100 || !row.id
      || String(row.raceId) !== String(race.id) || String(row.raceDate).replaceAll('-', '') !== String(race.raceDate).replaceAll('-', '')
      || !['observed', 'baseline'].includes(row.kind) || !validOddsMap(row.odds)
      || Object.keys(row.odds).some(no => !allowed.has(Number(no)))
      || !validTimestamp(row.observedAt) || !validTimestamp(row.retrievedAt) || !validAvailability(row) || Date.parse(row.observedAt) > Date.parse(row.retrievedAt)
      || Date.parse(row.retrievedAt) > Date.now() + 60000
      || !validEvent(row)) {
      throw new Error('レース・馬番・時刻・倍率が不正です。取込みは行いませんでした。')
    }
    const clean = { schemaVersion: 2, id: row.id, raceId: String(row.raceId), raceDate: row.raceDate,
      kind: row.kind, time: row.time, odds: { ...row.odds }, observedAt: row.observedAt, sourcePublishedAt: row.sourcePublishedAt,
      retrievedAt: row.retrievedAt, ...(row.timingEvidence ? { timingEvidence: row.timingEvidence, availabilityAt: row.availabilityAt } : {}), source: String(row.source ?? 'json-import').slice(0, 100), revisionOf: row.revisionOf ?? null }
    if (ids.has(row.id)) {
      const old = ids.get(row.id)
      if (!sameEvent(old, clean)) {
        throw new Error('同じIDに異なる記録があります。上書きしませんでした。')
      }
    } else { next.push(clean); ids.set(row.id, clean) }
  }
  if (next.length > 2000) throw new Error('取込み後の記録数が上限を超えます。')
  storage.setItem(key, JSON.stringify(next))
  return next.length - rows.length
}
