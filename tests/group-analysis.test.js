import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { groupOdds, compareGroupPlans, groupBudget, createGroupPlan, validateGroupPlan, reviewGroupPlan, groupOutcome, groupHitInterval, groupReceiptVerified } from '../src/groupAnalysis.js'
import { emptyLedger, appendGroupPlan, appendPurchase, appendSettlement, summarizeLedger, validateLedger, importLedger } from '../src/forecastLedger.js'
import { createCompanionService, createCompanionHandler } from '../server/companion.js'
import { memoryStore, request } from './fixtures/companion.js'

const race = { id:'08260111',raceDate:'20261115',postTime:'1540',name:'架空の検証レース' }
const scope = { userId:'group-owner',raceId:race.id,raceDate:race.raceDate }
const field = Array.from({ length:6 },(_,i) => ({ no:i+1,name:`架空${i+1}`,evidence:'IDM未取得' }))
const at = '2026-11-15T06:25:00.000Z'
const snapshot = { schemaVersion:2,id:'test-observation',raceId:race.id,raceDate:race.raceDate,kind:'observed',time:'15:20',
  source:'synthetic',observedAt:'2026-11-15T06:20:00.000Z',retrievedAt:'2026-11-15T06:20:01.000Z',sourcePublishedAt:'2026-11-15T06:20:00.000Z',revisionOf:null,
  odds:{ 1:3,2:3.5,3:8,4:9,5:20,6:25 } }
const config = { race,field,snapshot,threshold:1.5,boundaries:null,slots:[['B'],['A'],['C']],variant:'ordered',budget:10000,unit:100 }
const plan = (extra={},time=at) => createGroupPlan({ ...config,...extra },time)
const clone = value => JSON.parse(JSON.stringify(value))
const outcome = { state:'matched',field:[{ no:3,rank:1 },{ no:5,rank:2 },{ no:1,rank:3 },{ no:2,rank:4 },{ no:4,rank:5 },{ no:6,rank:6 }] }

test('odds grouping preserves ties, handles exact threshold, manual boundaries and missing prices',() => {
  const g = groupOdds(field,snapshot.odds)
  assert.deepEqual(g.groups.map(g => g.horses.map(h => h.no)),[[1,2],[3,4],[5,6]])
  assert.deepEqual(g.automatic,[3,5])
  assert.deepEqual(groupOdds(field,snapshot.odds,1.5,[2,3,5]).groups.map(g => g.horses.map(h => h.no)),[[1],[2],[3,4],[5,6]])
  assert.equal(groupOdds(field,{ ...snapshot.odds,2:3 }).membership[1],groupOdds(field,{ ...snapshot.odds,2:3 }).membership[2])
  assert.throws(() => groupOdds(field,{ ...snapshot.odds,2:3 },1.5,[2]),/同じオッズ/)
  assert.deepEqual(groupOdds(field,{ 1:3 }).missing,[2,3,4,5,6])
  assert.throws(() => plan({ snapshot:{ ...snapshot,odds:{ 1:3 } } }),/全出走馬/)
  assert.throws(() => groupOdds(field,snapshot.odds,NaN))
})

test('the same candidate set distinguishes B-A-C, B-C-A, trio and exacta without double counting',() => {
  const proposals = compareGroupPlans(groupOdds(field,snapshot.odds),config.slots)
  assert.deepEqual(proposals.map(p => p.tickets.length),[8,8,8,4])
  const ordered = reviewGroupPlan(plan(),outcome)
  assert.deepEqual(ordered,{ groups:'B→C→A',numbers:[3,5,1],candidatesCovered:true,formationCovered:false,hit:false })
  assert.equal(reviewGroupPlan(plan({ variant:'swapped' }),outcome).hit,true)
  assert.equal(reviewGroupPlan(plan({ variant:'trio' }),outcome).hit,true)
  assert.equal(reviewGroupPlan(plan({ variant:'trio',overrides:{ '3連複:1-3-5':0 } }),outcome).hit,false)
  assert.equal(reviewGroupPlan(plan(),{ ...outcome,field:outcome.field.map(h => ({ ...h,rank:1 })) }),null)
  const broad = compareGroupPlans(groupOdds(field,snapshot.odds),[['A','B','C'],['A','B','C'],['A','B','C']])
  assert.equal(broad.find(p => p.id === 'trio').tickets.length,20)
  assert.equal(broad.find(p => p.id === 'ordered').tickets.length,120)
})

test('budget enforces cap, keeps unused money, and never invents prices or positive expectation',() => {
  const tickets = compareGroupPlans(groupOdds(field,snapshot.odds),config.slots)[0].tickets
  assert.equal(groupBudget(tickets,10000).unspent,9200)
  assert.equal(groupBudget(tickets,100,100).overBudget,true)
  assert.throws(() => plan({ budget:100 }),/予算内/)
  assert.throws(() => plan({ budget:10100 }))
  assert.throws(() => groupBudget(tickets,10000,100,{ [tickets[0].key]:150 }))
  const partial = groupBudget(tickets,10000,100,{},[{ ...tickets[0],odds:30 }])
  assert.equal(partial.minimumConditionalPayout,null)
  assert.equal(partial.expectedReturn,null)
  assert.equal(partial.hitProbability,null)
  const full = groupBudget(tickets,10000,100,{},tickets.map(t => ({ ...t,odds:30 })))
  assert.equal(full.minimumConditionalPayout,3000)
})

test('group records remain immutable, validate computed values, and do not enter forecast probabilities',() => {
  const p = plan(), ledger = appendGroupPlan(emptyLedger(scope),p)
  assert.equal(ledger.forecasts.length,0)
  assert.equal(summarizeLedger(ledger).returnRate,null)
  assert.equal(validateGroupPlan(p,scope).mode,'live')
  const reorder = obj => Array.isArray(obj) ? obj.map(reorder) : obj && typeof obj === 'object' ? Object.fromEntries(Object.keys(obj).sort().map(k => [k,reorder(obj[k])])) : obj
  assert.equal(validateGroupPlan(reorder(p),scope).mode,'live')
  for (const change of [p => p.grouping.membership[1]='C',p => p.allocations[0].stake=900,p => p.invested=1,p => p.snapshot.odds[1]=99,p => p.expectedReturn=2]) {
    const bad = clone(p); change(bad)
    assert.throws(() => validateGroupPlan(bad,scope))
  }
  const conflict = clone(ledger); conflict.groupPlans[0].note='replaced'
  assert.throws(() => importLedger(ledger,JSON.stringify(conflict)),/異なる記録/)
  const older = emptyLedger(scope)
  assert.deepEqual(importLedger(ledger,JSON.stringify(older)),ledger)
  assert.throws(() => validateLedger(ledger,{ ...scope,userId:'other' }))
})

test('late or undated prices, late saves and cancellations cannot become live group decisions',() => {
  const p = plan({},'2026-11-15T06:31:00Z')
  assert.equal(p.mode,'replay')
  assert.equal(plan({ snapshot:{ ...snapshot,retrievedAt:'2026-11-15T07:00:00Z' } }).mode,'replay')
  assert.equal(plan({ snapshot:{ ...snapshot,sourcePublishedAt:null } }).mode,'replay')
  assert.equal(plan({ quotes:[{ type:'3連単',numbers:[3,1,5],odds:30 }] }).mode,'replay')
  const forged = { ...p,mode:'live' }
  assert.throws(() => validateGroupPlan(forged,scope))
  assert.throws(() => plan({ field:field.map(h => ({ ...h,cancelled:h.no === 6 })) }))
  assert.throws(() => plan({ snapshot:{ ...snapshot,raceDate:'20261116' } }))
})

test('real purchase and official settlement reference group decisions separately from proposals',() => {
  const referenceSnapshot = { ...snapshot,id:'earlier',time:'15:10',observedAt:'2026-11-15T06:10:00.000Z',retrievedAt:'2026-11-15T06:10:00.000Z',sourcePublishedAt:'2026-11-15T06:10:00.000Z' }
  let ledger = appendGroupPlan(emptyLedger(scope),plan({ variant:'trio',referenceSnapshot }))
  ledger = appendPurchase(ledger,{ forecastId:ledger.groupPlans[0].id,tickets:[{ type:'3連複',numbers:[1,3,5],key:'3連複:1-3-5',stake:100 }] }).ledger
  ledger = appendSettlement(ledger,{ purchaseId:ledger.purchases[0].id,payouts:{ '3連複:1-3-5':1200 } }).ledger
  assert.equal(summarizeLedger(ledger).profit,1100)
  const python = spawnSync('python3',['-c',`import json,sys
from pipeline.ledger import validate_ledger, _merge_ledgers
d=json.load(sys.stdin)
validate_ledger(d)
direct=json.loads(json.dumps(d['groupPlans'][0])); direct['id']='direct-visible'
direct['snapshot'].update(sourcePublishedAt=None,timingEvidence='observed-visible-at',availabilityAt=direct['snapshot']['retrievedAt'])
validate_ledger(dict(d,groupPlans=[direct],purchases=[],settlements=[]))
merged=_merge_ledgers([d,dict(schemaVersion=1,scope=d['scope'],forecasts=[],purchases=[],settlements=[])])[0]
assert len(merged['groupPlans']) == 1 and not merged['forecasts']
bad=json.loads(json.dumps(d)); bad['groupPlans'][0]['allocations'][0]['stake']=999
try: validate_ledger(bad)
except ValueError: pass
else: raise AssertionError('tampered plan accepted')
print('ok')`],{ input:JSON.stringify(ledger),encoding:'utf8' })
  assert.equal(python.status,0,python.stderr)
  assert.equal(python.stdout.trim(),'ok')
})

test('cloud saves group decisions with owner-only receipts and excludes them from training receipts',async () => {
  let time = Date.parse(at)+1000
  const service = createCompanionService({ store:memoryStore(),ownerId:scope.userId,now:() => time })
  await service.ingestBundle({ schemaVersion:1,kind:'race-companion-bundle',generatedAt:at,status:{ state:'ready' },
    races:[{ raceId:race.id,raceDate:race.raceDate,race:{ ...race,horses:field },snapshots:[snapshot],observations:[] }] })
  const ledger = appendGroupPlan(emptyLedger(scope),plan())
  const saved = await service.saveLedger(ledger)
  const receipt = saved.groupReceipts[ledger.groupPlans[0].id]
  assert.ok(groupReceiptVerified(ledger.groupPlans[0],receipt,scope))
  assert.deepEqual(saved.receipts,{})
  assert.equal((await service.pullLedger(scope)).receipts,undefined)
  assert.equal((await service.get(scope)).groupReceipts[receipt.planId].planId,receipt.planId)
  assert.equal((await service.get(scope)).ledger.groupPlans.length,1)
  time = Date.parse('2026-11-15T06:31:00Z')
  const unsent = appendGroupPlan(ledger,plan())
  const late = await service.saveLedger(unsent)
  assert.equal(late.groupReceipts[unsent.groupPlans.at(-1).id],undefined)
  const handler = createCompanionHandler({ service,ownerId:scope.userId,authenticateUser:async token => ({ id:token }) })
  assert.equal((await request(handler,{ token:'another-user',query:{ raceId:race.id,raceDate:race.raceDate } })).status,403)
})

test('official live results reconcile groups without a model forecast; conflicts and dead heats are held',() => {
  const p = plan()
  const payload = { raceId:race.id,raceDate:race.raceDate,priceStatus:'final-visible',releaseFieldSize:6,results:outcome.field.map(r => ({ horseNo:r.no,rank:r.rank })) }
  const cloud = { observations:[{ kind:'LIVE_RACE',retrievedAt:'2026-11-15T07:00:00Z',payload }] }
  assert.equal(reviewGroupPlan(p,groupOutcome(p,null,cloud)).groups,'B→C→A')
  assert.equal(reviewGroupPlan(p,groupOutcome(p,{races:[{...race,raceId:race.id,state:'awaiting-results'}]},cloud)).groups,'B→C→A')
  assert.equal(groupOutcome(p,{races:[{...race,raceId:race.id,state:'awaiting-results'}]},null),null)
  assert.equal(groupOutcome(p,{ races:[{ ...race,raceId:race.id,state:'result-conflict' }] },cloud).state,'result-conflict')
  assert.equal(groupOutcome(p,null,{ observations:[{ ...cloud.observations[0],retrievedAt:at }] }),null)
  const dead = clone(cloud); dead.observations[0].payload.results[1].rank=1
  assert.equal(groupOutcome(p,null,dead),null)
  assert.equal(groupHitInterval(0,0),null)
  assert.ok(groupHitInterval(1,1)[0] < .21)
})
