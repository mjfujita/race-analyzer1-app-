import test from 'node:test'
import assert from 'node:assert/strict'
import {setBrowserValue,oddsStorageOwner,RACE_CACHE_CHAR_BUDGET} from '../src/browserStorage.js'

function limitedStorage(initial,limit){
  const data=new Map(Object.entries(initial)),removed=[]
  return {data,removed,get length(){return data.size},key:i=>[...data.keys()][i]??null,getItem:k=>data.get(k)??null,
    setItem(k,v){const next=new Map(data);next.set(k,v);if([...next].reduce((n,[key,value])=>n+key.length+value.length,0)>limit)throw new DOMException('Quota exceeded','QuotaExceededError');data.set(k,v)},
    removeItem(k){removed.push(k);data.delete(k)}}
}
const cache=(user,id)=>`race-companion-cache:v1:${user}:2026-11-28:${id}`
const copy=(text,fetchedAt='2026-11-28T00:00:00Z')=>JSON.stringify({fetchedAt,text})
test('quota recovery discards only same-owner cloud race copies and preserves all records and credentials',()=>{
  const key='race-prediction-journal:v1:owner:20261128',old='old journal',first=cache('owner','first'),last=cache('owner','last')
  const protectedData={[key]:old,'race-group-registration:v1:owner:20261128':'groups','race-forecast-ledger:v1:owner:race':'unsent purchase','race-ability-odds:v1:owner:20261128:race':'odds','race-observations:v1:owner:20261128:race':'observations','race-workspace-settings:v1:owner':'preferences','device-approval':'credential',[cache('other','one')]:'other account cache'}
  const storage=limitedStorage({...protectedData,[first]:copy('x'.repeat(500)),[last]:copy('x'.repeat(500),'2026-11-28T01:00:00Z')},1800)
  setBrowserValue(storage,key,'new journal'.repeat(30),'owner')
  assert.deepEqual(storage.removed,[first]);assert.equal(storage.getItem(key),'new journal'.repeat(30))
  for(const [k,v] of Object.entries(protectedData))if(k!==key)assert.equal(storage.getItem(k),v)
})
test('cache growth is bounded before the browser fills and retains the current downloaded race',()=>{
  const first=cache('owner','first'),last=cache('owner','last'),current=cache('owner','current')
  const storage=limitedStorage({[first]:copy('x'.repeat(200000)),[last]:copy('x'.repeat(200000),'2026-11-28T01:00:00Z')},Infinity)
  const value=copy('x'.repeat(200000),'2026-11-28T02:00:00Z')
  setBrowserValue(storage,current,value,'owner',{cache:true})
  assert.deepEqual(storage.removed,[first]);assert.equal(storage.getItem(current),value)
  assert.ok([...storage.data].reduce((n,[k,v])=>n+k.length+v.length,0)<=RACE_CACHE_CHAR_BUDGET)
})
test('when capacity cannot be recovered an atomic failure preserves the old record and gives a Japanese reason',()=>{
  const key='race-group-registration:v1:owner:20261128',storage=limitedStorage({[key]:'old','race-prediction-journal:v1:owner:20261128':'unsent'},200)
  assert.throws(()=>setBrowserValue(storage,key,'x'.repeat(300),'owner'),error=>error.code==='browser_storage_full'&&/記録は削除していません/.test(error.message))
  assert.equal(storage.getItem(key),'old');assert.deepEqual(storage.removed,[])
})
test('failed cache replacement preserves its previous copy when the incoming race alone cannot fit',()=>{
  const key=cache('owner','current'),storage=limitedStorage({[key]:'previous race'},100)
  assert.throws(()=>setBrowserValue(storage,key,'x'.repeat(150),'owner',{cache:true}),/保存容量/)
  assert.equal(storage.getItem(key),'previous race')
})
test('non-quota failures do not delete caches or hide the original error',()=>{
  const storage=limitedStorage({[cache('owner','old')]:'retained'},1000),error=new Error('storage denied')
  storage.setItem=()=>{throw error}
  assert.throws(()=>setBrowserValue(storage,'journal','next','owner'),e=>e===error);assert.deepEqual(storage.removed,[])
})
test('old cache entries can be evicted safely but unknown owners never evict another account',()=>{
  const key=cache('owner','old'),storage=limitedStorage({[key]:'old non-json cache'},100)
  setBrowserValue(storage,'journal','x'.repeat(80),'owner');assert.deepEqual(storage.removed,[key])
  const other=limitedStorage({[cache('other','one')]:'protected'},100)
  assert.throws(()=>setBrowserValue(other,'journal','x'.repeat(100),null),/保存容量/);assert.deepEqual(other.removed,[])
})
test('odds owner parsing does not grant eviction rights to arbitrary storage keys',()=>{
  assert.equal(oddsStorageOwner('race-ability-odds:v1:owner:20261128:race'),'owner')
  assert.equal(oddsStorageOwner('unrelated:owner:20261128:race'),null)
  assert.equal(oddsStorageOwner('race-ability-odds:v1:short'),null)
})
