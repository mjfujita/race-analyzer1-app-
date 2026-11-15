export function oddsStorageKey(userId, race) {
  return `race-ability-odds:v1:${userId}:${race?.raceDate}:${race?.id}`
}

export function readOddsHistory(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key))
    return Array.isArray(saved) ? saved : saved?.time && saved?.odds ? [saved] : []
  } catch {
    return []
  }
}
