import {groupOdds} from './groupAnalysis.js'
import {journalDate} from './predictionJournal.js'
import {raceTimestamp,validTimestamp} from './raceTime.js'
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b)
const clone=v=>JSON.parse(JSON.stringify(v))
const fail=m=>{throw new Error(m)}
const idOK=id=>typeof id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(id)
export const registrationKey=(user,date)=>`race-group-registration:v1:${encodeURIComponent(user)}:${date}`

// Classification is independently registered; it has no betting or finishing-order choices.
export function createGroupRegistration(input,createdAt=new Date().toISOString(),id=crypto.randomUUID()){
  const {race,field,snapshot,threshold=1.5,boundaries=null,replacesId=null}=input
  if(!idOK(id)||!validTimestamp(createdAt)||!idOK(String(race?.id??''))||!journalDate(race)||!raceTimestamp(race,race.postTime)
    ||replacesId!==null&&(!idOK(replacesId)||replacesId===id))fail('グループ登録のレース・日時を確認してください。')
  if(!Array.isArray(field)||field.some(h=>h.cancelled||!Number.isInteger(h.no)||typeof h.name!=='string'||h.name.length>100))fail('出走馬を確認してください。')
  if(snapshot?.kind!=='observed'||typeof snapshot.id!=='string'||snapshot.id.length<1||snapshot.id.length>100||String(snapshot.raceId)!==String(race.id)||String(snapshot.raceDate).replaceAll('-','')!==journalDate(race)
    ||![snapshot.observedAt,snapshot.retrievedAt].every(validTimestamp)||Date.parse(snapshot.observedAt)>Date.parse(snapshot.retrievedAt)||Date.parse(snapshot.retrievedAt)>Date.parse(createdAt))fail('登録時点までに取得した同じレースの観測が必要です。')
  const grouping=groupOdds(field,snapshot.odds,threshold,boundaries)
  if(!grouping.complete)fail('全出走馬の単勝オッズを確認してください。')
  const probabilities=input.probabilities??{groups:[],horses:[],asOf:null}
  if(!Array.isArray(probabilities.groups)||!Array.isArray(probabilities.horses)||probabilities.groups.length>18||probabilities.horses.length>18
    ||probabilities.asOf!==null&&(!validTimestamp(probabilities.asOf)||Date.parse(probabilities.asOf)>Date.parse(createdAt)))fail('確率の参照時点を確認してください。')
  if(new Set(probabilities.groups.map(g=>g.label)).size!==probabilities.groups.length||probabilities.groups.some(g=>!grouping.groups.some(group=>g.label===group.label))
    ||new Set(probabilities.horses.map(h=>h.no)).size!==probabilities.horses.length||probabilities.horses.some(h=>!field.some(f=>h.no===f.no)))fail('確率の対象馬・グループが一致しません。')
  for(const row of [...probabilities.groups,...probabilities.horses])for(const key of ['win','second','third','top3','anyTop3'])if(row[key]!=null&&(!Number.isFinite(row[key])||row[key]<0||row[key]>1))fail('確率の形式が不正です。')
  return clone({schemaVersion:1,kind:'group-registration',id,createdAt,race:{id:String(race.id),raceDate:journalDate(race),name:race.name??'',place:race.place??'',raceNo:race.raceNo??null,postTime:race.postTime},
    field:field.map(h=>({no:h.no,name:h.name})),snapshot:{id:snapshot.id,kind:snapshot.kind,raceId:String(race.id),raceDate:journalDate(race),observedAt:snapshot.observedAt,retrievedAt:snapshot.retrievedAt,odds:snapshot.odds},grouping,probabilities,replacesId})
}
export function validateGroupRegistration(value){
  if(!same(createGroupRegistration({...value,threshold:value.grouping?.threshold,boundaries:value.grouping?.manual?value.grouping.boundaries:null},value.createdAt,value.id),value))fail('グループの登録内容が一致しません。')
  return value
}
export function mergeGroupRegistrations(a=[],b=[]){
  const byId=new Map()
  for(const row of [...a,...b]){
    validateGroupRegistration(row)
    if(byId.has(row.id)&&!same(byId.get(row.id),row))fail('同じIDのグループ登録が競合しています。')
    byId.set(row.id,row)
  }
  if(byId.size>1000)fail('グループ登録の件数上限を超えています。')
  const rows=[...byId.values()].sort((x,y)=>x.createdAt.localeCompare(y.createdAt)||x.id.localeCompare(y.id))
  const children=new Set()
  for(const row of rows){
    const key=`${row.race.raceDate}:${row.race.id}:${row.replacesId??'first'}`
    if(children.has(key))fail('グループが別の端末で更新されています。先に同期してください。')
    children.add(key)
    const visited=new Set([row.id]);let next=row
    while(next.replacesId){
      const parent=byId.get(next.replacesId)
      if(!parent||parent.race.id!==row.race.id||parent.race.raceDate!==row.race.raceDate)fail('更新元のグループ登録がありません。先に同期してください。')
      if(visited.has(parent.id)||Date.parse(parent.createdAt)>Date.parse(next.createdAt))fail('グループ登録の更新順序が不正です。')
      visited.add(parent.id);next=parent
    }
  }
  const depth=row=>{let n=0;while(row.replacesId){row=byId.get(row.replacesId);n++}return n}
  return rows.sort((x,y)=>x.createdAt.localeCompare(y.createdAt)||depth(x)-depth(y)||x.id.localeCompare(y.id))
}
export const latestGroupRegistration=(rows=[],raceId)=>rows.filter(r=>r.race.id===String(raceId)&&!rows.some(next=>next.replacesId===r.id)).at(-1)??null
export function readGroupRegistrations(storage,user,date){
  const rows=JSON.parse(storage.getItem(registrationKey(user,date))??'[]')
  if(!Array.isArray(rows)||rows.length>1000||rows.some(r=>r.race?.raceDate!==date))fail('グループ登録の保存形式・開催日を確認できません。')
  return mergeGroupRegistrations([],rows)
}
export async function writeGroupRegistrations(storage,user,date,incoming,locks=globalThis.navigator?.locks){
  if(!locks?.request)fail('安全な保存のため、HTTPSまたはlocalhostで開いてください。')
  return locks.request(registrationKey(user,date),()=>{
    const rows=mergeGroupRegistrations(readGroupRegistrations(storage,user,date),incoming)
    if(rows.some(r=>r.race.raceDate!==date))fail('グループ登録の開催日が一致しません。')
    storage.setItem(registrationKey(user,date),JSON.stringify(rows));return rows
  })
}
export function reviewRegisteredGroups(registration,result){
  if(!registration)return {state:'unregistered',groups:null,counts:null}
  if(!result)return {state:'pending',groups:null,counts:null}
  if(result.status!=='normal'||result.raceId!==registration.race.id||result.raceDate!==registration.race.raceDate
    ||result.numbers?.length!==3||new Set(result.numbers).size!==3||result.numbers.some(no=>!registration.grouping.membership[no]))return {state:'held',groups:null,counts:null}
  const groups=result.numbers.map(no=>registration.grouping.membership[no])
  return {state:'ready',groups,counts:groups.map(label=>registration.grouping.groups.find(g=>g.label===label).horses.length),
    probabilities:groups.map((label,i)=>registration.probabilities.groups.find(g=>g.label===label)?.[['win','second','third'][i]]??null)}
}
export function registrationMatches(registration,snapshot,grouping){
  return Boolean(registration&&snapshot&&grouping&&same(registration.snapshot.odds,snapshot.odds)&&registration.snapshot.id===snapshot.id&&same(registration.grouping,grouping))
}
