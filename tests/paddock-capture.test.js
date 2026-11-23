import test from 'node:test'
import assert from 'node:assert/strict'
import {parsePaddockTab} from '../collector/paddock.mjs'
import {parseVisibleRace,capturePaddockTab} from '../collector/capture.mjs'
const race={raceId:'05265601',raceDate:'20261123',postTime:'1000',fieldSize:2,horses:[{horseNo:1,name:'架空馬A'},{horseNo:2,name:'架空馬B'}]}
const at='2026-11-23T00:45:00Z',retrievedAt='2026-11-23T00:46:00Z'
const rows=()=>[{umaban:'1',bamei9m:{text:'架空',fullName:'架空馬A'},comment:'パ:歩様は一定\n返:折り合い良好'},{umaban:'2',bamei9m:'架空馬B',comment:'パ:null\n返:取消'}]

test('paddock and warmup comments match the full horse identity and are read only from their named column',()=>{
 const report=parsePaddockTab({rows:rows(),checkedAt:at},race,retrievedAt)
 assert.equal(report.status,'available')
 assert.deepEqual(report.comments,[{horseNo:1,stage:'paddock',text:'パドック：歩様は一定'},{horseNo:1,stage:'warmup',text:'返し馬：折り合い良好'}])
 const wrong=rows();wrong[1].bamei9m='別の馬'
 assert.equal(parsePaddockTab({rows:wrong,checkedAt:at},race,retrievedAt).status,'failed')
 assert.deepEqual(parsePaddockTab({rows:wrong,checkedAt:at},race,retrievedAt).comments,[])
 const duplicate=rows();duplicate[1]=duplicate[0]
 assert.equal(parsePaddockTab({rows:duplicate,checkedAt:at},race,retrievedAt).status,'failed')
})

test('empty, optional-content access, missing tab, failures and unknown legacy collection remain distinct',()=>{
 const empty=rows().map(r=>({...r,comment:''}))
 assert.equal(parsePaddockTab({rows:empty,checkedAt:at},race,retrievedAt).status,'empty')
 assert.equal(parsePaddockTab({rows:empty,accessNotice:true,checkedAt:at},race,retrievedAt).status,'not-provided')
 assert.equal(parsePaddockTab({rows:rows(),accessNotice:true,checkedAt:at},race,retrievedAt).status,'available')
 assert.equal(parsePaddockTab({status:'failed',checkedAt:at},race,retrievedAt).status,'failed')
 assert.equal(parsePaddockTab({status:'failed',accessNotice:true,checkedAt:at},race,retrievedAt).status,'not-provided')
 assert.equal(parsePaddockTab({status:'tab-missing',checkedAt:at},race,retrievedAt).status,'tab-missing')
 assert.equal(parsePaddockTab(null,race,retrievedAt).status,'not-collected')
 assert.equal(parsePaddockTab({rows:rows(),checkedAt:'2026-11-23T00:50:00Z'},race,retrievedAt).status,'failed')
})

test('the collection retains its real completion time and cannot backdate comments into an older main observation',()=>{
 const main={rows:race.horses.map(h=>({umaban:String(h.horseNo),bamei9m:h.name,tanodds:'3.0',kijtanodds:'4.0',se_tyakujun:''})),historyTable:[],paddockTab:{rows:rows(),checkedAt:at}}
 const out=parseVisibleRace(main,race,{retrievedAt})
 assert.equal(out.observation.payload.paddockCapture.status,'available')
 assert.equal(out.observation.payload.paddockCapture.checkedAt,at)
 assert.equal(out.observation.payload.retrievedAt,retrievedAt)
 assert.equal(out.observation.payload.paddockComments.length,2)
 const older=parseVisibleRace(main,race,{retrievedAt:'2026-11-23T00:40:00Z'})
 assert.equal(older.observation.payload.paddockCapture.status,'failed')
 assert.deepEqual(older.observation.payload.paddockComments,[])
})

test('capture opens the actual paddock tab and waits for the expected race; failure never fabricates empty success',async()=>{
 let clicked=false,waited=false
 const tab={async count(){return 1},async click(){clicked=true}}
 const page={locator:selector=>selector.includes('tabs-1')?tab:{async innerText(){return 'パドック返し馬コメント情報はオプションコンテンツです。'}},
  async waitForFunction(_fn,expected){assert.deepEqual(expected,race.horses);waited=true},
  async evaluate(){assert.ok(clicked&&waited);return {rows:rows(),accessNotice:false}}}
 const result=await capturePaddockTab(page,race,{})
 assert.equal(result.status,'read')
 assert.equal(result.rows.length,2)
 page.waitForFunction=async()=>{throw new Error('timeout')}
 const failure=await capturePaddockTab(page,race,{})
 assert.equal(failure.status,'failed');assert.equal(failure.accessNotice,true)
})
