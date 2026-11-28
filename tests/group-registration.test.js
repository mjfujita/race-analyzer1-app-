import test from 'node:test'
import assert from 'node:assert/strict'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
import {createGroupRegistration,validateGroupRegistration,mergeGroupRegistrations,latestGroupRegistration,readGroupRegistrations,writeGroupRegistrations,registrationKey,reviewRegisteredGroups} from '../src/groupRegistration.js'
import {createPrediction,createJournalResult,mergeJournal} from '../src/predictionJournal.js'
import {racePredictionRows,raceGroupTally} from '../src/racePredictionResults.js'
import {createCompanionService,createCompanionHandler} from '../server/companion.js'
import {memoryStore,request} from './fixtures/companion.js'
const at='2026-11-15T06:25:00Z',field=horses.map(({no,name})=>({no,name}))
const snapshot={...demoSnapshots()[2],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}
const input={race,field,snapshot},create=(extra={},id='registered',time=at)=>createGroupRegistration({...input,...extra},time,id)
const result=createJournalResult({raceId:race.id,raceDate:race.raceDate,numbers:[1,3,5]},'2026-11-15T07:00:00Z','result')
test('classification retains all horses without creating any prediction, ticket or finishing-order choice',()=>{
 const record=create({excluded:[3],slots:[['A'],['C'],[]]})
 validateGroupRegistration(record)
 assert.equal(Object.keys(record.grouping.membership).length,8)
 for(const key of ['excluded','slots','type','tickets','budget','allocations','method'])assert.equal(record[key],undefined)
 const rows=racePredictionRows({raceDate:race.raceDate,registrations:[record],results:[result]})
 assert.equal(rows[0].plan,null);assert.deepEqual(rows[0].groupResult.groups,['A','B','C']);assert.deepEqual(rows[0].groupResult.counts,[2,2,2]);assert.equal(raceGroupTally(rows).count,1)
})
test('re-registration updates results independently and never rewrites a frozen prediction',()=>{
 const plan=createPrediction({...input,type:'3連単',slots:[['A'],['B'],['C']]},at,'prediction'),before=structuredClone(plan)
 const first=create(),second=create({boundaries:[5],replacesId:first.id},'updated','2026-11-15T07:01:00Z')
 const registrations=mergeGroupRegistrations([first],[second])
 assert.equal(latestGroupRegistration(registrations,race.id).id,'updated')
 const rows=racePredictionRows({raceDate:race.raceDate,plans:[plan],results:[result],registrations})
 assert.deepEqual(rows[0].groupResult.groups,['A','A','B']);assert.deepEqual(rows[0].groupResult.counts,[4,4,4]);assert.equal(rows[0].view.hit,true)
 assert.deepEqual(rows[0].view.resultGroups,['A','B','C']);assert.deepEqual(plan,before);assert.equal(raceGroupTally(rows).count,1)
 assert.deepEqual(raceGroupTally(rows).groups,[['A',[1,1,0]],['B',[0,0,1]]])
})
test('prediction membership is never silently adopted for results and unknown results are held',()=>{
 const plan=createPrediction({...input,type:'馬単',slots:[['A'],['B'],[]]},at,'prediction')
 const rows=racePredictionRows({raceDate:race.raceDate,plans:[plan],results:[result]})
 assert.equal(rows[0].groupResult.state,'unregistered');assert.equal(raceGroupTally(rows).count,0)
 assert.equal(reviewRegisteredGroups(create(),{...result,numbers:[1,3,18]}).state,'held')
 assert.equal(reviewRegisteredGroups(create(),{...result,status:'held'}).state,'held')
 assert.equal(reviewRegisteredGroups(create(),null).state,'pending')
})
test('registration is immutable, rejects missing parents, concurrent branches, cycles and backdating',()=>{
 const first=create(),next=create({replacesId:first.id,boundaries:[]},'next','2026-11-15T06:26:00Z')
 assert.deepEqual(mergeGroupRegistrations([first],[first]),[first])
 assert.throws(()=>mergeGroupRegistrations([first],[{...first,field:[]}]))
 assert.throws(()=>mergeGroupRegistrations([],[next]),/更新元/)
 assert.throws(()=>mergeGroupRegistrations([first,next],[{...next,id:'branch'}]),/別の端末/)
 assert.throws(()=>mergeGroupRegistrations([first],[create({replacesId:first.id},'backdated','2026-11-15T06:24:00Z')]),/更新順序/)
 assert.throws(()=>mergeGroupRegistrations([],[{...first,replacesId:next.id},next]),/更新順序/)
 assert.throws(()=>create({...input,snapshot:{...snapshot,retrievedAt:'2026-11-15T08:00:00Z'}}),/登録時点/)
})
test('separate local storage survives legacy journal writes and refuses to reset corrupt records',async()=>{
 const cache=new Map(),storage={getItem:k=>cache.get(k)??null,setItem:(k,v)=>cache.set(k,v)},locks={request:async(_key,fn)=>fn()}
 await writeGroupRegistrations(storage,'owner',race.raceDate,[create()],locks)
 assert.deepEqual(mergeJournal({predictions:[],results:[]},{predictions:[],results:[],registrations:[]}),{predictions:[],results:[]})
 assert.equal(readGroupRegistrations(storage,'owner',race.raceDate).length,1)
 const key=registrationKey('owner',race.raceDate);storage.setItem(key,'{broken')
 await assert.rejects(()=>writeGroupRegistrations(storage,'owner',race.raceDate,[create()],locks));assert.equal(storage.getItem(key),'{broken')
 await assert.rejects(()=>writeGroupRegistrations(storage,'owner',race.raceDate,[create()],null),/HTTPS/)
})
async function setup(){
 const ownerId='registration-owner',store=memoryStore(),service=createCompanionService({store,ownerId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:at,status:{state:'ready',lastRunAt:at},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:[snapshot],observations:[]}]})
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateUser:async token=>({id:token==='owner-token'?ownerId:'other'})})
 return {handler,service,store}
}
test('owner-only registration API restores on another cache, is idempotent and creates no forecast/purchase',async()=>{
 const {handler,store}=await setup(),record=create(),body={action:'save-groups',record}
 for(const [token,status] of [[null,401],['other-token',403],['collector-secret-0123456789012345',400]])assert.equal((await request(handler,{method:'POST',token,body})).status,status)
 const first=await request(handler,{method:'POST',body});assert.equal(first.status,200);assert.deepEqual(await request(handler,{method:'POST',body}),first)
 const data=await request(handler,{query:{journal:'1',raceDate:race.raceDate}})
 assert.deepEqual(data.body.registrations,[record]);assert.deepEqual(data.body.predictions,[]);assert.equal(data.body.receipts[record.id],'2026-11-15T07:15:00.000Z')
 assert.ok([...store.files.keys()].every(k=>!k.includes('/ledger/')&&!k.includes('/prediction-journal/')))
 const before=structuredClone(data.body.registrations)
 assert.equal((await request(handler,{method:'POST',body:{action:'save-journal',record:result}})).status,200)
 const next=await request(handler,{query:{journal:'1',raceDate:race.raceDate}});assert.deepEqual(next.body.registrations,before)
})
test('API rejects fabricated observations, missing horses, future times and stale device updates',async()=>{
 const {handler}=await setup(),save=record=>request(handler,{method:'POST',body:{action:'save-groups',record}})
 for(const record of [create({snapshot:{...snapshot,odds:{...snapshot.odds,3:8.2}}},'bad-odds'),create({field:field.slice(1)},'bad-field'),create({race:{...race,postTime:'1600'}},'bad-post'),create({},'future','2026-11-15T08:00:00Z')])assert.equal((await save(record)).status,400)
 const first=create(),next=create({replacesId:first.id,boundaries:[]},'next','2026-11-15T07:01:00Z')
 assert.equal((await save(first)).status,200);assert.equal((await save(next)).status,200)
 assert.equal((await save(create({replacesId:first.id,boundaries:[5]},'stale','2026-11-15T07:02:00Z'))).status,409)
 const data=await request(handler,{query:{journal:'1',raceDate:race.raceDate}});assert.equal(data.body.registrations.length,2)
})
test('simultaneous two-device updates cannot form competing histories',async()=>{
 const {service}=await setup(),first=create();await service.saveGroupRegistration(first)
 const updates=[create({replacesId:first.id,boundaries:[]},'device-one','2026-11-15T07:01:00Z'),create({replacesId:first.id,boundaries:[5]},'device-two','2026-11-15T07:01:00Z')]
 const attempts=await Promise.allSettled(updates.map(r=>service.saveGroupRegistration(r)))
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1)
 const day=await service.getPredictionJournal({raceDate:race.raceDate});assert.equal(day.registrations.length,2)
})
test('a verified withdrawal permits all remaining runners, rejects arbitrary omissions and retains frozen earlier registrations',async()=>{
 const {service,handler}=await setup(),first=create()
 await service.saveGroupRegistration(first)
 const activeField=field.filter(h=>h.no!==7),cancelledHorses=horses.map(h=>h.no===7?{...h,cancelled:true}:h)
 const nextSnapshot={...snapshot,id:'after-withdrawal',observedAt:'2026-11-15T06:30:00Z',sourcePublishedAt:'2026-11-15T06:30:00Z',retrievedAt:'2026-11-15T06:30:00Z',time:'15:30',odds:Object.fromEntries(Object.entries(snapshot.odds).filter(([no])=>no!=='7'))}
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:30:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:30:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses:cancelledHorses},snapshots:[nextSnapshot],observations:[]}]})
 const next=createGroupRegistration({race,field:activeField,snapshot:nextSnapshot,replacesId:first.id},'2026-11-15T07:00:00Z','active-runners')
 const save=record=>request(handler,{method:'POST',body:{action:'save-groups',record}})
 const omitted=createGroupRegistration({race,field:activeField.slice(1),snapshot:nextSnapshot,replacesId:first.id},next.createdAt,'omitted-active')
 assert.equal((await save(omitted)).status,400)
 assert.equal((await save(create({replacesId:first.id},'includes-withdrawn',next.createdAt))).status,400)
 assert.equal((await save(next)).status,200);assert.equal((await save(next)).status,200)
 const day=await service.getPredictionJournal({raceDate:race.raceDate})
 assert.deepEqual(day.registrations,[first,next]);assert.equal(first.field.length,8);assert.equal(next.field.length,7)
 assert.equal(next.grouping.membership[7],undefined)
 assert.equal(reviewRegisteredGroups(next,{...result,numbers:[7,1,3]}).state,'held')
 assert.equal(reviewRegisteredGroups(next,result).state,'ready')
})
