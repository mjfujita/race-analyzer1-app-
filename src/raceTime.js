export function raceDateISO(race) {
  const raw = String(race?.raceDate ?? race?.race_date ?? '').replaceAll('-', '')
  if (!/^\d{8}$/.test(raw)) return null
  const date = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
  const parsed = new Date(`${date}T00:00:00+09:00`)
  if (!Number.isFinite(parsed.getTime())) return null
  return new Date(parsed.getTime() + 9 * 3600000).toISOString().slice(0, 10) === date ? date : null
}

export function japanRaceDay(now = Date.now()) {
  return new Date(now + 9 * 3600000).toISOString().slice(0, 10).replaceAll('-', '')
}

export function raceTimestamp(race, time, dateOverride) {
  const date = dateOverride ? raceDateISO({ raceDate: dateOverride }) : raceDateISO(race)
  const raw = String(time ?? '').replace(':', '')
  if (!date || !/^\d{4}$/.test(raw) || Number(raw.slice(0, 2)) > 23 || Number(raw.slice(2)) > 59) return null
  return new Date(`${date}T${raw.slice(0, 2)}:${raw.slice(2)}:00+09:00`).toISOString()
}

export function decisionCutoff(race, minutesBefore = 10) {
  const post = raceTimestamp(race, race?.postTime ?? race?.post_time)
  return post && Number.isFinite(minutesBefore) && minutesBefore >= 0
    ? new Date(Date.parse(post) - minutesBefore * 60000).toISOString() : null
}

export function validTimestamp(value) {
  return typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
}

export function snapshotTiming(snapshot, race, { cutoffAt = decisionCutoff(race), maxAgeMinutes = 20 } = {}) {
  const observedAt = snapshot?.observedAt ?? null
  const retrievedAt = snapshot?.retrievedAt ?? null
  const publishedAt = snapshot?.sourcePublishedAt ?? null
  const direct = snapshot?.timingEvidence === 'observed-visible-at' && validTimestamp(snapshot.availabilityAt)
    && Date.parse(snapshot.availabilityAt) === Date.parse(retrievedAt)
  const legacy = !validTimestamp(observedAt) || !validTimestamp(retrievedAt) || (!direct && !validTimestamp(publishedAt))
  const ageMinutes = validTimestamp(cutoffAt) && validTimestamp(observedAt)
    ? (Date.parse(cutoffAt) - Date.parse(observedAt)) / 60000 : null
  let reason = null
  if (!validTimestamp(cutoffAt)) reason = '発走時刻が未取得です。'
  else if (legacy) reason = '取得・公開時刻の証跡がないため、過去検証用です。'
  else if (snapshot?.raceId != null && String(snapshot.raceId) !== String(race?.id)) reason = '別レースの記録です。'
  else if ((publishedAt != null && (!validTimestamp(publishedAt) || Date.parse(publishedAt) > Date.parse(observedAt))) || Date.parse(observedAt) > Date.parse(retrievedAt)) reason = '公開・観測・取得時刻の順序が不正です。'
  else if ([observedAt, retrievedAt, publishedAt].filter(Boolean).some(t => Date.parse(t) > Date.parse(cutoffAt))) reason = '発走10分前までに取得された情報ではありません。'
  else if (ageMinutes > maxAgeMinutes) reason = `締切時点で${Math.floor(ageMinutes)}分前の情報です。`
  return { eligible: !reason, reason, legacy, observedAt, retrievedAt, cutoffAt, ageMinutes }
}

export function formatRaceTime(iso) {
  return validTimestamp(iso) ? new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(new Date(iso)) : '時刻不明'
}
