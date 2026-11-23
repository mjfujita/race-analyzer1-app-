import test from 'node:test'
import assert from 'node:assert/strict'
import {createOutcomeModel} from '../src/portfolio.js'
import {groupOdds} from '../src/groupAnalysis.js'
import {summarizeGroupProbabilities} from '../src/groupProbabilities.js'

const near=(actual,expected)=>assert.ok(Math.abs(actual-expected)<1e-10,`${actual} != ${expected}`)
function fixture(weights=[.25,.25,.25,.25]) {
  const field=weights.map((probability,i)=>({no:i+1,name:`馬${i+1}`,probability}))
  const {outcomes}=createOutcomeModel(field)
  const rows=field.map(h=>{
    const p=[0,0,0]
    for(const o of outcomes)for(let i=0;i<3;i++)if(o.order[i]===h.no)p[i]+=o.probability
    return {...h,probabilities:{win:p[0],second:p[1],third:p[2],top3:p.reduce((a,b)=>a+b,0)}}
  })
  return {assessment:{rows,outcomes},grouping:groupOdds(field,Object.fromEntries(field.map(h=>[h.no,h.no<=2?3:10])))}
}

test('group chances enumerate mutually exclusive positions and count any top-three once',()=>{
  const {assessment,grouping}=fixture(),snapshot=JSON.stringify({assessment,grouping})
  const [a,b]=summarizeGroupProbabilities(grouping,assessment)
  for(const s of [a,b]) {
    near(s.win,.5);near(s.second,.5);near(s.third,.5);near(s.averageWin,.25)
    near(s.anyTop3,1) // sum of individual top-three rates would incorrectly be 1.5.
    near(s.leaders.reduce((sum,h)=>sum+h.share,0),1)
  }
  assert.equal(JSON.stringify({assessment,grouping}),snapshot)
})

test('candidate exclusions do not redistribute probability to other horses and expose empty groups',()=>{
  const {assessment,grouping}=fixture()
  const [a,b]=summarizeGroupProbabilities(grouping,assessment,[1])
  near(a.win,.25);near(a.anyTop3,.75);near(a.averageWin,.25);near(b.win,.5)
  assert.equal(a.excludedCount,1);assert.equal(a.leaders[0].no,2);near(a.leaders[0].share,1)
  const empty=summarizeGroupProbabilities(grouping,assessment,[1,2])[0]
  assert.equal(empty.status,'held');assert.equal(empty.win,undefined);assert.match(empty.reason,/候補馬がいません/)
})

test('average and leader contribution distinguish group size from a strong horse',()=>{
  const {assessment,grouping}=fixture([.4,.2,.25,.15])
  const [a,b]=summarizeGroupProbabilities(grouping,assessment)
  near(a.win,.6);near(a.averageWin,.3);near(a.leaders[0].share,2/3)
  assert.deepEqual(a.leaders.map(h=>h.no),[1,2])
  near(b.win,.4);near(b.leaders[0].share,.625)
  const singleton=groupOdds(grouping.groups.flatMap(g=>g.horses),{1:3,2:10,3:10,4:10})
  const single=summarizeGroupProbabilities(singleton,assessment)[0]
  near(single.win,.4);near(single.anyTop3,assessment.rows[0].probabilities.top3)
})

test('missing or held field evidence never turns an incomplete group into 100 percent',()=>{
  const {assessment,grouping}=fixture()
  for(const data of [null,{...assessment,outcomes:[]},{...assessment,rows:assessment.rows.slice(0,3)},{...assessment,rows:assessment.rows.map((h,i)=>i===3?{...h,probabilities:null}:h)}]) {
    assert.ok(summarizeGroupProbabilities(grouping,data).every(g=>g.status==='held'&&g.win===undefined))
  }
  assert.equal(summarizeGroupProbabilities({...grouping,complete:false},assessment)[0].status,'held')
  assert.deepEqual(summarizeGroupProbabilities(null,assessment),[])
})

test('two-horse races keep third probability zero and any top-three probability one',()=>{
  const {assessment,grouping}=fixture([.6,.4])
  const result=summarizeGroupProbabilities(grouping,assessment)[0]
  near(result.win,1);near(result.second,1);near(result.third,0);near(result.anyTop3,1)
})
