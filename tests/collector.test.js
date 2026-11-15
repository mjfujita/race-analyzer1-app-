import test from 'node:test'
import assert from 'node:assert/strict'
import { safeJrdbUrl, publicSource, postTimestamp, dueCaptures, parseVisibleRace, parseHistoryTable } from '../collector/capture.mjs'
import { chunkBundles, companionAction, synchronizePending } from '../collector/run.mjs'
const race={raceId:'08265411',raceDate:'20261115',postTime:'1540',fieldSize:2,horses:[{horseNo:1,name:'架空馬A'},{horseNo:2,name:'架空馬B'}]}
const at='2026-11-15T06:29:00.000Z'
const rows=[1,2].map(no=>({umaban:String(no),bamei9m:`架空馬${no===1?'A':'B'}`,idm:'△60',sirusi_padock:'◎2.5',tanodds:no===1?'3.0':'4.5',kijtanodds:'4.0',fukodds:'1.2',bataiju:'480',zogendsp:'+ 2',se_tyakujun:''}))
const raw=()=>({rows:structuredClone(rows),weather:'稍重 小雨',oddsLabel:'単複表示：15:20現在オッズ',historyTable:[],resultTables:[],payoutTables:[]})
const cell=(text,rowspan=1)=>({text,rowspan,colspan:1})
const history=[['枠','馬','馬名','騎手名','基準オッズ'].map(v=>cell(v,3)).concat([cell('15:10')]),[cell('100万円')],[cell('90万円')],
  ['1','1','架空馬A','騎手A','4.0','3.0'].map(v=>cell(v)),['2','2','架空馬B','騎手B','4.0','4.5'].map(v=>cell(v))]

test('collector only follows official HTTPS origins and removes secret query strings',()=>{
  assert.equal(publicSource('https://jrdb.com/member/a?PHPSESSID=secret'),'https://jrdb.com/member/a')
  assert.throws(()=>safeJrdbUrl('https://jrdb.com.evil.test/member'))
  assert.throws(()=>safeJrdbUrl('http://jrdb.com/member'))
  assert.throws(()=>safeJrdbUrl('https://secret:secret@jrdb.com/'))
})
test('race scheduler takes each intended observation once without backdating missed slots',()=>{
  const start=postTimestamp(race)
  const due=dueCaptures([race],{},start-10*60000)
  assert.equal(due.length,1);assert.equal(due[0].offset,-10)
  assert.equal(dueCaptures([race],{[due[0].key]:{}},start-10*60000).length,0)
  assert.equal(dueCaptures([race],{},start-7*60000).length,0)
})
test('captured source timestamps remain distinct from the retrieval clock',()=>{
  const out=parseVisibleRace(raw(),race,{retrievedAt:at})
  assert.equal(out.snapshots[0].sourcePublishedAt,'2026-11-15T06:20:00.000Z')
  assert.equal(out.snapshots[0].retrievedAt,at)
  assert.equal(out.observation.payload.going,'稍重')
  assert.equal(out.observation.payload.paddock[0].paddockIndex,2.5)
  assert.equal(out.snapshots[1].kind,'baseline');assert.equal(out.snapshots[1].observedAt,at)
})
test('unknown publication is not forged; observed availability is explicit',()=>{
  const input=raw();input.oddsLabel='単複表示'
  const out=parseVisibleRace(input,race,{retrievedAt:at})
  assert.equal(out.snapshots[0].sourcePublishedAt,null)
  assert.equal(out.snapshots[0].timingEvidence,'observed-visible-at')
  assert.equal(out.snapshots[0].availabilityAt,at)
})
test('final price labels never become pre-race snapshots, and visible payouts stay distinct',()=>{
  const input=raw();input.oddsLabel='単勝最終オッズ';input.rows[0].se_tyakujun='1';input.rows[1].se_tyakujun='2'
  input.resultTables=[['1','1','架空馬A','','1.00.0','34.5','1','','1','1','1','2']]
  input.payoutTables=[['単勝','1番','300円','1人気'],['馬単','01－02','1,500円','1人気']]
  const out=parseVisibleRace(input,race,{retrievedAt:'2026-11-15T07:00:00Z'})
  assert.equal(out.snapshots.filter(row=>row.kind==='observed').length,0)
  assert.equal(out.observation.payload.finalWinOdds[1],3)
  assert.equal(out.observation.payload.closingPublishedAt,null)
  assert.equal(out.observation.payload.results[0].cornerPass4,2)
  assert.equal(out.observation.payload.payouts[1].key,'馬単:1-2')
  assert.equal(out.observation.payload.payouts[1].per100,1500)
})
test('wrong race, incomplete field and authentication failure stop capture',()=>{
  assert.throws(()=>parseVisibleRace({...raw(),rows:[]},race,{retrievedAt:at}),/ログイン/)
  assert.throws(()=>parseVisibleRace({...raw(),rows:[rows[0]]},race,{retrievedAt:at}),/全頭/)
  const input=raw();input.rows[0].bamei9m='別の馬'
  assert.throws(()=>parseVisibleRace(input,race,{retrievedAt:at}),/馬名/)
})
test('history table expands rowspans, reads actual frame text and keeps late retrieval late',()=>{
  const parsed=parseHistoryTable(history,race,at,'https://jrdb.com/member/sample')
  assert.deepEqual(parsed.frames,{'1':1,'2':2})
  assert.equal(parsed.snapshots.length,1);assert.equal(parsed.snapshots[0].retrievedAt,at)
  assert.equal(parsed.snapshots[0].observedAt,'2026-11-15T06:10:00.000Z')
})
test('sync batches stay bounded and oversized races fail without truncating immutable evidence',()=>{
  const bundle={schemaVersion:1,kind:'race-companion-bundle',races:[{raceId:'one',text:'a'.repeat(100)},{raceId:'two',text:'b'.repeat(100)}]}
  assert.equal(chunkBundles(bundle,250).length,2)
  assert.throws(()=>chunkBundles(bundle,100))
})


test('companion command routes accept native fetch Response and reject failed HTTP status',async()=>{
  const config={syncToken:'synthetic-only',syncUrl:'https://race-analyzer-app.vercel.app/api/companion'}
  const out=await companionAction(config,{action:'pull-commands'},async(_url,request)=>{
    assert.equal(JSON.parse(request.body).action,'pull-commands')
    assert.equal(request.headers.Authorization,'Bearer synthetic-only')
    return new Response(JSON.stringify({schemaVersion:1,commands:[]}),{status:200})
  })
  assert.deepEqual(out.commands,[])
  await assert.rejects(()=>companionAction(config,{action:'pull-ledgers'},async()=>new Response('{}',{status:403})),/同期/)
})


test('failed full sync remains pending and is retried even when no new observation arrives',async()=>{
  const bundle={races:[{raceId:'one'}],models:{runtimeModel:{id:'new-model'}}},state={}
  const saved=[]
  await assert.rejects(()=>synchronizePending(bundle,{},state,{changed:true,now:'2026-01-01T00:00:00Z',persistState:async value=>saved.push(structuredClone(value)),send:async()=>{throw new Error('network')}}),/network/)
  assert.equal(state.pendingFullSync,true);assert.equal(saved[0].pendingFullSync,true)
  let sent
  await synchronizePending(bundle,{},state,{changed:false,now:'2026-01-01T00:00:30Z',send:async body=>{sent=body;return {state:'synced'}}})
  assert.equal(sent.races.length,1);assert.equal(sent.models.runtimeModel.id,'new-model');assert.equal(state.pendingFullSync,false)
  const result=await synchronizePending(bundle,{},state,{changed:false,now:'2026-01-01T00:01:00Z',send:async()=>{throw new Error('unexpected')}})
  assert.equal(result.state,'unchanged')
})
