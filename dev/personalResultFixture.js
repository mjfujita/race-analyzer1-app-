import {race,horses,demoSnapshots} from './fixtures.js'
import {createGroupPlan} from '../src/groupAnalysis.js'
import {appendGroupPlan,emptyLedger,ledgerScope,writeLedger,readLedger} from '../src/forecastLedger.js'
import {oddsStorageKey} from '../src/oddsHistory.js'
import {raceDateISO} from '../src/raceTime.js'

// Synthetic, local-only review route. Never reads or writes production accounts.
export function seedPersonalResultFixture(storage,userId) {
  const scope=ledgerScope(userId,race)
  const saved=readLedger(storage,scope)
  if(saved.error||saved.ledger.groupPlans?.length)return
  const history=demoSnapshots().filter(s=>Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z'))
    .map(s=>({...s,odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}))
  storage.setItem(oddsStorageKey(userId,race),JSON.stringify(history))
  const plan=createGroupPlan({race,field:horses.map(h=>({no:h.no,name:h.name,evidence:'synthetic preview'})),snapshot:history.at(-1),threshold:1.5,boundaries:null,
    slots:[['A'],['C'],['C']],variant:'ordered',budget:10000,unit:100,overrides:{},note:'私の予想｜3連単｜フォーメーション｜A → C → C'},'2026-11-15T06:25:00Z')
  writeLedger(storage,appendGroupPlan(emptyLedger(scope),plan))
  storage.setItem(`race-companion-cache:v1:${userId}:${raceDateISO(race)}:${race.id}`,JSON.stringify({race:{...race,horses},observations:[{
    kind:'LIVE_RACE',eventId:'synthetic-personal-preview-result',retrievedAt:'2026-11-15T07:00:00Z',payload:{raceId:race.id,raceDate:race.raceDate,
      releaseFieldSize:8,priceStatus:'final-visible',results:[1,3,5,2,4,6,7,8].map((horseNo,i)=>({horseNo,rank:i+1}))}}]}))
}
