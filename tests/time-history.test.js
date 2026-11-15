import test from 'node:test'
import assert from 'node:assert/strict'
import { raceTimestamp, decisionCutoff, snapshotTiming, raceDateISO } from '../src/raceTime.js'
import { createOddsSnapshot, appendOddsSnapshot, readOddsEvents, readOddsHistory, importOddsSnapshots } from '../src/oddsHistory.js'
import { validateModel } from '../src/modelStore.js'
import { readPaceResults, recordedPaceRows } from '../src/paceHistory.js'
const race = { id: 'test', raceDate: '20260101', postTime: '1540' }
const store = () => { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) } }
const snapshot = (time='15:20', retrievedAt='2026-01-01T06:20:00.000Z') => createOddsSnapshot({ race, time, odds: { 1: 5, 2: 3 }, retrievedAt })

test('JST cutoff rolls across UTC date and rejects impossible input', () => {
  assert.equal(raceTimestamp(race,'15:40'),'2026-01-01T06:40:00.000Z')
  assert.equal(decisionCutoff(race),'2026-01-01T06:30:00.000Z')
  assert.equal(raceDateISO({ raceDate:'20260230' }),null)
  assert.equal(raceTimestamp(race,'24:00'),null)
  assert.equal(raceTimestamp(race,'12:80'),null)
  assert.equal(raceTimestamp({ raceDate:'20260101' },'00:01'),'2025-12-31T15:01:00.000Z')
})
test('past observations obtained after cutoff and unknown publication are not live evidence', () => {
  const row = snapshot()
  assert.equal(snapshotTiming(row,race).eligible,true)
  assert.equal(snapshotTiming({ ...row,retrievedAt:'2026-01-01T06:31:00Z' },race).eligible,false)
  assert.equal(snapshotTiming({ ...row,sourcePublishedAt:null },race).eligible,false)
  assert.equal(snapshotTiming({ ...row,raceId:'another' },race).eligible,false)
  assert.equal(snapshotTiming(snapshot('15:00','2026-01-01T06:00:00Z'),race).eligible,false)
})
test('append-only corrections can reconstruct the record known at cutoff', () => {
  const storage=store();const a=snapshot();appendOddsSnapshot('k',a,storage)
  const b={ ...snapshot('15:20','2026-01-01T06:40:00Z'),odds:{1:6,2:3} }
  appendOddsSnapshot('k',b,storage)
  assert.equal(readOddsEvents('k',storage).length,2)
  assert.equal(readOddsHistory('k',{storage})[0].odds[1],6)
  assert.equal(readOddsHistory('k',{storage,asOf:decisionCutoff(race)})[0].odds[1],5)
  assert.throws(()=>appendOddsSnapshot('k',{...a,sourcePublishedAt:'2026-01-01T06:19:00Z'},storage),/同じID/)
})
test('imports are atomic, idempotent, reject another race and provenance conflict', () => {
  const storage=store();const a=snapshot();assert.equal(importOddsSnapshots('k',[a],race,[1,2],storage),1)
  assert.equal(importOddsSnapshots('k',[a],race,[1,2],storage),0)
  assert.throws(()=>importOddsSnapshots('k',[snapshot(),{...a,id:'bad',raceId:'other'}],race,[1,2],storage))
  assert.equal(readOddsEvents('k',storage).length,1)
  assert.throws(()=>importOddsSnapshots('k',[{...a,source:'other'}],race,[1,2],storage),/同じID/)
  assert.equal(readOddsEvents('k',storage).length,1)
})
test('dated snapshots order by full time, while legacy records cannot enter as-of history', () => {
  const storage=store();const old=createOddsSnapshot({race,time:'23:00',date:'2025-12-31',odds:{1:5},retrievedAt:'2025-12-31T14:01:00Z'})
  appendOddsSnapshot('k',old,storage);appendOddsSnapshot('k',snapshot(),storage)
  assert.equal(readOddsHistory('k',{storage})[0].time,'15:20')
  storage.setItem('legacy',JSON.stringify([{time:'15:20',odds:{1:5}}]))
  assert.equal(readOddsHistory('legacy',{storage}).length,1)
  assert.equal(readOddsHistory('legacy',{storage,asOf:decisionCutoff(race)}).length,0)
})
test('corrupt storage is never replaced and failed writes propagate', () => {
  const storage=store();storage.setItem('k','{bad')
  assert.throws(()=>appendOddsSnapshot('k',snapshot(),storage))
  assert.equal(storage.getItem('k'),'{bad')
  assert.throws(()=>appendOddsSnapshot('k',snapshot(),{getItem:()=>null,setItem:()=>{throw new Error('quota')}}),/quota/)
})
test('model import rejects fake validation and invalid trained dates', () => {
  const m={schemaVersion:1,modelType:'idm-temperature',id:'m',temperature:8,trainedThrough:'2025-01-01',status:'research',validation:{}}
  assert.equal(validateModel(m),m)
  assert.throws(()=>validateModel({...m,trainedThrough:'2025-02-30'}))
  assert.throws(()=>validateModel({...m,validation:'verified'}))
  assert.throws(()=>validateModel({...m,status:'profitable'}))
})

test('later pace corrections do not hide the evidence available at the decision cutoff', () => {
  const storage=store(); const target={...race,placeCode:'08'}
  const original={id:'first',raceNo:1,field:12,positions:[1,2,3],publishedAt:'2026-01-01T02:01:00Z',retrievedAt:'2026-01-01T02:05:00Z'}
  const revised={...original,id:'later',positions:[10,11,12],revisionOf:'first',retrievedAt:'2026-01-01T07:00:00Z'}
  storage.setItem('pace-events:v2:u:20260101:08',JSON.stringify([original,revised]))
  storage.setItem('pace-results:v1:u:20260101:08',JSON.stringify({2:{field:12,positions:[1,2,3]}}))
  const cutoffAt=decisionCutoff(target)
  const prior=readPaceResults('u',target,{cutoffAt,storage})
  assert.equal(prior[1].id,'first');assert.equal(prior[2],undefined)
  assert.equal(recordedPaceRows([{race_no:1}],prior,{cutoffAt})[0].front_top_count,3)
  assert.equal(readPaceResults('u',target,{storage})[1].id,'later')
})

test('direct visible capture remains eligible without inventing publication, but late capture cannot enter cutoff history', () => {
  const storage=store(), original=snapshot()
  const direct={...original,sourcePublishedAt:null,timingEvidence:'observed-visible-at',availabilityAt:original.retrievedAt}
  assert.equal(importOddsSnapshots('k',[direct],race,[1,2],storage),1)
  assert.equal(snapshotTiming(readOddsEvents('k',storage)[0],race).eligible,true)
  assert.equal(readOddsHistory('k',{storage,asOf:decisionCutoff(race)}).length,1)
  const late={...direct,id:'late',retrievedAt:'2026-01-01T07:00:00Z',availabilityAt:'2026-01-01T07:00:00Z',odds:{1:7,2:3}}
  importOddsSnapshots('k',[late],race,[1,2],storage)
  assert.equal(readOddsHistory('k',{storage,asOf:decisionCutoff(race)})[0].odds[1],5)
  assert.equal(snapshotTiming(late,race).eligible,false)
  assert.throws(()=>importOddsSnapshots('k',[{...direct,id:'false',availabilityAt:'2026-01-01T06:19:00Z'}],race,[1,2],storage))
})

test('equivalent ISO timestamps share a revision group, preserving latest price and cutoff reconstruction',()=>{
  const storage=store(),first=snapshot()
  appendOddsSnapshot('k',first,storage)
  appendOddsSnapshot('k',{...first,id:'iso-revision',observedAt:first.observedAt.replace('.000Z','Z'),odds:{1:7,2:3}},storage)
  const rows=readOddsHistory('k',{storage,asOf:decisionCutoff(race)})
  assert.equal(rows.length,1)
  assert.equal(rows[0].odds[1],7)
  assert.equal(rows[0].revisionOf,first.id)
})
