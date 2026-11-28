import {groupOdds} from './groupAnalysis.js'
import {journalDate} from './predictionJournal.js'
import {raceTimestamp,snapshotTiming,validTimestamp} from './raceTime.js'
const sameRace=(source,race)=>String(source?.raceId??source?.id)===String(race.id)&&journalDate(source)===journalDate(race)

// Read-only result classification. Never creates a user's registration or prediction.
export function automaticResultGroups(race,snapshots=[],observations=[],now=Date.now()){
  if(!race?.id||!journalDate(race)||!Array.isArray(race.horses))return null
  const field=race.horses.filter(h=>!h.cancelled&&!h.scratched).map(h=>({no:Number(h.no??h.horseNo),name:h.name??''}))
  const post=Date.parse(raceTimestamp(race,race.postTime))
  if(!Number.isFinite(post))return null
  const candidates=[]
  for(const snapshot of snapshots){
    if(snapshot.kind!=='observed'||!sameRace(snapshot,race)||![snapshot.observedAt,snapshot.retrievedAt].every(validTimestamp)
      ||Date.parse(snapshot.observedAt)>Date.parse(snapshot.retrievedAt)||Date.parse(snapshot.retrievedAt)>now)continue
    try{
      const grouping=groupOdds(field,snapshot.odds)
      if(!grouping.complete)continue
      const timing=snapshotTiming(snapshot,race)
      candidates.push({snapshot,grouping,timing:timing.eligible?'deadline':Date.parse(snapshot.retrievedAt)<post?'pre-start':'reference'})
    }catch{/* Incomplete or contradictory source evidence is not guessed. */}
  }
  const finalEvents=observations.filter(e=>e.kind==='LIVE_RACE'&&sameRace(e.payload,race)&&e.payload.priceStatus==='final-visible'
    &&validTimestamp(e.retrievedAt)&&Date.parse(e.retrievedAt)>=post&&Date.parse(e.retrievedAt)<=now).sort((a,b)=>Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))
  for(const event of finalEvents.slice(0,1)){
    try{
      const odds=event.payload.finalWinOdds??event.payload.winOdds
      const grouping=groupOdds(field,odds)
      if(grouping.complete)candidates.push({snapshot:{id:event.eventId,kind:'final-reference',raceId:String(race.id),raceDate:journalDate(race),observedAt:event.retrievedAt,retrievedAt:event.retrievedAt,odds},grouping,timing:'reference'})
    }catch{/* Final odds are reference-only and require the entire field. */}
  }
  const priority={deadline:0,'pre-start':1,reference:2}
  candidates.sort((a,b)=>priority[a.timing]-priority[b.timing]||Date.parse(b.snapshot.observedAt)-Date.parse(a.snapshot.observedAt)||Date.parse(b.snapshot.retrievedAt)-Date.parse(a.snapshot.retrievedAt))
  const selected=candidates[0]
  return selected?{kind:'automatic-result-groups',race:{id:String(race.id),raceDate:journalDate(race)},field,grouping:selected.grouping,
    snapshot:{id:selected.snapshot.id,kind:selected.snapshot.kind,observedAt:selected.snapshot.observedAt,retrievedAt:selected.snapshot.retrievedAt},timing:selected.timing,probabilities:{groups:[],horses:[],asOf:null}}:null
}
export const resultBasisLabel=(registration,automatic)=>registration?'自分の登録グループ':automatic?({'deadline':'自動・締切前','pre-start':'自動・発走前参考',reference:'自動・確定後参考'})[automatic.timing]:'分類待ち'
