import test from 'node:test'
import assert from 'node:assert/strict'
import {raceProgressState,summarizeRaceResult} from '../src/raceProgress.js'
const race={id:'05265601',raceDate:'20261123',postTime:'1000'}
const now=Date.parse('2026-11-23T03:00:00Z')
const source={raceId:race.id,raceDate:race.raceDate,retrievedAt:'2026-11-23T01:05:00Z',horses:[1,2,3,4].map(horseNo=>({horseNo})),results:[{horseNo:2,rank:1},{horseNo:1,rank:2},{horseNo:3,rank:3}]}

test('scheduled phase changes at T10 and post, independent of confirmed result availability',()=>{
  assert.equal(raceProgressState(race,null,Date.parse('2026-11-23T00:49:59Z')).phase,'判断締切前')
  assert.equal(raceProgressState(race,null,Date.parse('2026-11-23T00:50:00Z')).phase,'判断締切')
  const after=raceProgressState(race,{state:'unavailable'},Date.parse('2026-11-23T01:00:00Z'))
  assert.equal(after.phase,'発走時刻経過');assert.equal(after.resultLabel,'結果待ち')
  assert.equal(raceProgressState({...race,postTime:null},null,now).phase,'発走時刻未取得')
})

test('results require actual post-start acquisition, matching race, valid distinct horses, and a complete podium',()=>{
  assert.equal(summarizeRaceResult(source,race,now).state,'available')
  for(const change of [{raceId:'other'},{raceDate:'20261122'},{retrievedAt:'2026-11-23T04:00:00Z'},{retrievedAt:'2026-11-23T00:55:00Z'},{retrievedAt:null}])assert.equal(summarizeRaceResult({...source,...change},race,now).state,'unavailable')
  assert.equal(summarizeRaceResult({...source,results:[{horseNo:2,rank:1}]},race,now).state,'partial')
  for(const results of [[{horseNo:2,rank:1},{horseNo:2,rank:2}],[{horseNo:18,rank:1}],[null]])assert.equal(summarizeRaceResult({...source,results},race,now).state,'check-required')
  assert.equal(summarizeRaceResult({...source,results:[{horseNo:2,rank:1},{horseNo:1,rank:2},{horseNo:3,rank:2}]},race,now).state,'available')
  assert.deepEqual(summarizeRaceResult({...source,results:[{horseNo:2,rank:1},{horseNo:1,rank:3},{horseNo:3,rank:3}]},race,now).places,[])
})
