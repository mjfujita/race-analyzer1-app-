import test from 'node:test'
import assert from 'node:assert/strict'
import { calibrateForecast, reviewStack, validCalibrationEvidence } from '../src/forecastReview.js'
import { decisionCutoff } from '../src/raceTime.js'

const race = { id: 'race', raceDate: '20260101', postTime: '1540' }
const cutoffAt = decisionCutoff(race)
const before = '2026-01-01T06:20:00Z'
const stack = reviewStack({ ability: 'base' })
const current = { raceId: race.id, observedAt: before, retrievedAt: before, sourcePublishedAt: before }
const raw = { field: [{ no: 1, pStar: .8, probability: .8 }, { no: 2, pStar: .2, probability: .2 }] }
const model = { stack, testedThrough: '20251231', activatedAt: '2026-01-01T03:00:00Z',
  temperature: 2, id: 'win-temp-1234567890abcdef12345678' }
const review = { active: [model], receivedAt: before }

test('only compatible calibration known by the deadline is applied and the raw probability is recorded', () => {
  const args = { review, stack, race, current, cutoffAt, now: Date.parse(before) + 1000 }
  const calibrated = calibrateForecast(raw, args)
  assert.ok(Math.abs(calibrated.field[0].probability - 2 / 3) < 1e-12)
  assert.equal(calibrated.field[0].pStar, .8)
  assert.equal(calibrated.calibrationId, model.id)
  const inputs = { probabilityStack: stack, probabilityCalibration: model.id, probabilityTemperature: 2 }
  assert.equal(validCalibrationEvidence({ inputs, field: calibrated.field }), true)
  assert.equal(validCalibrationEvidence({ inputs, field: raw.field }), false)
  for (const change of [
    { stack: 'unknown' }, { review: { ...review, active: [] } }, { now: Date.parse(cutoffAt) + 1 },
    { review: { ...review, receivedAt: '2026-01-01T06:40:00Z' } },
    { review: { ...review, active: [{ ...model, testedThrough: race.raceDate }] } },
    { current: { ...current, retrievedAt: '2026-01-01T06:40:00Z' } },
  ]) assert.equal(calibrateForecast(raw, { ...args, ...change }), raw)
})
