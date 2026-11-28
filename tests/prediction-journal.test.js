import test from 'node:test'
import assert from 'node:assert/strict'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
import {createPrediction,validatePrediction,createJournalResult,reviewPrediction,mergeJournal,latestResult,readJournal,journalKey,resolvedResult} from '../src/predictionJournal.js'
import {createCompanionService,createCompanionHandler} from '../server/companion.js'
import {memoryStore,request} from './fixtures/companion.js'
const field=horses.map(({no,name})=>({no,name})),at='2026-11-15T06:25:00Z'
const snapshot={...demoSnapshots()[2],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}
const input=()=>({race,field,snapshot,slots:[['B'],['A'],[]],type:'馬単',excluded:[],threshold:1.5,boundaries:null})
const plan=()=>createPrediction(input(),at,'plan-test')
const result=(more={})=>createJournalResult({raceId:race.id,raceDate:race.raceDate,numbers:[3,1,5],payouts:[{type:'馬単',per100:4560}],...more},'2026-11-15T07:00:00Z','result-test')
test('selection freezes grouping and tickets without stakes or budget and validates tampering',()=>{
 const p=plan();assert.equal(p.tickets.length,4);assert.equal(p.invested,undefined);assert.equal(p.budget,undefined);assert.ok(p.tickets.every(t=>!Object.hasOwn(t,'stake')))
 validatePrediction(p);const changed=structuredClone(p);changed.tickets.pop();assert.throws(()=>validatePrediction(changed))
 input().snapshot.odds[3]=4;assert.equal(p.snapshot.odds[3],8);snapshot.odds[3]=8
})
test('large formations are not capped by an invented 10000 yen budget; duplicate horses removed',()=>{
 const p=createPrediction({...input(),boundaries:[],type:'3連単',slots:[['A'],['A'],['A']]},at)
 assert.equal(p.tickets.length,336);assert.ok(p.tickets.every(t=>new Set(t.numbers).size===3))
})
test('top-three-only results compare exacta/trio correctly, without invented lower ranks',()=>{
 const p=plan(),r=result(),v=reviewPrediction(p,r);assert.equal(v.hit,true);assert.deepEqual(v.resultGroups,['B','A','C']);assert.equal(v.payout,4560);assert.equal(v.positions[0].horses.length,2)
 const trio=createPrediction({...input(),type:'3連複',slots:[['A'],['B'],['C']]},at)
 assert.equal(reviewPrediction(trio,result({numbers:[5,3,1]})).hit,true)
 assert.equal(reviewPrediction(p,result({numbers:[1,3,5]})).hit,false)
})
test('unknown horses, held results and payout gaps never become positive settlement claims',()=>{
 assert.equal(reviewPrediction(plan(),result({numbers:[18,1,5]})).state,'held')
 assert.equal(reviewPrediction(plan(),result({status:'held',payouts:[]})).hit,null)
 assert.equal(reviewPrediction(plan(),result({payouts:[]})).payout,null)
 assert.throws(()=>result({numbers:[3,3,5]}));assert.throws(()=>result({payouts:[{type:'馬単',per100:4.5}]}))
})
test('corrections retain originals and reject competing branches or missing parents',()=>{
 const r=result(),r2=createJournalResult({...r,replacesId:r.id,numbers:[1,3,5]},'2026-11-15T07:10:00Z','corrected')
 const both=mergeJournal({predictions:[],results:[r]},{predictions:[],results:[r2]});assert.equal(both.results.length,2);assert.equal(latestResult(both.results,race.id).id,'corrected')
 assert.throws(()=>mergeJournal({predictions:[],results:[]},{predictions:[],results:[r2]}))
 const r3={...r2,id:'competing'};assert.throws(()=>mergeJournal(both,{predictions:[],results:[r3]}))
})
test('corrupted local cache is reported and never silently reset',()=>{
 const data=new Map([[journalKey('owner',race.raceDate),'{broken']]),storage={getItem:k=>data.get(k)}
 assert.throws(()=>readJournal(storage,'owner',race.raceDate));assert.equal(data.values().next().value,'{broken')
})
test('manual/JRDB differences hold matching; missing payout types can be filled by official source',()=>{
 const r=result(),official={...r,source:'jrdb',payouts:[{type:'馬単',per100:4560},{type:'3連単',per100:5550}]}
 assert.equal(resolvedResult(r,official).payouts.length,2)
 assert.equal(resolvedResult(r,{...official,numbers:[1,3,5]}).conflict,true)
 assert.equal(resolvedResult(r,{...official,payouts:[{type:'馬単',per100:999}]}).status,'held')
})
async function setup(){
 const store=memoryStore(),ownerId='journal-owner',service=createCompanionService({store,ownerId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:at,status:{state:'ready',lastRunAt:at},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:[snapshot],observations:[]}]})
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateUser:async token=>token==='owner-token'?{id:ownerId}:{id:'other'}})
 return {service,handler,store}
}
test('authenticated journal writes/readback are immutable, scoped, idempotent and do not create purchases',async()=>{
 const {handler,store}=await setup(),p=plan()
 assert.equal((await request(handler,{method:'POST',token:null,body:{action:'save-journal',record:p}})).status,401)
 assert.equal((await request(handler,{method:'POST',token:'other-token',body:{action:'save-journal',record:p}})).status,403)
 const save=()=>request(handler,{method:'POST',body:{action:'save-journal',record:p}})
 const first=await save();assert.equal(first.status,200);assert.deepEqual(await save(),first)
 const bad={...p,note:'changed'};assert.equal((await request(handler,{method:'POST',body:{action:'save-journal',record:bad}})).status,409)
 const response=await request(handler,{query:{journal:'1',raceDate:race.raceDate}})
 assert.equal(response.status,200);assert.deepEqual(response.body.predictions,[p]);assert.equal(response.body.receipts[p.id],'2026-11-15T07:15:00.000Z')
 assert.ok([...store.files.keys()].every(k=>!k.includes('/purchases/')&&!k.includes('/settlements/')))
})
test('result API supports correction, denies stale parent, field mismatch and future receipt spoofing',async()=>{
 const {handler}=await setup(),save=record=>request(handler,{method:'POST',body:{action:'save-journal',record}}),r=result()
 assert.equal((await save(r)).status,200)
 const next=createJournalResult({...r,replacesId:r.id,numbers:[1,3,5]},'2026-11-15T07:10:00Z','correction')
 assert.equal((await save(next)).status,200);assert.equal((await save({...next,id:'stale'})).status,409)
 assert.equal((await save({...plan(),createdAt:'2026-11-15T08:00:00Z'})).status,400)
 assert.equal((await save(createJournalResult({...r,raceId:'unknown'},r.createdAt,'unknown-race'))).status,400)
 const day=await request(handler,{query:{journal:'1',raceDate:race.raceDate}});assert.equal(day.body.results.length,2)
})
test('server refuses fabricated source odds or start time, and never writes unverified predictions',async()=>{
 const {handler}=await setup()
 const changedOdds=createPrediction({...input(),snapshot:{...snapshot,odds:{...snapshot.odds,3:8.2}}},at,'fake-odds')
 const changedPost=createPrediction({...input(),race:{...race,postTime:'1600'}},at,'fake-post')
 for(const p of [changedOdds,changedPost])assert.equal((await request(handler,{method:'POST',body:{action:'save-journal',record:p}})).status,400)
 const day=await request(handler,{query:{journal:'1',raceDate:race.raceDate}});assert.equal(day.body.predictions.length,0)
})
test('day journal lists multiple race predictions/results separately and preserves revisions per race',async()=>{
 const {service}=await setup(),other={...race,id:'DEMO260812',raceNo:12}
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:at,status:{state:'ready',lastRunAt:at},races:[{raceId:other.id,raceDate:other.raceDate,race:{...other,horses},snapshots:[{...snapshot,raceId:other.id}],observations:[]}]})
 await service.saveJournalRecord(plan())
 await service.saveJournalRecord(createPrediction({...input(),race:other,snapshot:{...snapshot,raceId:other.id}},at,'other-plan'))
 await service.saveJournalRecord(result())
 await service.saveJournalRecord(createJournalResult({...result(),raceId:other.id},'2026-11-15T07:00:00Z','other-result'))
 const day=await service.getPredictionJournal({raceDate:race.raceDate});assert.equal(day.predictions.length,2);assert.equal(day.results.length,2)
 assert.ok(day.predictions.every(p=>latestResult(day.results,p.race.id)))
})
test('server rejects backdated corrections without poisoning existing history',async()=>{
 const {service}=await setup(),r=result();await service.saveJournalRecord(r)
 const tooEarly=createJournalResult({...r,replacesId:r.id},'2026-11-15T06:59:00Z','backdated')
 await assert.rejects(()=>service.saveJournalRecord(tooEarly),/訂正順序/)
 const data=await service.getPredictionJournal({raceDate:race.raceDate});assert.equal(data.results.length,1)
})
