import {race} from './fixtures.js'
import {seedPersonalResultFixture} from './personalResultFixture.js'
import {createJournalResult,journalKey} from '../src/predictionJournal.js'
export const resultDemoRaces=[{...race,place:'京都'},
  {...race,id:'DEMO260812',raceNo:12,place:'東京',placeCode:'05',postTime:'1550',name:'結果のみのレース（架空）'},
  {...race,id:'DEMO260813',raceNo:10,place:'京都',postTime:'1600',name:'結果待ちのレース（架空）'}]
export function seedRaceResultsFixture(storage,userId){
  seedPersonalResultFixture(storage,userId)
  const key=journalKey(userId,race.raceDate),journal=JSON.parse(storage.getItem(key))
  if(!journal.results.some(r=>r.raceId===resultDemoRaces[1].id)){
    journal.results.push(createJournalResult({raceId:resultDemoRaces[1].id,raceDate:race.raceDate,numbers:[4,2,7],payouts:[{type:'3連単',per100:23450}],source:'user-image'},'2026-11-15T07:00:00Z','result-only-demo'))
    storage.setItem(key,JSON.stringify(journal))
  }
}
