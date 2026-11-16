const MONTH_TTL = 15 * 60_000
const monthCache = new Map()

function parseMonth(payload, month) {
  const days = payload?.[0]?.data
  if (!Array.isArray(payload) || payload.length !== 1 || Number(payload[0].month) !== Number(month)
    || !Array.isArray(days) || !days.length || days.length > 31) return null
  const meetings = new Set(), seen = new Set()
  for (const row of days) {
    const day = Number(row?.date)
    if (!Number.isInteger(day) || day < 1 || day > 31 || seen.has(day) || !Array.isArray(row.info)) return null
    seen.add(day)
    for (const item of row.info) {
      if (!item || typeof item !== 'object' || (item.race != null && !Array.isArray(item.race))) return null
      if (item.race?.some(race => typeof race?.name !== 'string' || !race.name.trim())) return null
      if (item.race?.length) meetings.add(day)
    }
  }
  return meetings.size ? meetings : null
}

// The public JSON feed used by JRA's own monthly calendar.
export async function jraSchedule(raceDate, request = globalThis.fetch) {
  const month = raceDate.slice(0, 6), day = Number(raceDate.slice(6))
  let entry = monthCache.get(month)
  if (!entry || entry.expiresAt <= Date.now()) {
    const result = (async () => {
      try {
        const response = await request(`https://www.jra.go.jp/keiba/common/calendar/json/${month}.json`, {
          signal: AbortSignal.timeout(3000), redirect: 'error',
        })
        return response.ok ? parseMonth(await response.json(), month.slice(4)) : null
      } catch {
        return null
      }
    })()
    entry = { expiresAt: Date.now() + MONTH_TTL, result }
    monthCache.set(month, entry)
    if (!await result) entry.expiresAt = Date.now() + 60_000
  }
  const meetings = await entry.result
  return meetings ? (meetings.has(day) ? 'scheduled' : 'no-races') : 'unconfirmed'
}
