import {decisionCutoff,raceDateISO,raceTimestamp,validTimestamp} from './raceTime.js'

const clock=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
export const progressTime=value=>validTimestamp(value)?clock.format(new Date(value)):'時刻未取得'

/** Result availability is observed evidence, independent of forecasts or scheduled start time. */
export function summarizeRaceResult(source,race,now=Date.now()){
  const empty={state:'unavailable',retrievedAt:null,places:[]}
  if(!source)return empty
  const post=raceTimestamp(race,race.postTime??race.post_time)
  if(String(source.raceId)!==String(race.id??race.raceId)||raceDateISO(source)!==raceDateISO(race)
    ||!post||!validTimestamp(source.retrievedAt)||Date.parse(source.retrievedAt)>now
    ||Date.parse(source.retrievedAt)<Date.parse(post))return empty
  if(!Array.isArray(source.results)||!source.results.length)return {...empty,retrievedAt:source.retrievedAt}
  const field=new Set((Array.isArray(source.horses)?source.horses:[]).filter(h=>h&&!h.cancelled).map(h=>Number(h.horseNo??h.no)))
  const seen=new Set(),places=[]
  for(const row of source.results){
    const horseNo=Number(row?.horseNo??row?.no),rank=Number(row?.rank)
    if(!Number.isInteger(horseNo)||!field.has(horseNo)||seen.has(horseNo)||!Number.isInteger(rank)||rank<1||rank>field.size)
      return {state:'check-required',retrievedAt:source.retrievedAt,places:[]}
    seen.add(horseNo)
    if(rank<=3)places.push({horseNo,rank})
  }
  places.sort((a,b)=>a.rank-b.rank||a.horseNo-b.horseNo)
  const complete=places.length>=Math.min(3,field.size)&&places.length>0&&places[0].rank===1
    &&places.every((p,i)=>p.rank===(i&&p.rank===places[i-1].rank?places[i-1].rank:i+1))
  return {state:complete?'available':'partial',retrievedAt:source.retrievedAt,places:complete?places:[]}
}

export function raceProgressState(race,result,now=Date.now()){
  const cutoffAt=decisionCutoff(race),postAt=raceTimestamp(race,race.postTime??race.post_time)
  const phase=!postAt?'発走時刻未取得':now>=Date.parse(postAt)?'発走時刻経過':now>=Date.parse(cutoffAt)?'判断締切':'判断締切前'
  const labels={available:'結果反映済み',partial:'結果一部取得','check-required':'結果を確認中',unavailable:postAt&&now>=Date.parse(postAt)?'結果待ち':'結果未取込'}
  return {phase,cutoffAt,postAt,resultLabel:labels[result?.state]??'結果未確認',resultAvailable:result?.state==='available'}
}
