import {journalDate,latestResult,legacyPrediction,resolvedResult,reviewPrediction} from './predictionJournal.js'
import {raceTimestamp} from './raceTime.js'

const places={'01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'}
export const raceResultName=race=>`${race.place??places[race.placeCode]??''}${race.raceNo?`${race.raceNo}R`:race.name??race.id}`
export function journalPlans(journal,legacy=[]){
  return [...new Map([...legacy.filter(p=>p.decision==='plan').map(legacyPrediction),...(journal.remote.legacy??[]),...journal.data.predictions].map(p=>[p.id,p])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt)||a.id.localeCompare(b.id))
}

// A result-only race remains visible. Group labels always come from its saved prediction.
export function racePredictionRows({raceDate,races=[],plans=[],results=[],official=[]}){
  const map=new Map()
  for(const race of [...plans.map(p=>p.race),...races]){
    if(journalDate(race)!==raceDate)continue
    const id=String(race.id),previous=map.get(id)??{}
    map.set(id,{...previous,...Object.fromEntries(Object.entries(race).filter(([,v])=>v!==null&&v!==undefined&&v!=='')),id,raceDate,place:race.place||previous.place||places[race.placeCode]||''})
  }
  // Imported results can precede the race catalog; retain their identity without inventing metadata.
  for(const result of [...results,...official])if(result.raceDate===raceDate&&!map.has(result.raceId))map.set(result.raceId,{id:result.raceId,raceDate})
  return [...map.values()].map(race=>{
    const saved=plans.filter(p=>p.race.id===race.id&&p.race.raceDate===raceDate),plan=saved.at(-1)??null
    const result=resolvedResult(latestResult(results.filter(r=>r.raceDate===raceDate),race.id),official.find(r=>r.raceId===race.id&&r.raceDate===raceDate))??null
    return {race,plans:saved,plan,result,view:plan?reviewPrediction(plan,result):null}
  }).sort((a,b)=>(Date.parse(raceTimestamp(a.race,a.race.postTime))||Infinity)-(Date.parse(raceTimestamp(b.race,b.race.postTime))||Infinity)||raceResultName(a.race).localeCompare(raceResultName(b.race),'ja',{numeric:true}))
}
export function raceGroupTally(rows){
  const groups=new Map();let count=0
  for(const row of rows){if(row.view?.state!=='ready')continue;count++;row.view.resultGroups.forEach((g,i)=>{if(!groups.has(g))groups.set(g,[0,0,0]);groups.get(g)[i]++})}
  return {count,groups:[...groups].sort(([a],[b])=>a.localeCompare(b))}
}
