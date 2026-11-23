import test from 'node:test'
import assert from 'node:assert/strict'
import { groupOdds, createGroupPlan, validateGroupPlan, reviewGroupPlan } from '../src/groupAnalysis.js'
import { personalSelection } from '../src/personalGroupPrediction.js'
import { race, horses, demoSnapshots } from '../dev/fixtures.js'

const field = horses.map(h=>({no:h.no,name:h.name,evidence:'fixture'}))
const snapshot = {...demoSnapshots()[1],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}
const grouping = groupOdds(field,snapshot.odds)
const select = options => personalSelection({grouping,type:'馬単',method:'formation',...options})

test('personal formation, box and positional axis compile into distinct compatible tickets',()=>{
  const exacta = select({slots:[['B'],['A'],[]]})
  assert.equal(exacta.tickets.length,4)
  assert.equal(exacta.variant,'exacta')
  assert.deepEqual(exacta.tickets.map(t=>t.numbers),[[3,1],[3,2],[4,1],[4,2]])
  const box = select({method:'box',box:['B','A','A']})
  assert.equal(box.tickets.length,12)
  assert.equal(new Set(box.tickets.map(t=>t.key)).size,12)
  const trio = select({type:'3連複',method:'box',box:['A','B']})
  assert.equal(trio.tickets.length,4)
  const flow = select({type:'3連単',method:'flow',axis:'A',position:1,opponents:['B','C']})
  assert.equal(flow.tickets.length,24)
  assert.ok(flow.tickets.every(t=>[1,2].includes(t.numbers[1])))
  const trioFlow = select({type:'3連複',method:'flow',axis:'A',opponents:['A','B']})
  assert.equal(trioFlow.tickets.length,4)
  assert.ok(trioFlow.tickets.every(t=>t.numbers.some(no=>[1,2].includes(no))))
  assert.ok(flow.note.includes('軸 A（2着）'))
})

test('unselected and impossible combinations stay empty; unsupported methods and groups fail closed',()=>{
  assert.deepEqual(select({}).tickets,[])
  assert.deepEqual(select({method:'flow',opponents:['A','B']}).tickets,[])
  assert.throws(()=>select({type:'単勝'}),/券種/)
  assert.throws(()=>select({method:'unknown'}),/券種/)
  assert.throws(()=>select({method:'flow',position:2}),/着順/)
  assert.throws(()=>select({slots:[['Z'],['A'],[]]}),/グループ/)
})

test('personal plan preserves selected horses and method, validates old ledger format and separates replay',()=>{
  const selection = select({slots:[['B'],['A'],[]]})
  const params = {race,field,snapshot,threshold:1.5,boundaries:null,...selection,unit:500,budget:10000,overrides:{},note:`${selection.note}\nB勝ち・A2着`}
  const plan = createGroupPlan(params,'2026-11-15T06:25:00Z')
  assert.equal(plan.invested,2000)
  assert.equal(plan.mode,'live')
  assert.equal(validateGroupPlan(JSON.parse(JSON.stringify(plan)),{raceId:race.id,raceDate:race.raceDate}).id,plan.id)
  assert.ok(plan.note.includes('馬単｜フォーメーション｜B → A'))
  params.snapshot = {...snapshot,odds:{...snapshot.odds,3:2}}
  assert.equal(plan.snapshot.odds[3],8)
  assert.equal(plan.grouping.membership[3],'B')
  assert.equal(createGroupPlan(params,'2026-11-15T07:00:00Z').mode,'replay')
  assert.throws(()=>createGroupPlan({...params,snapshot,unit:3000},'2026-11-15T06:25:00Z'),/予算/)
  const result = reviewGroupPlan(plan,{state:'matched',field:[3,1,5,2,4,6,7,8].map((no,i)=>({no,rank:i+1}))})
  assert.equal(result.hit,true)
})
