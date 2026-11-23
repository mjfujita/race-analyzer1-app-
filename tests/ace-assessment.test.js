import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAceAssessment} from '../src/aceAssessment.js'
import {race,horses,statistics,demoSnapshots} from '../dev/fixtures.js'

const now=Date.parse('2026-11-15T06:25:00Z')
const run=(date='20261101',rank=1)=>({date,rank,field_size:12,dist:'芝2200m',placeCode:'08',going:'良'})
const field=horses.map(h=>({...h,jockey:'架空騎手',trainer:'架空厩舎',weightCarried:55,pastRuns:[run(),run('20261020',2),run('20261010',4)]}))
const source=(time='2026-11-15T06:22:00Z',changes={})=>({raceId:race.id,raceDate:race.raceDate,retrievedAt:time,observedAt:time,availabilityAt:time,timingEvidence:'observed-visible-at',weather:'晴',going:'良',
  horses:field.map(h=>({horseNo:h.no,paddockIndex:0,horseWeight:480,horseWeightDelta:0})),paddockComments:[{horseNo:1,text:'架空の歩様コメント'}],...changes})
const build=changes=>buildAceAssessment({race,horses:field,statistics:statistics.map(s=>({...s,training_idx:50})),events:demoSnapshots(),now,cloud:{context:source()},...changes})

test('ACE reviews every horse and all eight material categories without inventing learned bonuses',()=>{
  const report=build(),one=report.rows[0]
  assert.equal(report.rows.length,8)
  assert.equal(one.factors.length,8)
  assert.equal(one.knownCount,8)
  assert.equal(one.role,'勝ち候補として比較')
  assert.match(report.summary,/1番/)
  assert.ok(one.probabilities.win>0&&one.probabilities.top3>one.probabilities.win)
  assert.ok(Math.abs(one.probabilities.top3-one.probabilities.win-one.probabilities.second-one.probabilities.third)<1e-10)
  assert.match(one.factors.find(f=>f.key==='paddock').text,/パドック点0/)
  assert.match(one.factors.find(f=>f.key==='connections').text,/架空騎手/)
  assert.match(one.factors.find(f=>f.key==='market').text,/期待回収率試算/)
  assert.deepEqual(report.appliedFeatures,[])
  const trainingChanged=build({statistics:statistics.map(s=>({...s,training_idx:99})),cloud:{context:source(undefined,{horses:field.map(h=>({horseNo:h.no,paddockIndex:9,horseWeight:500})),paddockComments:[{horseNo:1,text:'調子が良いという取得コメント'}]})}})
  assert.deepEqual(trainingChanged.rows.map(h=>h.probabilities),report.rows.map(h=>h.probabilities))
  assert.notEqual(trainingChanged.rows[0].factors.find(f=>f.key==='paddock').text,one.factors.find(f=>f.key==='paddock').text)
})

test('future, post-cutoff, wrong-race, result and payout information cannot change ACE predictions',()=>{
  const early=source(),base=build({now:Date.parse('2026-11-15T07:00:00Z'),cloud:{context:early}})
  const late=source('2026-11-15T06:45:00Z',{going:'重',horses:[{horseNo:1,paddockIndex:99}],results:[{horseNo:8,rank:1}],finalWinOdds:{8:1.1}})
  const changed=build({now:Date.parse('2026-11-15T07:00:00Z'),cloud:{context:late,observations:[{kind:'LIVE_RACE',payload:early},{kind:'LIVE_RACE',payload:late},
    {kind:'LIVE_RACE',payload:source('2026-11-15T06:28:00Z',{raceId:'another',going:'不良'})},{kind:'HJC',payload:{raceId:race.id,payouts:[{horseNo:8,per100:99999}]}}]},
    events:[...demoSnapshots(),{...demoSnapshots()[1],id:'late-snapshot',retrievedAt:'2026-11-15T06:45:00Z',observedAt:'2026-11-15T06:45:00Z',sourcePublishedAt:'2026-11-15T06:45:00Z',time:'15:45',odds:{1:100,2:1.1}}]})
  assert.deepEqual(changed.rows,base.rows)
  assert.deepEqual(changed.outcomes,base.outcomes)
  assert.ok(changed.source.retrievedAt<=changed.boundary)
  const futureRuns=build({horses:field.map(h=>({...h,pastRuns:[run('20261116',1),run('20261115',1),...h.pastRuns]}))})
  // Extra source exclusions may be reported elsewhere; prediction and inspected valid starts are unchanged.
  assert.deepEqual(futureRuns.rows,build().rows)
})

test('selected observation boundary gates models, weather, paddock and later odds; undated odds do not price an edge',()=>{
  const early=source('2026-11-15T06:10:00Z'),late=source()
  const report=build({asOf:'2026-11-15T06:15:00Z',cloud:{context:late,observations:[{kind:'LIVE_RACE',payload:early}]},model:{schemaVersion:1,modelType:'idm-temperature',id:'future',status:'research',temperature:1,
    trainedThrough:'2026-11-14',generatedAt:'2026-11-15T06:20:00Z',adoptedAt:'2026-11-15T06:22:00Z'}})
  assert.equal(report.source.retrievedAt,early.retrievedAt)
  assert.equal(report.current.id,'demo-0')
  assert.equal(report.model.id,'idm-temperature-baseline-v1')
  const undated=build({events:[{kind:'observed',id:'legacy',time:'15:20',odds:{1:2}}]})
  assert.equal(undated.current,null)
  assert.equal(undated.rows[0].expectedReturn,null)
  assert.match(undated.rows[0].concerns.join(' '),/投資妙味は判定保留/)
})

test('missing field, no history, new horses and cancellations hold axis judgment without made-up chances',()=>{
  const missing=build({statistics:[],horses:field.map(h=>({...h,idm:null}))})
  assert.ok(missing.rows.every(h=>h.role==='軸判断を保留'&&h.probabilities===null))
  const noHistory=build({horses:field.map(h=>({...h,pastRuns:[]}))})
  assert.ok(noHistory.rows.every(h=>h.held&&h.probabilities===null))
  const debut=build({race:{...race,name:'２歳新馬'}})
  assert.ok(debut.rows.every(h=>h.held&&h.probabilities===null))
  const cancelled=build({horses:field.map(h=>({...h,cancelled:h.no===1}))})
  assert.equal(cancelled.rows[0].role,'出走対象外')
  assert.equal(cancelled.rows[0].probabilities,null)
})

test('time-proven TYB is examined per horse without mixing a late record or another horse comment',()=>{
  const tyb={raceId:race.id,raceDate:race.raceDate,horseNo:1,paddockIndex:3,horseWeight:490,horseWeightDelta:10,
    retrievedAt:'2026-11-15T06:24:00Z',observedAt:'2026-11-15T06:24:00Z',sourcePublishedAt:'2026-11-15T06:24:00Z'}
  const report=build({cloud:{context:source(),observations:[{kind:'TYB',payload:tyb},{kind:'TYB',payload:{...tyb,horseNo:2,paddockIndex:7}},
    {kind:'TYB',payload:{...tyb,paddockIndex:99,retrievedAt:'2026-11-15T06:45:00Z'}}]}})
  assert.match(report.rows[0].factors.find(f=>f.key==='paddock').text,/パドック点3/)
  assert.match(report.rows[0].factors.find(f=>f.key==='paddock').text,/架空の歩様コメント/)
  assert.match(report.rows[0].factors.find(f=>f.key==='paddock').text,/TYB 11\/15 15:24/)
  assert.match(report.rows[1].factors.find(f=>f.key==='paddock').text,/パドック点7/)
  assert.ok(!report.rows[0].factors.find(f=>f.key==='paddock').text.includes('99'))
})

test('equivalent going codes are compared, while unknown past going is reported as missing',()=>{
 const coded=build({horses:field.map(h=>({...h,pastRuns:h.pastRuns.map(r=>({...r,going:'2',weather:'雨'}))})),cloud:{context:source(undefined,{going:'稍重',weather:'雨'})}})
 assert.match(coded.rows[0].factors.find(f=>f.key==='conditions').text,/同区分・同馬場の取得近走は3走/)
 const unknown=build({horses:field.map(h=>({...h,pastRuns:h.pastRuns.map(r=>({...r,going:null}))}))})
 assert.match(unknown.rows[0].factors.find(f=>f.key==='conditions').text,/同馬場の比較材料は未取得/)
})
