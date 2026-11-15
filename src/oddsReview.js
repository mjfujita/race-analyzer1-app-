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

// Half Kelly per candidate, scaled down together if the allocation exceeds the cap.
export function allocateTickets(tickets, budget) {
  const fractions = tickets.map(ticket => {
    if (!ticket.qualifies || !ticket.pair.trim() || !ticket.reason.trim()) return 0
    return (ticket.expectedReturn - 1) / (2 * (Number(ticket.lower) - 1))
  })
  const scale = Math.max(1, fractions.reduce((sum, fraction) => sum + fraction, 0))
  return tickets.map((ticket, index) => ({
    ...ticket,
    stake: String(Math.floor(Number((budget * fractions[index] / scale / 100).toPrecision(15))) * 100),
  }))
}
