import test from 'node:test'
import assert from 'node:assert/strict'
import {assessHorses,assessmentContext,horsePaddock,assessmentNumber,assessmentTime} from '../src/horseAssessment.js'

const race={id:'05265501',raceDate:'20261115',postTime:'1540',placeCode:'05',surface:'芝',distance:1600,name:'架空の未勝利戦'}
const now=Date.parse('2026-11-15T07:00:00Z')
const run=(date,rank=1,values={})=>({date,rank,field_size:12,dist:'芝1600m',placeCode:'05',going:'良',last3f:34.5,...values})
const source=(time,values={})=>({raceId:race.id,raceDate:race.raceDate,retrievedAt:time,observedAt:time,availabilityAt:time,
  sourcePublishedAt:null,timingEvidence:'observed-visible-at',horses:[{horseNo:1,horseWeight:480,horseWeightDelta:0,paddockIndex:0}],...values})

test('display IDM ranking handles ties, missing values, zero and withdrawals without using popularity',()=>{
  const horses=[{no:1,idm:70,predictedFavRank:6},{no:2,idm:70},{no:3,idm:50},{no:4,idm:0},{no:5,idm:null},{no:6,idm:99,cancelled:true}]
  const rows=assessHorses(race,horses,[],now)
  assert.deepEqual(rows.map(h=>h.rank),[1,1,3,4,null,null])
  assert.equal(rows[0].activeCount,5);assert.equal(rows[0].knownIdms,4)
  assert.match(rows[0].warnings.join(' '),/4\/5頭分/)
  assert.equal(assessHorses(race,[{no:1,idm:42}],[{horse_no:1,race_key:'another',idm:99}],now)[0].idm,42)
  assert.equal(assessmentNumber(null),null);assert.equal(assessmentNumber(''),null);assert.equal(assessmentNumber('0'),0)
  assert.equal(assessmentNumber('9'.repeat(400)),null)
})

test('only dated prior starts feed the latest five records; current, future and unknown dates never improve evaluation',()=>{
  const horse={no:1,idm:60,pastRuns:[run('20261115'),run('20261116'),run('11/01'),run('202611'),run('20260230'),
    run('20261110',2),run('20261108',4),run('20261102',1),run('20261028',3),run('20261020',5),run('20260901',1)]}
  const [row]=assessHorses(race,[horse],[],now)
  assert.deepEqual(row.pastRuns.map(r=>r.date),['20261110','20261108','20261102','20261028','20261020'])
  assert.deepEqual(row.history,{runs:5,first:1,second:1,third:1})
  assert.deepEqual(row.records.distance,{runs:5,topThree:3})
  assert.equal(assessHorses(race,[{no:1,pastRuns:[run('202610')]}],[],now)[0].pastRuns.length,1)
  const changed={...horse,pastRuns:horse.pastRuns.map(r=>r.date==='20261116'?{...r,rank:12}:r)}
  assert.deepEqual(assessHorses(race,[changed],[],now)[0],row)
})

test('condition evidence separates surface, distance and venue; unverified aggregates do not invent past results',()=>{
  const [row]=assessHorses(race,[{no:1,idm:60,pastRuns:[run('20261110',1),run('20261101',2,{dist:'ダ1600m'}),
    run('20261020',4,{dist:'芝1800m',placeCode:'03'}),run('20261010',3,{dist:'芝2000m'})]}],[],now)
  assert.deepEqual(row.records.distance,{runs:2,topThree:1})
  assert.deepEqual(row.records.venue,{runs:2,topThree:2})
  assert.deepEqual(row.records.course,{runs:1,topThree:1})
  const [empty]=assessHorses({...race,name:'２歳新馬'},[{no:1,pastRuns:[]}],[{horse_no:1,distance_runs:10,distance_top3:10}],now)
  assert.equal(empty.records.distance.runs,null);assert.match(empty.warnings[0],/新馬戦/)
})

test('assessment is display-only and unchanged when betting odds or model probability changes',()=>{
  const horse={no:1,idm:60,pF:.2,winOdds:4,pastRuns:[run('20261110',2)]},before=structuredClone(horse)
  const row=assessHorses(race,[horse],[],now)
  assert.deepEqual(assessHorses(race,[{...horse,pF:.8,winOdds:99}],[],now),row)
  assert.deepEqual(horse,before)
  assert.equal('probability' in row[0],false)
})

test('paddock selection defaults to information known at T10; later references are deliberate and never cross races',()=>{
  const early=source('2026-11-15T06:20:00Z'),late=source('2026-11-15T06:35:00Z',{horses:[{horseNo:1,paddockIndex:9}]}),
    wrong=source('2026-11-15T06:25:00Z',{raceId:'different'}),future=source('2026-11-15T08:00:00Z')
  const cloud={context:late,observations:[early,late,wrong,future].map(payload=>({kind:'LIVE_RACE',payload}))}
  const limited=assessmentContext(race,cloud,{now})
  assert.equal(limited.source.retrievedAt,early.retrievedAt);assert.equal(limited.hasLater,true);assert.equal(limited.referenceOnly,false)
  const latest=assessmentContext(race,cloud,{beforeCutoff:false,now})
  assert.equal(latest.source.retrievedAt,late.retrievedAt);assert.equal(latest.referenceOnly,true)
  assert.equal(assessmentContext(race,{context:{...early,retrievedAt:null}},{now}).source,null)
  assert.equal(assessmentContext(race,{context:{...early,observedAt:'2026-11-15T09:00:00Z'}},{now}).source,null)
  assert.equal(assessmentContext(race,{context:early},{now,asOf:'2026-11-15T06:15:00Z'}).source,null)
  assert.equal(assessmentContext(race,{context:early},{now,asOf:'2026-11-15T06:15:00Z',beforeCutoff:false}).referenceOnly,true)
})

test('zero paddock points and weight delta are valid, missing values and other horses comments remain distinct',()=>{
  const data=horsePaddock(source('2026-11-15T06:20:00Z',{paddockComments:[{horseNo:2,text:'別の馬'},{horseNo:1,text:'取得したコメント'}]}),1)
  assert.equal(data.index,0);assert.equal(data.delta,0);assert.equal(data.weight,480);assert.deepEqual(data.comments,['取得したコメント'])
  assert.deepEqual(horsePaddock(null,1),{weight:null,delta:null,index:null,screenIdm:null,comments:[]})
  assert.equal(horsePaddock({horses:{bad:true},paddock:'bad'},1).weight,null)
})

test('JRDB tenths and already-normalized seconds display consistently without mutating source records',()=>{
 assert.equal(assessmentTime(366),36.6)
 assert.equal(assessmentTime(34.5),34.5)
 assert.equal(assessmentTime(360,'tenths'),36)
 assert.equal(assessmentTime(36,'seconds'),36)
 assert.equal(assessmentTime(366,'seconds'),null)
 assert.equal(assessmentTime(366,'milliseconds'),null)
 assert.equal(assessmentTime(0),null)
 const horse={no:1,idm:60,pastRuns:[run('20261110',2,{last3f:366,front3f:352})]}
 const before=structuredClone(horse),[row]=assessHorses(race,[horse],[],now)
 assert.equal(row.pastRuns[0].last3f,36.6)
 assert.equal(row.pastRuns[0].front3f,35.2)
 assert.deepEqual(horse,before)
 const [raw]=assessHorses(race,[{no:1,pastRuns:[{...run('20261110'),last3f:undefined,last_3f:366}]}],[],now)
 assert.equal(raw.pastRuns[0].last3f,36.6)
})
