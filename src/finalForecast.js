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

export const betTypes = {
  単勝: 1, 複勝: 1, 応援馬券: 1, 枠連: 2, 馬連: 2, 馬単: 2, ワイド: 2, '3連複': 3, '3連単': 3,
}
const orderedTypes = new Set(['馬単', '3連単'])

export function ticketKey(type, numbers) {
  const order = orderedTypes.has(type) ? numbers : [...numbers].sort((a, b) => a - b)
  return `${type}:${order.join('-')}`
}

export function frameNumbers(numbers) {
  const count = numbers.length
  if (count < 9 || count > 18 || !Array.from({ length: count }, (_, i) => numbers.includes(i + 1)).every(Boolean)) return new Map()
  const sizes = Array(8).fill(1)
  for (let i = 0; i < count - 8; i++) sizes[7 - i % 8]++
  return new Map(sizes.flatMap((size, i) => Array(size).fill(i + 1)).map((frame, i) => [i + 1, frame]))
}

function outcomeProbabilities(field, frames) {
  const totals = new Map()
  function add(type, numbers, probability) {
    const key = ticketKey(type, numbers)
    totals.set(key, (totals.get(key) ?? 0) + probability)
  }
  for (const first of field) {
    add('単勝', [first.no], first.probability)
    if (field.length >= 5) add('複勝', [first.no], first.probability)
    for (const second of field) {
      if (second === first) continue
      const p2 = first.probability * second.probability / (1 - first.probability)
      add('馬連', [first.no, second.no], p2)
      add('馬単', [first.no, second.no], p2)
      if (frames.size) add('枠連', [frames.get(first.no), frames.get(second.no)], p2)
      if (field.length >= 5) add('複勝', [second.no], p2)
      if (field.length < 5) continue
      for (const third of field) {
        if (third === first || third === second) continue
        const p3 = p2 * third.probability / (1 - first.probability - second.probability)
        const top = [first.no, second.no, third.no]
        if (field.length >= 8) add('複勝', [third.no], p3)
        add('3連複', top, p3)
        add('3連単', top, p3)
        add('ワイド', [first.no, second.no], p3)
        add('ワイド', [first.no, third.no], p3)
        add('ワイド', [second.no, third.no], p3)
      }
    }
  }
  return totals
}

export function buildTickets(field, odds, earlierOdds, entries, budget, anchor = null, minimumHit = 0.10, allowFrames = true) {
  const frames = allowFrames ? frameNumbers(field.map(horse => horse.no)) : new Map()
  const probabilities = outcomeProbabilities(field, frames)
  const singles = field.filter(horse => odds[horse.no] >= 1).map(horse => ({
    type: '単勝', numbers: [horse.no], odds: odds[horse.no], before: earlierOdds[horse.no],
  }))
  const evaluated = [...singles, ...entries].filter(ticket => anchor === null
    || ticket.numbers.includes(ticket.type === '枠連' ? frames.get(anchor) : anchor))
    .flatMap(ticket => {
      const key = ticketKey(ticket.type, ticket.numbers)
      const probability = probabilities.get(key)
      if (probability == null) return []
      const movement = ticket.before >= 1 ? ticket.odds / ticket.before - 1 : null
      const lower = Math.max(1, ticket.odds * (1 + Math.max(-0.25, Math.min(-0.10, movement ?? 0))))
      const conservativeProbability = Math.min(1, 0.85 * probability)
      const expectedReturn = lower * conservativeProbability
      return [{ ...ticket, key, pair: ticket.numbers.join(orderedTypes.has(ticket.type) ? '→' : '−'),
        reason: '能力・適性・展開から試算', movement, lower, conservativeProbability,
        lossProbability: 1 - conservativeProbability,
        expectedReturn, qualifies: expectedReturn > 1 && conservativeProbability >= minimumHit }]
    })
  const byWin = new Map(evaluated.filter(ticket => ticket.type === '単勝').map(ticket => [ticket.numbers[0], ticket]))
  for (const place of evaluated.filter(ticket => ticket.type === '複勝')) {
    const win = byWin.get(place.numbers[0])
    if (!win) continue
    const expectedReturn = (win.expectedReturn + place.expectedReturn) / 2
    const lossProbability = place.lower >= 2 ? 1 - place.conservativeProbability : 1 - win.conservativeProbability
    evaluated.push({ ...place, type: '応援馬券', key: ticketKey('応援馬券', place.numbers), odds: null, lower: null,
      movement: null, expectedReturn, lossProbability,
      qualifies: expectedReturn > 1 && place.conservativeProbability >= minimumHit })
  }
  evaluated.sort((a, b) => b.expectedReturn - a.expectedReturn || a.lossProbability - b.lossProbability)

  const limit = Math.floor(budget / 200) * 100
  for (const ticket of evaluated.filter(item => item.qualifies)) {
    // 応援馬券は単勝・複勝に100円ずつ。その他は既存の配分計算を使用。
    const stake = ticket.type === '応援馬券'
      ? (limit >= 200 ? 200 : 0)
      : Math.min(limit, Number(allocateTickets([ticket], budget)[0].stake))
    if (stake > 0) return { evaluated, tickets: [{ ...ticket, stake }] }
  }
  return { evaluated, tickets: [] }
}
