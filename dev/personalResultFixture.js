import {race,horses,demoSnapshots} from './fixtures.js'
import {oddsStorageKey} from '../src/oddsHistory.js'
import {createPrediction,createJournalResult,journalKey} from '../src/predictionJournal.js'
import {raceDateISO} from '../src/raceTime.js'

// Synthetic, local-only review route. Never reads or writes production accounts.
export function seedPersonalResultFixture(storage,userId) {
  if(storage.getItem(journalKey(userId,race.raceDate)))return
  const history=demoSnapshots().filter(s=>Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z'))
    .map(s=>({...s,odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}))
  storage.setItem(oddsStorageKey(userId,race),JSON.stringify(history))
  const prediction=createPrediction({race,field:horses.map(h=>({no:h.no,name:h.name})),snapshot:history.at(-1),threshold:1.5,boundaries:null,slots:[['A'],['C'],['C']],type:'3連単',note:'A群を1着、C群を2・3着に選択'},'2026-11-15T06:25:00Z','demo-journal-plan')
  const result=createJournalResult({raceId:race.id,raceDate:race.raceDate,numbers:[1,3,5],payouts:[{type:'3連単',per100:12340}],source:'user-image',evidence:'架空の結果画像'},'2026-11-15T07:00:00Z','demo-journal-result')
  storage.setItem(journalKey(userId,race.raceDate),JSON.stringify({predictions:[prediction],results:[result]}))
  storage.setItem(`race-companion-cache:v1:${userId}:${raceDateISO(race)}:${race.id}`,JSON.stringify({race:{...race,horses},observations:[{
    kind:'LIVE_RACE',eventId:'synthetic-personal-preview-result',retrievedAt:'2026-11-15T07:00:00Z',payload:{raceId:race.id,raceDate:race.raceDate,
      releaseFieldSize:8,priceStatus:'final-visible',results:[1,3,5,2,4,6,7,8].map((horseNo,i)=>({horseNo,rank:i+1}))}}]}))
}
