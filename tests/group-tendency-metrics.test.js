import test from 'node:test'
import assert from 'node:assert/strict'
import {race,horses,demoSnapshots} from '../dev/fixtures.js'
import {automaticResultGroups} from '../src/automaticResultGroups.js'
import {createPrediction,createJournalResult} from '../src/predictionJournal.js'
import {racePredictionRows} from '../src/racePredictionResults.js'
import {groupTendencyMetrics,preRaceAceBasis,raceSurface,raceCategory} from '../src/groupTendencyMetrics.js'
const at='2026-11-15T06:25:00Z',post='2026-11-15T06:40:00Z',full={...race,horses},odds={1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}
const snapshot={...demoSnapshots()[2],odds},automatic=automaticResultGroups(full,[snapshot],[],Date.parse('2026-11-15T07:00:00Z'))
export const probs={asOf:snapshot.retrievedAt,horses:[],groups:['A','B','C','D'].map((label,i)=>({label,status:'ready',count:2,totalCount:2,fieldSize:8,win:[.4,.3,.2,.1][i],second:[.3,.3,.2,.2][i],third:[.2,.3,.3,.2][i]}))}
const prediction=createPrediction({race,field:horses,snapshot,type:'3連単',slots:[['A'],['B'],['C']],probabilities:probs},at,'pre')
const result=createJournalResult({raceId:race.id,raceDate:race.raceDate,numbers:[1,3,5]},'2026-11-15T07:00:00Z','result')
const row=()=>racePredictionRows({raceDate:race.raceDate,races:[full],results:[result],automaticGroups:[automatic]})[0]
test('rates use the same completed-race denominator; group size averages only races where the group exists',()=>{
 const first=row(),second={...first,race:{...race,id:'second'},groupBasis:{...automatic,field:horses,grouping:{groups:[{label:'A',horses:horses.slice(0,4)},{label:'B',horses:horses.slice(4)}]}},groupResult:{state:'ready',groups:['B','A','B']}}
 const stats=groupTendencyMetrics([first,second]);assert.equal(stats.count,2)
 const a=stats.groups.find(g=>g.label==='A'),c=stats.groups.find(g=>g.label==='C')
 assert.equal(a.averageHeads,3);assert.equal(a.averageShare,.375);assert.deepEqual(a.rates,[.5,.5,0]);assert.equal(c.present,1);assert.equal(c.averageHeads,2);assert.deepEqual(c.rates,[0,0,.5])
 for(let i=0;i<3;i++)assert.equal(stats.groups.reduce((n,g)=>n+g.rates[i],0),1)
})
test('expected counts and actual counts use the identical pre-race eligible cohort',()=>{
 const first=row(),second={...first,race:{...race,id:'second'}}
 const stats=groupTendencyMetrics([first,second],{predictions:[prediction],receipts:{pre:'2026-11-15T06:26:00Z'}})
 assert.equal(stats.count,2);assert.equal(stats.ace.count,1);assert.equal(stats.ace.total,2)
 const a=stats.ace.groups.find(g=>g.label==='A');assert.deepEqual(a.expected,[.4,.3,.2]);assert.deepEqual(a.actual,[1,0,0]);assert.equal(a.differences[0],.6)
 assert.equal(stats.ace.excluded[0].count,1)
})
test('post-race creation, late receipts, unknown as-of and changed classification are excluded',()=>{
 for(const [record,receipts] of [[{...prediction,createdAt:post},{pre:'2026-11-15T06:41:00Z'}],[prediction,{pre:post}],[prediction,{}],[{...prediction,probabilities:{...probs,asOf:null}},{pre:at}],[{...prediction,grouping:{...prediction.grouping,membership:{...prediction.grouping.membership,1:'B'}}},{pre:at}]])assert.equal(preRaceAceBasis(row(),{predictions:[record],receipts}).record,null)
})
test('missing/excluded horse probabilities, duplicated groups and non-normalized distributions cannot become a comparison',()=>{
 const variants=[probs.groups.map((g,i)=>i?g:{...g,count:1}),probs.groups.slice(1),probs.groups.map(g=>({...g,win:.5})),[...probs.groups.slice(0,3),probs.groups[0]],probs.groups.map(g=>({...g,status:'held'}))]
 for(const groups of variants)assert.equal(preRaceAceBasis(row(),{predictions:[{...prediction,probabilities:{...probs,groups}}],receipts:{pre:at}}).record,null)
})
test('chooses an eligible earlier immutable record rather than replacing it with a later retrospective record',()=>{
 const late={...prediction,id:'late',createdAt:'2026-11-15T07:00:00Z'}
 const chosen=preRaceAceBasis(row(),{predictions:[late,prediction],receipts:{pre:at,late:'2026-11-15T07:00:00Z'}})
 assert.equal(chosen.record.id,'pre')
})
test('ordered pairs and triples preserve repeats, count once per race and share the same denominator',()=>{
 const first=row(),same={...first,race:{...race,id:'same'},groupResult:{state:'ready',groups:['A','A','A']}},duplicate={...first}
 const stats=groupTendencyMetrics([first,same,duplicate]);assert.equal(stats.count,2)
 assert.ok(stats.pairs.some(p=>p.pattern==='A → A'&&p.count===1&&p.rate===.5));assert.ok(stats.triples.some(p=>p.pattern==='A → A → A'&&p.rate===.5))
 assert.equal(stats.pairs.reduce((n,p)=>n+p.count,0),2);assert.equal(stats.triples.reduce((n,p)=>n+p.count,0),2)
})
test('pending/held results do not change rates or probability-comparison denominators and inputs stay untouched',()=>{
 const first=row(),before=structuredClone(first),stats=groupTendencyMetrics([first,{...first,race:{...race,id:'held'},groupResult:{state:'held'}},{...first,race:{...race,id:'pending'},groupResult:{state:'pending'}}])
 assert.equal(stats.count,1);assert.equal(stats.ace.total,1);assert.deepEqual(first,before)
 const empty=groupTendencyMetrics([]);assert.equal(empty.count,0);assert.deepEqual(empty.groups,[]);assert.deepEqual(empty.pairs,[]);assert.equal(empty.ace.count,0)
})
test('race filters use explicit metadata and preserve unknown conditions',()=>{
 assert.equal(raceSurface({surfaceCode:'1'}),'芝');assert.equal(raceSurface({surface:'ダート'}),'ダート');assert.equal(raceSurface({}),'情報未取得')
 assert.equal(raceCategory({name:'2歳未勝利'}),'未勝利');assert.equal(raceCategory({name:'2歳新馬'}),'新馬');assert.equal(raceCategory({name:'1勝クラス'}),'その他');assert.equal(raceCategory({}),'情報未取得')
})
