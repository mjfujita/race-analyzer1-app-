import { allocateTickets } from './oddsReview.js'

const validIdm = value => Number.isFinite(value) && value > 0

export function scoreField(horses, statistics, race, bias) {
  const statsByHorse = new Map(statistics.map(stat => [Number(stat.horse_no), stat]))
  const idms = horses.map(horse => statsByHorse.get(Number(horse.no))?.idm)
  if (horses.length < 2 || !idms.every(validIdm)) return []
  const bestIdm = Math.max(...idms)
  const leaders = horses.filter(horse => Number(statsByHorse.get(Number(horse.no))?.running_style) === 1).length
  const scored = horses.map((horse, i) => {
    const stat = statsByHorse.get(Number(horse.no))
    const style = Number(stat.running_style)
    const front = style === 1 || style === 2
    const rear = style === 3 || style === 4
    const balance = (top3, runs) => runs > 0 ? (top3 - runs / 3) / (runs + 3) : 0
    const distance = balance(stat.distance_top3, stat.distance_runs)
    const venue = balance(stat.venue_top3, stat.venue_runs)
    const goingRuns = (horse.pastRuns ?? []).filter(run => ['良', '稍重', '重', '不良'].includes(race.going)
      && run.going === race.going && run.dist?.startsWith(race.surface) && Number(run.rank) > 0).slice(0, 5)
    const goingTop3 = goingRuns.filter(run => Number(run.rank) <= 3).length
    const going = balance(goingTop3, goingRuns.length)
    const trend = ((bias === 'front' && front) || (bias === 'rear' && rear)) ? 0.16 : 0
    const pace = leaders >= 2 && rear ? 0.10 : leaders <= 1 && front ? 0.08 : 0
    const weight = Math.exp((idms[i] - bestIdm) / 8 + 0.6 * distance + 0.35 * venue + 0.45 * going + trend + pace)
    return { no: Number(horse.no), name: horse.name, idm: idms[i], style, weight, stat, goingTop3, goingRuns: goingRuns.length, trend, pace }
  })
  const total = scored.reduce((sum, horse) => sum + horse.weight, 0)
  return scored.map(horse => ({ ...horse, probability: horse.weight / total }))
    .sort((a, b) => b.probability - a.probability)
}

export function buildTickets(field, odds, earlierOdds, pairs, budget) {
  const byNo = new Map(field.map(horse => [horse.no, horse]))
  const singles = field.filter(horse => odds[horse.no] >= 1).map(horse => ({
    type: '単勝', first: horse.no, probability: horse.probability, odds: odds[horse.no], before: earlierOdds[horse.no],
  }))
  const combinations = pairs.filter(pair => byNo.has(pair.first) && byNo.has(pair.second)).map(pair => {
    const first = byNo.get(pair.first).probability
    const second = byNo.get(pair.second).probability
    const ordered = first * second / (1 - first)
    return { ...pair, probability: pair.type === '馬連' ? ordered + second * first / (1 - second) : ordered }
  })
  const evaluated = [...singles, ...combinations].map(ticket => {
    const movement = ticket.before >= 1 ? ticket.odds / ticket.before - 1 : null
    const lower = Math.max(1, ticket.odds * (1 + Math.max(-0.25, Math.min(-0.10, movement ?? 0))))
    const conservativeProbability = 0.85 * ticket.probability
    const expectedReturn = lower * conservativeProbability
    const pair = ticket.second ? `${ticket.first}${ticket.type === '馬単' ? '→' : '−'}${ticket.second}` : String(ticket.first)
    return { ...ticket, pair, reason: '能力・適性・展開から試算', movement, lower, conservativeProbability,
      expectedReturn, qualifies: expectedReturn > 1 }
  }).sort((a, b) => b.expectedReturn - a.expectedReturn)

  // 相関のある買い目が重なるため、上位5点に絞り、総額を予算の半分までにする。
  const allocated = allocateTickets(evaluated.filter(ticket => ticket.qualifies).slice(0, 5), budget)
  const total = allocated.reduce((sum, ticket) => sum + Number(ticket.stake), 0)
  const scale = total ? Math.min(1, Math.floor(budget / 200) * 100 / total) : 1
  return { evaluated, tickets: allocated.map(ticket => ({
    ...ticket, stake: Math.floor(Number(ticket.stake) * scale / 100) * 100,
  })).filter(ticket => ticket.stake >= 100) }
}
