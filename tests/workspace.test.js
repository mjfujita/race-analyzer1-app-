import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_SETTINGS, readSettings, saveSettings } from '../src/workspaceSettings.js'
import { workspaceLedgers, workspaceReview } from '../src/workspaceReview.js'
import { SINGLE_ANCHOR_METHOD } from '../src/anchorAssessment.js'

test('workspace preferences isolate users, reject invalid thresholds, and preserve a corrupt value until explicit save', () => {
  const data = new Map(), storage = { getItem: k => data.get(k), setItem: (k,v) => data.set(k,v) }
  saveSettings('first', { minTop3: 62, stress: 20 }, storage)
  assert.deepEqual(readSettings('first', storage).value, { minTop3: 62, stress: 20 })
  assert.deepEqual(readSettings('second', storage).value, DEFAULT_SETTINGS)
  assert.throws(() => saveSettings('first', { minTop3: NaN, stress: 10 },storage))
  assert.throws(() => saveSettings('first', { minTop3: 50, stress: 81 },storage))
  const [key] = data.keys(); data.set(key, '{broken')
  assert.ok(readSettings('first',storage).error)
  assert.equal(data.get(key),'{broken')
})

test('review excludes replay, missing or late receipts and mismatched outcomes; predictions without purchases never generate ROI', () => {
  const scope = { userId: 'owner', raceId: 'R11', raceDate: '20261115' }
  const forecast = { id: 'decision', kind: 'user', mode: 'live', createdAt:'2026-11-15T06:25:00Z', cutoffAt: '2026-11-15T06:30:00Z',
    parameters: { anchorSelection: { method: SINGLE_ANCHOR_METHOD, selected: 1, decision: 'selected' } }, field: [{ no:1, probability:.6 },{ no:2, probability:.4 }] }
  const ledger = { scope, forecasts:[forecast], purchases:[], settlements:[] }
  const receipt = { ...scope, ownerId: scope.userId, forecastId:'decision', receivedAt:'2026-11-15T06:29:00Z' }
  const review = { races: [{ ...scope, state:'matched', field:[{ no:1,rank:2 },{ no:2,rank:1 }] }] }
  const evaluate = (row=ledger, proof=receipt, results=review) => workspaceReview([row],results, proof ? { decision:proof } : {})
  assert.equal(evaluate().top3Rate,1)
  assert.equal(evaluate().returnRate,null)
  const later = { ...forecast,id:'retrospective',mode:'replay',createdAt:'2026-11-15T07:00:00Z' }
  assert.equal(evaluate({ ...ledger,forecasts:[forecast,later] }).rows[0].forecast.id,'decision')
  assert.equal(evaluate(ledger,null).top3Rate,null)
  assert.equal(evaluate(ledger,{ ...receipt,receivedAt:'2026-11-15T06:31:00Z' }).top3Rate,null)
  assert.equal(evaluate(ledger,{ ...receipt,ownerId:'another-owner' }).top3Rate,null)
  assert.equal(evaluate({ ...ledger, forecasts:[{ ...forecast,mode:'replay' }] }).top3Rate,null)
  assert.equal(evaluate(ledger,receipt,{ races:[{ ...review.races[0],field:[{ no:1,rank:2 }] }] }).top3Rate,null)
  assert.equal(evaluate(ledger,receipt,{ races:[{ ...review.races[0],state:'result-conflict' }] }).top3Rate,null)
})

test('review does not scan another owner and reports unavailable storage rather than inventing empty success', () => {
  const storage = { length:1, key:()=> 'race-forecast-ledger:v1:another:20261115:R11', getItem:()=> { throw Error('must not read') } }
  assert.deepEqual(workspaceLedgers('owner',storage),{ ledgers:[],errors:[] })
  const broken = { get length() { throw Error('disabled') } }
  assert.equal(workspaceLedgers('owner',broken).errors.length,1)
})
