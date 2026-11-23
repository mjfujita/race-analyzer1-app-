import {decisionCutoff,japanRaceDay,raceDateISO,validTimestamp} from './raceTime.js'
import {availableAt} from './predictionModel.js'

export const venueNames={'01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'}
export function assessmentNumber(value){
  if(typeof value==='number')return Number.isFinite(value)?value:null
  const n=typeof value==='string'&&/^[+-]?\d+(?:\.\d+)?$/.test(value.trim())?Number(value):NaN
  return Number.isFinite(n)?n:null
}
// JRDB SED stores front/last 3F as sec x 10. The legacy catalog forwards
// these three-digit integers as camelCase; newer imports may already use seconds.
export function assessmentTime(value,unit=null){
  const n=assessmentNumber(value)
  if(n===null||n<=0||unit&&!['seconds','tenths'].includes(unit))return null
  const seconds=unit==='tenths'||unit===null&&Number.isInteger(n)&&n>=100&&n<=999?n/10:n
  return seconds>0&&seconds<120?seconds:null
}
const digits=value=>String(value??'').replace(/[^0-9]/g,'')
function surface(row){
  const value=row.surface??row.surfaceCode??row.surface_code
  if(['1','芝'].includes(String(value)))return '芝'
  if(['2','ダ','ダート'].includes(String(value)))return 'ダート'
  if(['3','障','障害'].includes(String(value)))return '障害'
  const prefix=/^(芝|ダート|ダ|障害|障)/.exec(row.dist??row.distance??'')?.[1]
  return prefix==='ダ'?'ダート':prefix==='障'?'障害':prefix??null
}
function distance(row){
  const n=assessmentNumber(row.distance)
  return n>0?n:Number(/(?:芝|ダート|障害)?\s*(\d{3,4})m?/.exec(row.dist??row.distance??'')?.[1])||null
}
function place(row){
  const code=String(row.placeCode??row.place_code??String(row.raceId??'').slice(0,2)).padStart(2,'0')
  return venueNames[code]?code:Object.keys(venueNames).find(k=>venueNames[k]===(row.place??row.venue))??null
}
function earlierDate(value,target,today){
  const date=digits(value)
  if(date.length===8)return raceDateISO({raceDate:date})&&date<target&&date<=today?date:null
  // A month-only legacy record is safe only when its entire month precedes the race.
  if(date.length===6&&+date.slice(4)>=1&&+date.slice(4)<=12&&date<target.slice(0,6)&&date<=today.slice(0,6))return date
  return null
}
function conditionRecord(runs,known,matches){
  const comparable=runs.filter(known)
  if(!comparable.length)return {runs:null,topThree:null}
  const matched=comparable.filter(matches)
  return {runs:matched.length,topThree:matched.filter(r=>r.rank<=3).length}
}

/** Display-only assessment: no odds, learned coefficients, or probability mutations. */
export function assessHorses(race,horses=[],statistics=[],now=Date.now()){
  const target=raceDateISO(race)?.replaceAll('-',''),today=japanRaceDay(now)
  const stats=new Map(statistics.filter(r=>!r.race_key||String(r.race_key)===String(race?.id)).map(r=>[Number(r.horse_no),r]))
  const idmFor=h=>assessmentNumber(stats.get(Number(h.no))?.idm)??assessmentNumber(h.idm)
  const active=horses.filter(h=>!h.cancelled),indices=active.map(idmFor).filter(v=>v!==null)
  const targetSurface=surface(race??{}),targetDistance=distance(race??{}),targetPlace=place(race??{})
  return horses.map(horse=>{
    const raw=Array.isArray(horse.pastRuns)?horse.pastRuns:[],verified=[]
    for(const run of raw){
      if(!run||typeof run!=='object'||Array.isArray(run))continue
      const date=target&&earlierDate(run.raceDate??run.race_date??run.date,target,today)
      if(!date)continue
      const rank=assessmentNumber(run.rank),fieldSize=assessmentNumber(run.field_size??run.fieldSize)
      verified.push({date,rank:Number.isInteger(rank)&&rank>0&&(!fieldSize||rank<=fieldSize)?rank:null,
        fieldSize,surface:surface(run),distance:distance(run),placeCode:place(run),going:run.going??null,
        last3f:assessmentTime(run.last3f??run.last_3f,run.last3fUnit??run.timeUnit??(run.last_3f!=null?'tenths':null)),
        front3f:assessmentTime(run.front3f??run.front_3f,run.front3fUnit??run.timeUnit??(run.front_3f!=null?'tenths':null))})
    }
    const pastRuns=verified.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,5),valid=pastRuns.filter(r=>r.rank!==null)
    const idm=idmFor(horse),rank=!horse.cancelled&&idm!==null?1+indices.filter(v=>v>idm).length:null
    const records={
      distance:conditionRecord(valid,r=>targetSurface&&targetDistance&&r.surface&&r.distance,r=>r.surface===targetSurface&&Math.abs(r.distance-targetDistance)<=200),
      venue:conditionRecord(valid,r=>targetSurface&&targetPlace&&r.surface&&r.placeCode,r=>r.surface===targetSurface&&r.placeCode===targetPlace),
      course:conditionRecord(valid,r=>targetSurface&&targetPlace&&targetDistance&&r.surface&&r.placeCode&&r.distance,r=>r.surface===targetSurface&&r.placeCode===targetPlace&&r.distance===targetDistance),
    }
    const warnings=[]
    if(!pastRuns.length)warnings.push(/新馬/.test(race?.name??'')?'新馬戦のため過去走による条件比較はできません。':'日付を確認できる過去走がなく、条件適性は判定保留です。')
    else if(valid.length<3)warnings.push(`比較できる着順は${valid.length}走分で、少数の実績です。`)
    if(raw.length>verified.length)warnings.push(`同日以降・日付不明の${raw.length-verified.length}走は評価から除外しました。`)
    if(indices.length<active.length)warnings.push(`IDMは${indices.length}/${active.length}頭分のみ取得。順位は取得できた馬の範囲です。`)
    const ability=horse.cancelled?'出走取消のため今回の能力順位から除外。':rank?`出走時IDM ${idm}、取得済み${indices.length}頭中${rank}位。`:'出走時IDMが未取得のため、能力比較は保留。'
    const condition=records.distance.runs===null?'距離適性の比較材料は未取得です。':records.distance.runs>0?`今回に近い距離では${records.distance.runs}走中${records.distance.topThree}回の3着内。`:'取得した近走に、今回と近い距離の出走はありません。'
    return {no:Number(horse.no),name:horse.name,idm,rank,knownIdms:indices.length,activeCount:active.length,cancelled:Boolean(horse.cancelled),
      style:({1:'逃げ',2:'先行',3:'差し',4:'追込'})[horse.style??horse.running_style]??horse.style??null,
      pastRuns,records,summary:ability+condition,warnings,
      history:{runs:valid.length,first:valid.filter(r=>r.rank===1).length,second:valid.filter(r=>r.rank===2).length,third:valid.filter(r=>r.rank===3).length}}
  })
}

export function assessmentContext(race,cloud,{beforeCutoff=true,asOf=null,now=Date.now()}={}){
  const cutoffAt=decisionCutoff(race),protectedBoundary=validTimestamp(cutoffAt)?new Date(Math.min(now,Date.parse(cutoffAt),validTimestamp(asOf)?Date.parse(asOf):now)).toISOString():null
  const boundary=beforeCutoff?protectedBoundary:new Date(now).toISOString()
  const matches=row=>row&&String(row.raceId)===String(race?.id)&&raceDateISO(row)===raceDateISO(race)
  const events=Array.isArray(cloud?.observations)?cloud.observations:[]
  const candidates=[...events.filter(e=>e.kind==='LIVE_RACE').map(e=>e.payload),cloud?.context]
    .filter(row=>matches(row)&&availableAt(row,new Date(now).toISOString()))
  const source=candidates.filter(row=>boundary&&availableAt(row,boundary)).sort((a,b)=>Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))[0]??null
  return {source,cutoffAt,referenceOnly:Boolean(source&&(!protectedBoundary||!availableAt(source,protectedBoundary))),
    afterCutoff:Boolean(source&&validTimestamp(cutoffAt)&&Date.parse(source.retrievedAt)>Date.parse(cutoffAt)),
    hasLater:candidates.some(row=>protectedBoundary&&!availableAt(row,protectedBoundary))}
}

export function horsePaddock(source,no){
  const horse=(Array.isArray(source?.horses)?source.horses:[]).find(h=>h&&Number(h.horseNo??h.no)===no)
  const paddock=(Array.isArray(source?.paddock)?source.paddock:[]).find(h=>h&&Number(h.horseNo??h.no)===no)
  const weight=assessmentNumber(horse?.horseWeight??paddock?.horseWeight)
  const comments=(Array.isArray(source?.paddockComments)?source.paddockComments:[])
    .filter(c=>c&&Number(c.horseNo??c.no)===no).map(c=>c.comment??c.text).filter(c=>typeof c==='string'&&c.trim()).map(c=>c.trim().slice(0,2000))
  return {weight:weight>0?weight:null,delta:assessmentNumber(horse?.horseWeightDelta??paddock?.horseWeightDelta),
    index:assessmentNumber(horse?.paddockIndex??paddock?.paddockIndex),screenIdm:assessmentNumber(horse?.idm),comments}
}
