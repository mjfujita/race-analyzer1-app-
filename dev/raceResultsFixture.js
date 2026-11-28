import {race,horses,demoSnapshots} from './fixtures.js'
import {oddsStorageKey} from '../src/oddsHistory.js'
import {seedPersonalResultFixture} from './personalResultFixture.js'
import {createJournalResult,journalKey} from '../src/predictionJournal.js'
export const resultDemoRaces=[{...race,horses,place:'京都'},
  {...race,horses,id:'DEMO260812',raceNo:12,place:'東京',placeCode:'05',postTime:'1550',name:'結果のみのレース（架空）'},
  {...race,horses,id:'DEMO260813',raceNo:10,place:'京都',postTime:'1600',name:'結果待ちのレース（架空）'}]
export function seedRaceResultsFixture(storage,userId){
  seedPersonalResultFixture(storage,userId)
  for(const other of resultDemoRaces.slice(1))if(!storage.getItem(oddsStorageKey(userId,other)))storage.setItem(oddsStorageKey(userId,other),JSON.stringify(demoSnapshots().filter(s=>s.kind==='observed'&&Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z')).map(s=>({...s,raceId:other.id,odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}}))))
  const key=journalKey(userId,race.raceDate),journal=JSON.parse(storage.getItem(key))
  if(!journal.results.some(r=>r.raceId===resultDemoRaces[1].id)){
    journal.results.push(createJournalResult({raceId:resultDemoRaces[1].id,raceDate:race.raceDate,numbers:[4,2,7],payouts:[{type:'3連単',per100:23450}],source:'user-image'},'2026-11-15T07:00:00Z','result-only-demo'))
    storage.setItem(key,JSON.stringify(journal))
  }
}
