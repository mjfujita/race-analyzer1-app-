import test from 'node:test'
import assert from 'node:assert/strict'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
import {automaticResultGroups} from '../src/automaticResultGroups.js'
import {createGroupRegistration} from '../src/groupRegistration.js'
import {createJournalResult} from '../src/predictionJournal.js'
import {racePredictionRows,raceGroupTally} from '../src/racePredictionResults.js'
import {createCompanionService} from '../server/companion.js'
import {memoryStore} from './fixtures/companion.js'
const full={...race,horses},at='2026-11-15T07:00:00Z',now=Date.parse(at)
const snapshot={...demoSnapshots()[2],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}
const result=(id=race.id,numbers=[1,3,5])=>createJournalResult({raceId:id,raceDate:race.raceDate,numbers},at,'result-'+id)
test('all-race classification works without predictions or registrations and never creates either',()=>{
 const automatic=automaticResultGroups(full,[snapshot],[],now)
 assert.equal(automatic.kind,'automatic-result-groups');assert.equal(automatic.timing,'deadline');assert.equal(automatic.tickets,undefined)
 const rows=racePredictionRows({raceDate:race.raceDate,races:[full],results:[result()],automaticGroups:[automatic]})
 assert.equal(rows[0].plan,null);assert.equal(rows[0].registration,null);assert.deepEqual(rows[0].groupResult.groups,['A','B','C'])
 const tally=raceGroupTally(rows);assert.equal(tally.count,1);assert.equal(tally.automatic,1);assert.equal(tally.registered,0);assert.deepEqual(tally.groups.at(-1),['D',[0,0,0]])
})
test('explicit user registration overrides automatic classification without modifying it',()=>{
 const automatic=automaticResultGroups(full,[snapshot],[],now),before=structuredClone(automatic)
 const registration=createGroupRegistration({race,field:horses,snapshot,boundaries:[5]},at,'manual-groups')
 const rows=racePredictionRows({raceDate:race.raceDate,results:[result()],registrations:[registration],automaticGroups:[automatic]})
 assert.deepEqual(rows[0].groupResult.groups,['A','A','B']);assert.equal(raceGroupTally(rows).registered,1);assert.equal(raceGroupTally(rows).automatic,0);assert.deepEqual(automatic,before)
})
test('prefers observed pre-deadline evidence over later prices and clearly labels final-only reference',()=>{
 const live={kind:'LIVE_RACE',eventId:'final',retrievedAt:at,payload:{raceId:race.id,raceDate:race.raceDate,priceStatus:'final-visible',finalWinOdds:{1:8,2:9,3:3,4:3.5,5:20,6:25,7:80,8:100}}}
 const protectedGroup=automaticResultGroups(full,[snapshot],[live],now)
 assert.equal(protectedGroup.snapshot.id,snapshot.id);assert.equal(protectedGroup.grouping.membership[1],'A')
 const reference=automaticResultGroups(full,[],[live],now)
 assert.equal(reference.timing,'reference');assert.equal(reference.snapshot.kind,'final-reference');assert.equal(reference.grouping.membership[1],'B')
 const rows=racePredictionRows({raceDate:race.raceDate,races:[full],results:[result()],automaticGroups:[reference]});assert.equal(raceGroupTally(rows).reference,1)
})
test('wrong dates, future data, missing odds and unknown horses cannot invent a group result',()=>{
 for(const input of [{...snapshot,raceId:'other'},{...snapshot,raceDate:'20261114'},{...snapshot,retrievedAt:'2026-11-16T00:00:00Z'},{...snapshot,odds:{1:3,2:4}}])assert.equal(automaticResultGroups(full,[input],[],now),null)
 const automatic=automaticResultGroups(full,[snapshot],[],now)
 const rows=racePredictionRows({raceDate:race.raceDate,races:[full],results:[result(race.id,[1,3,18])],automaticGroups:[automatic]})
 assert.equal(rows[0].groupResult.state,'held');assert.equal(raceGroupTally(rows).count,0)
})
test('all-same-group finish counts once per race and one time in each finishing position',()=>{
 const automatic=automaticResultGroups(full,[{...snapshot,odds:Object.fromEntries(horses.map(h=>[h.no,3]))}],[],now)
 const rows=racePredictionRows({raceDate:race.raceDate,races:[full],results:[result()],automaticGroups:[automatic]})
 assert.deepEqual(raceGroupTally(rows).groups,[['A',[1,1,1]]]);assert.equal(raceGroupTally(rows).count,1)
})
test('journal returns automatic groups for every synchronized race without any saved forecast or registration',async()=>{
 const store=memoryStore(),service=createCompanionService({store,ownerId:'owner',now:()=>now})
 const other={...full,id:'second',raceNo:12}
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:at,status:{state:'ready',lastRunAt:at},races:[full,other].map(r=>({raceId:r.id,raceDate:r.raceDate,race:r,snapshots:[{...snapshot,id:'snapshot-'+r.id,raceId:r.id}],observations:[]}))})
 const size=store.files.size,data=await service.getPredictionJournal({raceDate:race.raceDate})
 assert.equal(data.races.length,2);assert.equal(data.automaticGroups.length,2);assert.deepEqual(data.predictions,[]);assert.deepEqual(data.registrations,[]);assert.equal(store.files.size,size)
 const rows=racePredictionRows({raceDate:race.raceDate,races:data.races,results:[result(),result(other.id,[4,2,7])],automaticGroups:data.automaticGroups})
 assert.equal(raceGroupTally(rows).count,2);assert.ok(rows.every(r=>r.plan===null))
})
