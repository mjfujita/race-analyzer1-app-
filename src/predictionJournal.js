import {setBrowserValue} from './browserStorage.js'
import {groupOdds,formationTickets,compareGroupPlans} from './groupAnalysis.js'
import {ticketKey} from './portfolio.js'
import {raceDateISO,raceTimestamp,validTimestamp} from './raceTime.js'

const clone=v=>JSON.parse(JSON.stringify(v))
const fail=message=>{throw new Error(message)}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const types=['馬単','3連単','3連複']
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)
export const journalKey=(user,date)=>`race-prediction-journal:v1:${encodeURIComponent(user)}:${date}`
export const journalDate=race=>raceDateISO(race)?.replaceAll('-','')

export function createPrediction(input,createdAt=new Date().toISOString(),id=crypto.randomUUID()) {
  const {race,field,snapshot,slots,type,excluded=[],threshold=1.5,boundaries=null}=input
  if(!idOK(id)||!validTimestamp(createdAt)||!idOK(String(race?.id??''))||!journalDate(race)||!raceTimestamp(race,race.postTime))fail('開催日・レース・発走時刻を確認してください。')
  if(!Array.isArray(field)||field.some(h=>h.cancelled||typeof h.name!=='string'||h.name.length>100))fail('出走馬を確認してください。')
  if(snapshot?.kind!=='observed'||String(snapshot.raceId)!==String(race.id)||String(snapshot.raceDate).replaceAll('-','')!==journalDate(race)
    ||![snapshot.observedAt,snapshot.retrievedAt].every(validTimestamp)||Date.parse(snapshot.observedAt)>Date.parse(snapshot.retrievedAt)||Date.parse(snapshot.retrievedAt)>Date.parse(createdAt))fail('入力時点までに取得した同じレースの観測が必要です。')
  const grouping=groupOdds(field,snapshot.odds,threshold,boundaries)
  if(!grouping.complete||!Array.isArray(excluded)||new Set(excluded).size!==excluded.length||excluded.some(no=>!field.some(h=>h.no===no)))fail('全頭のオッズと除外馬を確認してください。')
  if(!types.includes(type))fail('券種を選んでください。')
  const normalized=slots?.map(s=>Array.isArray(s)?[...new Set(s)].sort():s)
  const tickets=formationTickets(grouping,normalized,type,excluded)
  if(!tickets.length)fail('買い目がありません。グループを選んでください。')
  const probabilities=input.probabilities??{groups:[],horses:[],asOf:null}
  if(!Array.isArray(probabilities.groups)||!Array.isArray(probabilities.horses)||probabilities.groups.length>18||probabilities.horses.length>18
    ||probabilities.asOf!==null&&(!validTimestamp(probabilities.asOf)||Date.parse(probabilities.asOf)>Date.parse(createdAt)))fail('確率の参照時点を確認してください。')
  for(const row of [...probabilities.groups,...probabilities.horses])for(const key of ['win','second','third','top3','anyTop3'])if(row[key]!=null&&(!Number.isFinite(row[key])||row[key]<0||row[key]>1))fail('確率の形式が不正です。')
  if(typeof(input.note??'')!=='string'||(input.note??'').length>3500||!['formation','box','flow'].includes(input.method??'formation'))fail('買い方・メモを確認してください。')
  return clone({schemaVersion:1,kind:'selection',id,createdAt,race:{id:String(race.id),raceDate:journalDate(race),name:race.name??'',place:race.place??'',raceNo:race.raceNo??null,postTime:race.postTime},
    field:field.map(h=>({no:h.no,name:h.name})),snapshot:{id:snapshot.id,kind:snapshot.kind,raceId:String(race.id),raceDate:journalDate(race),observedAt:snapshot.observedAt,retrievedAt:snapshot.retrievedAt,odds:snapshot.odds},
    grouping,slots:normalized,excluded,type,method:input.method??'formation',note:input.note??'',probabilities,tickets})
}
export function validatePrediction(value) {
  const rebuilt=createPrediction({...value,threshold:value.grouping?.threshold,boundaries:value.grouping?.manual?value.grouping.boundaries:null},value.createdAt,value.id)
  if(!same(rebuilt,value))fail('予想の保存内容が一致しません。')
  return value
}
export function createJournalResult(input,createdAt=new Date().toISOString(),id=crypto.randomUUID()) {
  const {raceId,raceDate,numbers,payouts=[],status='normal',source='manual',evidence='',replacesId=null}=input
  if(!idOK(id)||!idOK(raceId)||!/^\d{8}$/.test(raceDate??'')||!raceDateISO({raceDate})||!validTimestamp(createdAt)||replacesId!==null&&(!idOK(replacesId)||replacesId===id))fail('結果の開催日・レースを確認してください。')
  if(!['normal','held'].includes(status)||!['manual','user-image'].includes(source)||typeof evidence!=='string'||evidence.length>500)fail('結果の出典を確認してください。')
  if(!Array.isArray(numbers)||numbers.length!==3||numbers.some(no=>!Number.isInteger(no)||no<1||no>18)||new Set(numbers).size!==3)fail('1〜3着の異なる馬番を入力してください。同着・異常結果は照合を保留します。')
  if(!Array.isArray(payouts)||payouts.length>3||new Set(payouts.map(p=>p.type)).size!==payouts.length)fail('払戻の券種を確認してください。')
  for(const p of payouts)if(!types.includes(p.type)||!Number.isSafeInteger(p.per100)||p.per100<1||p.per100>100000000)fail('確定払戻は100円あたりの金額で入力してください。')
  if(status==='held'&&payouts.length)fail('同着・異常結果は払戻の照合を保留します。')
  return {schemaVersion:1,kind:'result',id,createdAt,raceId,raceDate,numbers:[...numbers],payouts:payouts.map(p=>({type:p.type,per100:p.per100})),status,source,evidence,replacesId}
}
export function validateJournalResult(value) {
  if(!same(createJournalResult(value,value.createdAt,value.id),value))fail('結果の保存内容を確認してください。')
  return value
}
export function mergeJournal(a,b) {
  const merged={predictions:[],results:[]}
  for(const kind of ['predictions','results']){
    const rows=new Map()
    for(const row of [...a[kind],...b[kind]]){
      const previous=rows.get(row.id)
      if(previous&&!same(previous,row))fail('同じIDの記録が競合しています。既存データは保持しています。')
      rows.set(row.id,row)
    }
    merged[kind]=[...rows.values()].sort((x,y)=>x.createdAt.localeCompare(y.createdAt)||x.id.localeCompare(y.id))
  }
  for(const result of merged.results){
    if(result.replacesId&&!merged.results.some(r=>r.id===result.replacesId&&r.raceId===result.raceId&&r.raceDate===result.raceDate))fail('訂正元の結果がありません。先に同期してください。')
    if(merged.results.some(r=>r.id!==result.id&&r.raceId===result.raceId&&r.raceDate===result.raceDate&&r.replacesId===result.replacesId))fail('結果の訂正が競合しています。先に同期してください。')
  }
  for(const result of merged.results){
    const visited=new Set([result.id]);let row=result
    while(row.replacesId){const parent=merged.results.find(r=>r.id===row.replacesId);if(visited.has(parent.id)||Date.parse(parent.createdAt)>Date.parse(row.createdAt))fail('結果の訂正順序が不正です。');visited.add(parent.id);row=parent}
  }
  return merged
}
export function readJournal(storage,user,date){
  const value=JSON.parse(storage.getItem(journalKey(user,date))??'{"predictions":[],"results":[]}')
  if(!Array.isArray(value.predictions)||!Array.isArray(value.results)||value.predictions.length>1000||value.results.length>1000)fail('予想・結果の保存形式を確認できません。')
  value.predictions.forEach(validatePrediction);value.results.forEach(validateJournalResult)
  if(value.predictions.some(p=>p.race.raceDate!==date)||value.results.some(r=>r.raceDate!==date))fail('開催日が一致しません。')
  return mergeJournal({predictions:[],results:[]},value)
}
export async function writeJournal(storage,user,date,incoming,locks=globalThis.navigator?.locks){
  if(!locks?.request)fail('安全な保存のため、HTTPSまたはlocalhostで開いてください。')
  return locks.request(journalKey(user,date),()=>{
    const value=mergeJournal(readJournal(storage,user,date),incoming)
    // Validate before replacing the local cache; corruption is never silently reset.
    value.predictions.forEach(validatePrediction);value.results.forEach(validateJournalResult)
    setBrowserValue(storage,journalKey(user,date),JSON.stringify(value),user);return value
  })
}
export const latestResult=(results,raceId)=>results.filter(r=>r.raceId===raceId&&!results.some(next=>next.replacesId===r.id)).at(-1)??null
export function reviewPrediction(plan,result){
  const count=plan.type==='馬単'?2:3
  const positions=plan.slots.slice(0,count).map((labels,i)=>({labels,horses:plan.grouping.groups.filter(g=>labels.includes(g.label)).flatMap(g=>g.horses).filter(h=>!plan.excluded.includes(h.no)),position:i+1}))
  const pattern=positions.map(p=>p.labels.join('・')).join(plan.type==='3連複'?' − ':' → ')
  const ready=result?.status==='normal'&&result.raceId===plan.race.id&&result.raceDate===plan.race.raceDate&&result.numbers.every(no=>plan.field.some(h=>h.no===no))
  const resultGroups=ready?result.numbers.map(no=>plan.grouping.membership[no]):null
  const hit=ready?plan.tickets.some(t=>t.key===ticketKey(plan.type,plan.type==='馬単'?result.numbers.slice(0,2):result.numbers)):null
  return {positions,pattern,resultGroups,hit,payout:ready?result.payouts.find(p=>p.type===plan.type)?.per100??null:null,
    uniqueHorses:new Set(plan.tickets.flatMap(t=>t.numbers)).size,pointCount:plan.tickets.length,state:!result?'pending':ready?'ready':'held'}
}
export function legacyPrediction(plan){
  const selected=compareGroupPlans(plan.grouping,plan.slots,plan.excluded).find(p=>p.id===plan.variant)
  return {...plan,kind:'legacy',type:selected.type,slots:selected.slots,tickets:plan.allocations.filter(t=>t.stake>0).map(({key,type,numbers})=>({key,type,numbers})),method:'formation',probabilities:{groups:[],horses:[],asOf:null}}
}

// Automatic evidence stays separate from image/manual entries and their correction history.
export function officialJournalResult(race,observations,now=Date.now()){
  const post=raceTimestamp(race,race.postTime),date=journalDate(race)
  const events=(observations??[]).filter(e=>String(e.payload?.raceId)===String(race.id)&&String(e.payload?.raceDate).replaceAll('-','')===date&&validTimestamp(e.retrievedAt)&&Date.parse(e.retrievedAt)>=Date.parse(post)&&Date.parse(e.retrievedAt)<=now).sort((a,b)=>b.retrievedAt.localeCompare(a.retrievedAt))
  const live=events.find(e=>e.kind==='LIVE_RACE'),p=live?.payload
  if(p?.priceStatus!=='final-visible'||p.horses?.some(h=>h.cancelled)||!Array.isArray(p.results)||p.results.length!==p.releaseFieldSize)return null
  const results=[...p.results].sort((a,b)=>a.rank-b.rank)
  if(results.some((r,i)=>r.rank!==i+1)||new Set(results.map(r=>r.horseNo)).size!==results.length||results.length<3)return null
  if(events.some(e=>e.kind==='LIVE_RACE'&&e.retrievedAt===live.retrievedAt&&!same(e.payload.results,p.results)))return null
  const numbers=results.slice(0,3).map(r=>r.horseNo)
  const hjc=events.find(e=>e.kind==='HJC'&&e.payload.status==='published')
  const payouts=(hjc?.payload.payouts??[]).filter(row=>types.includes(row.type))
  if(payouts.some(row=>row.key!==ticketKey(row.type,row.type==='馬単'?numbers.slice(0,2):numbers)))return null
  return {id:live.eventId,raceId:String(race.id),raceDate:date,numbers,payouts:payouts.map(row=>({type:row.type,per100:row.per100})),status:'normal',source:'jrdb',createdAt:live.retrievedAt}
}
export function resolvedResult(manual,official){
  if(manual&&official&&(!same(manual.numbers,official.numbers)||manual.payouts.some(p=>official.payouts.some(o=>o.type===p.type&&o.per100!==p.per100))))return {...manual,status:'held',conflict:true}
  return manual?{...manual,payouts:[...new Map([...(official?.payouts??[]),...manual.payouts].map(p=>[p.type,p])).values()]}:official
}
