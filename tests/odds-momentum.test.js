import test from 'node:test'
import assert from 'node:assert/strict'
import { oddsMomentum } from '../src/oddsMomentum.js'
import { assessAnchorCandidates } from '../src/anchorAssessment.js'

const race = { id: 'TEST11', raceDate: '20261115', postTime: '1540' }
const field = [.4, .3, .2, .1].map((probability, i) => ({ no: i + 1, probability }))
const snapshot = (minute, odds, extra = {}) => ({ schemaVersion: 2, id: `s-${minute}`, kind: 'observed',
  raceId: race.id, raceDate: race.raceDate, time: `15:${minute}`, observedAt: `2026-11-15T06:${minute}:00Z`,
  sourcePublishedAt: `2026-11-15T06:${minute}:00Z`, retrievedAt: `2026-11-15T06:${minute}:00Z`, odds, ...extra })
const old = snapshot('10', { 1: 4, 2: 3, 3: 5, 4: 12 })
const current = snapshot('20', { 1: 2, 2: 3, 3: 5, 4: 12 })
test('price shortening, support share and popularity movement remain separate from value', () => {
  const trend = oddsMomentum({ race, field, current, events: [old, current] })
  const row = trend.rows.get(1)
  assert.equal(row.priceChange, -.5)
  assert.ok(row.shareChange > 0)
  assert.equal(row.previousRank, 2)
  assert.equal(row.currentRank, 1)
  assert.equal(row.rising, true)
  assert.ok(assessAnchorCandidates({ field, odds: old.odds }).suggested.includes(1))
  assert.ok(!assessAnchorCandidates({ field, odds: current.odds }).suggested.includes(1))
  // A price falling by the same proportion as the entire field gains no relative support.
  const same = snapshot('20', { 1: 2, 2: 1.5, 3: 2.5, 4: 6 })
  assert.equal(oddsMomentum({ race, field, current: same, events: [old] }).rows.get(1).rising, false)
})
test('trend ignores late corrections, other races, future times, baselines and incomplete fields', () => {
  const late = { ...old, id: 'late', odds: { ...old.odds, 1: 1.5 }, retrievedAt: '2026-11-15T06:25:00Z' }
  const other = { ...old, id: 'other', raceId: 'OTHER', retrievedAt: '2026-11-15T06:19:00Z' }
  const result = oddsMomentum({ race, field, current, events: [old, late, other, snapshot('30', current.odds)] })
  assert.equal(result.reference.id, old.id)
  assert.equal(result.rows.get(1).priceChange, -.5)
  for (const events of [[], [current], [{ ...old, kind: 'baseline' }], [{ ...old, raceDate: '20261114' }],
    [{ ...old, odds: { 1: 3 } }], [{ time: '15:10', odds: old.odds }]]) {
    assert.equal(oddsMomentum({ race, field, current, events }).reference, null)
  }
  assert.equal(oddsMomentum({ race, field, current: { ...current, retrievedAt: null }, events: [old] }).reference, null)
})
