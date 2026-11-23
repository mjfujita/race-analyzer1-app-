import test from 'node:test'
import assert from 'node:assert/strict'
import {paddockAvailability} from '../src/horseAssessment.js'
const race={id:'05265601',raceDate:'20261123',postTime:'1000'}
const source=(time,values={})=>({raceId:race.id,raceDate:race.raceDate,observedAt:time,retrievedAt:time,availabilityAt:time,timingEvidence:'observed-visible-at',
 horses:[{horseNo:1,paddockIndex:null,horseWeight:480}],...values})
const early=source('2026-11-23T00:20:00Z'),late=source('2026-11-23T03:14:00Z',{horses:[{horseNo:1,paddockIndex:3.6,horseWeight:482}],
 paddockComments:[{horseNo:1,text:'パドック：取得コメント'}],paddockCapture:{status:'available',checkedAt:'2026-11-23T03:13:58Z'}})
const cloud={context:late,observations:[{kind:'LIVE_RACE',payload:early},{kind:'LIVE_RACE',payload:late}]}
const now=Date.parse('2026-11-23T03:20:00Z')

test('late paddock is described as acquired but excluded; protected values never leak into the prediction view',()=>{
 const result=paddockAvailability(race,cloud,1,{now})
 assert.equal(result.context.source,early)
 assert.equal(result.paddock.index,null)
 assert.deepEqual(result.paddock.comments,[])
 assert.equal(result.indexMissing,'締切後に取得済み')
 assert.equal(result.commentMissing,'締切後に取得済み')
 assert.deepEqual(result.lateFields,['パドック点','コメント'])
 assert.equal(result.paddock.weight,480)
 const latest=paddockAvailability(race,cloud,1,{now,beforeCutoff:false})
 assert.equal(latest.paddock.index,3.6)
 assert.equal(latest.paddock.comments[0],'パドック：取得コメント')
 assert.equal(latest.context.referenceOnly,true)
 assert.equal(paddockAvailability(race,cloud,1,{now,asOf:'2026-11-23T00:10:00Z'}).reason,'参照時点より後')
})

test('per-horse blank points, zero points, restricted content, collector failure and legacy data remain distinguishable',()=>{
 const data=source('2026-11-23T00:30:00Z',{horses:[{horseNo:1,paddockIndex:null},{horseNo:2,paddockIndex:0}],paddockCapture:{status:'not-provided'}})
 const result=paddockAvailability(race,{context:data},1,{now})
 assert.equal(result.indexMissing,'画面に点数の記載なし')
 assert.match(result.commentMissing,/オプション情報/)
 assert.equal(paddockAvailability(race,{context:data},2,{now}).paddock.index,0)
 assert.match(paddockAvailability(race,{context:early},1,{now}).commentMissing,/旧取得方式/)
 const failed={...data,paddockCapture:{status:'failed'}}
 assert.match(paddockAvailability(race,{context:failed},1,{now}).commentMissing,/取得に失敗/)
 const empty={...data,paddockCapture:{status:'empty'}}
 assert.equal(paddockAvailability(race,{context:empty},1,{now}).commentMissing,'コメント欄に記載なし')
 const latestDenied={...late,paddockComments:[],paddockCapture:{status:'not-provided'}}
 assert.match(paddockAvailability(race,{...cloud,context:latestDenied,observations:[{kind:'LIVE_RACE',payload:early}]},1,{now}).latestCommentStatus,/オプション情報/)
})
