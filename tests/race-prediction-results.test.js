import {createGroupRegistration} from '../src/groupRegistration.js'
import test from 'node:test'
import assert from 'node:assert/strict'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
import {createPrediction,createJournalResult} from '../src/predictionJournal.js'
import {racePredictionRows,raceGroupTally} from '../src/racePredictionResults.js'
const at='2026-11-15T06:25:00Z',date=race.raceDate
const create=(id='saved',extra={})=>createPrediction({race,field:horses.map(({no,name})=>({no,name})),snapshot:{...demoSnapshots()[2],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}},slots:[['A'],['C'],['C']],type:'3連単',...extra},at,id)
const result=(raceId=race.id,numbers=[1,3,5],id='result')=>createJournalResult({raceId,raceDate:date,numbers,payouts:[{type:'3連単',per100:12340}]},'2026-11-15T07:00:00Z',id)
test('all races remain visible without predictions and with missing results',()=>{
 const races=[{...race,place:'京都'},{...race,id:'second',place:'東京',raceNo:12,postTime:'1550'},{...race,id:'future',postTime:'1600'}]
 const rows=racePredictionRows({raceDate:date,races,plans:[create()],results:[result(),result('second',[4,2,7],'second-result')]})
 assert.deepEqual(rows.map(r=>r.race.id),[race.id,'second','future']);assert.equal(rows[1].plan,null);assert.equal(rows[1].result.payouts[0].per100,12340);assert.equal(rows[2].result,null)
 assert.deepEqual(rows[0].view.resultGroups,['A','B','C']);assert.equal(rows[0].view.hit,false)
})
test('latest prediction per race is compared with its own frozen grouping and counted once',()=>{
 const first=create(),second=create('second-plan',{slots:[['A'],['B'],['C']]})
 const rows=racePredictionRows({raceDate:date,plans:[first,second],results:[result()],registrations:[createGroupRegistration(first,at,'independent')]})
 assert.equal(rows.length,1);assert.equal(rows[0].plans.length,2);assert.equal(rows[0].view.hit,true);assert.equal(raceGroupTally(rows).count,1)
})
test('other dates cannot leak into comparisons or add a phantom race',()=>{
 const rows=racePredictionRows({raceDate:date,races:[{...race,raceDate:'20261114'}],plans:[],results:[{...result(),raceDate:'20261114'}]})
 assert.deepEqual(rows,[])
})
test('conflicting image/official results hold the row and do not enter tendency totals',()=>{
 const rows=racePredictionRows({raceDate:date,plans:[create()],results:[result()],official:[{...result(),numbers:[3,1,5],source:'jrdb'}]})
 assert.equal(rows[0].view.state,'held');assert.equal(rows[0].result.conflict,true);assert.equal(raceGroupTally(rows).count,0)
})
test('catalog metadata labels legacy plans without overwriting saved group membership',()=>{
 const plan=create(),before=structuredClone(plan)
 const rows=racePredictionRows({raceDate:date,plans:[plan],races:[{...race,placeCode:'05',raceNo:1,name:'更新後の名称'}],results:[result()]})
 assert.equal(rows[0].race.place,'東京');assert.equal(rows[0].race.raceNo,1);assert.equal(rows[0].plan.grouping.membership[1],'A');assert.deepEqual(plan,before)
})
