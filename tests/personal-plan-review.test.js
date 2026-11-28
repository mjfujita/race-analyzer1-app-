import test from 'node:test'
import assert from 'node:assert/strict'
import {createGroupPlan} from '../src/groupAnalysis.js'
import {personalPlanReview} from '../src/personalGroupPrediction.js'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
const field=horses.map(h=>({no:h.no,name:h.name,evidence:'fixture'}))
const snapshot={...demoSnapshots()[1],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}
const plan=(extra={})=>createGroupPlan({race,field,snapshot,threshold:1.5,boundaries:null,slots:[['A'],['C'],['C']],variant:'ordered',budget:10000,unit:100,overrides:{},...extra},'2026-11-15T06:25:00Z')
const outcome=order=>({state:'matched',field:order.map((no,i)=>({no,rank:i+1}))})
test('saved composition separates a group position miss from candidate coverage and preserves its snapshot',()=>{
 const p=plan(),before=JSON.stringify(p),r=personalPlanReview(p,outcome([1,3,5,2,4,6,7,8]))
 assert.equal(r.pattern,'A → C → C');assert.equal(r.actualPattern,'A → B → C')
 assert.deepEqual(r.positions.map(x=>x.groupMatches),[true,false,true])
 assert.deepEqual(r.positions.map(x=>x.horses.map(h=>h.no)),[[1,2],[5,6],[5,6]])
 assert.equal(r.result.hit,false);assert.equal(JSON.stringify(p),before)
 assert.equal(personalPlanReview(p,null).state,'pending')
 assert.equal(personalPlanReview(p,{state:'result-conflict'}).state,'held')
})
test('swapped variants show the adopted positions and exacta compares only two positions',()=>{
 const p=plan({slots:[['A'],['B'],['C']],variant:'swapped'})
 const r=personalPlanReview(p,outcome([1,5,3,2,4,6,7,8]))
 assert.equal(r.pattern,'A → C → B');assert.equal(r.result.hit,true)
 const exacta=personalPlanReview(plan({slots:[['B'],['A'],['C']],variant:'exacta'}),outcome([3,1,5,2,4,6,7,8]))
 assert.equal(exacta.positions.length,2);assert.equal(exacta.actualPattern,'B → A');assert.equal(exacta.result.hit,true)
})
test('trio judges horse combinations without treating group selection rows as finishing positions',()=>{
 const r=personalPlanReview(plan({slots:[['A'],['B'],['C']],variant:'trio'}),outcome([5,3,1,2,4,6,7,8]))
 assert.equal(r.pattern,'A − B − C');assert.equal(r.actualPattern,'C → B → A');assert.equal(r.result.hit,true)
 assert.ok(r.positions.every(p=>p.groupMatches===null&&p.candidateIncluded===null))
})
test('group matches do not create a hit for removed stakes or excluded horses; abnormal results are held',()=>{
 const order=outcome([1,5,6,2,3,4,7,8])
 const r=personalPlanReview(plan({overrides:{'3連単:1-5-6':0}}),order)
 assert.ok(r.positions.every(x=>x.groupMatches));assert.equal(r.result.hit,false)
 const excluded=personalPlanReview(plan({excluded:[1]}),order)
 assert.equal(excluded.positions[0].groupMatches,true);assert.equal(excluded.positions[0].candidateIncluded,false);assert.equal(excluded.result.hit,false)
 const dead=outcome([1,5,6,2,3,4,7,8]);dead.field[1].rank=1
 assert.equal(personalPlanReview(plan(),dead).state,'held')
 const partial=outcome([1,5,6]);assert.equal(personalPlanReview(plan(),partial).state,'held')
})
