const positive = (value) => Number.isFinite(Number(value)) && Number(value) > 0
const validOdds = (value) => positive(value) && Number(value) >= 1

export function reviewTicket({ baseline, earlier, current, lower, probability }) {
  const p = Number(probability) / 100
  const hasProbability = positive(p) && p <= 1
  const hasOdds = validOdds(current)
  const conservativeOdds = validOdds(lower) ? Number(lower) : null
  const breakEven = hasProbability ? 1 / p : null
  const expectedReturn = hasProbability && hasOdds && conservativeOdds !== null
    ? p * conservativeOdds
    : null
  return {
    gap: validOdds(baseline) && hasOdds ? Number(current) / Number(baseline) : null,
    movement: validOdds(earlier) && hasOdds ? Number(current) / Number(earlier) - 1 : null,
    breakEven,
    expectedReturn,
    qualifies: expectedReturn !== null && expectedReturn > 1,
  }
}
