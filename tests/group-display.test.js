import test from 'node:test'
import assert from 'node:assert/strict'
import {displayGroups} from '../src/groupDisplay.js'
const race={id:'RACE1',raceDate:'20261123'},field=[1,2,3,4].map(no=>({no,name:`Horse ${no}`}))
const snapshot={id:'S1',odds:{1:2,2:3,3:4,4:12}}
const preference={raceId:'RACE1',raceDate:'20261123',snapshotId:'S1',threshold:1.5,boundaries:[3]}
test('display groups reuse the price-gap method and the same snapshot manual boundaries without mutating inputs',()=>{
 const before=JSON.stringify({field,snapshot,preference})
 assert.deepEqual(displayGroups({race,field,snapshot}).membership,{1:'A',2:'B',3:'B',4:'C'})
 const manual=displayGroups({race,field,snapshot,preference})
 assert.deepEqual(manual.membership,{1:'A',2:'A',3:'B',4:'B'});assert.equal(manual.manual,true)
 assert.equal(JSON.stringify({field,snapshot,preference}),before)
})
test('different races, dates, snapshots, invalid cuts and incomplete odds cannot inherit incorrect group labels',()=>{
 for(const change of [{raceId:'OTHER'},{raceDate:'20261122'},{threshold:NaN}]){
  assert.equal(displayGroups({race,field,snapshot,preference:{...preference,...change}}).manual,false)
 }
 const other=displayGroups({race,field,snapshot:{...snapshot,id:'S2'},preference})
 assert.equal(other.manual,false);assert.equal(other.differentObservation,true)
 assert.deepEqual(other.membership,{1:'A',2:'B',3:'B',4:'C'})
 const tie=displayGroups({race,field,snapshot:{...snapshot,odds:{1:2,2:3,3:3,4:12}},preference})
 assert.equal(tie.manual,false);assert.equal(tie.reset,true)
 assert.equal(displayGroups({race,field,snapshot:{id:'S1',odds:{1:2}},preference}).complete,false)
})
