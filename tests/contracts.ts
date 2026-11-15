import { buildAbilityField, analyzeMarket } from '../src/marketModel.js'
import { buildPortfolio, parseQuotes } from '../src/portfolio.js'
import { decisionCutoff, snapshotTiming } from '../src/raceTime.js'

// Compile actual exported JS signatures against the interfaces used by the UI.
const race = { id: 'synthetic', raceDate: '20260101', fieldSize: 5, postTime: '1540' }
const horses = [1,2,3,4,5].map(no => ({ no, name: `synthetic-${no}`, idm: 60-no, frameNo:no }))
const ability = buildAbilityField({ race, horses, statistics: [] })
const field: Array<{ no: number; probability: number; idm: number | null }> = ability.field
const prices = analyzeMarket({ field, odds: { 1:3,2:4,3:6,4:8,5:12 }, priceFactor: 0.9 })
const total: boolean = prices.complete
const parsed = parseQuotes('馬連 1-2 9.0',field)
const portfolio = buildPortfolio({ field, quotes: parsed.quotes, budget:10000, profile:'balanced' })
const result: { invested: number; expectedReturn: number | null } = portfolio.metrics
const cutoff: string | null = decisionCutoff(race)
const eligible: boolean = snapshotTiming(null,race).eligible
void [result,total,cutoff,eligible]
