import {journalDate} from './predictionJournal.js'
import {raceTimestamp,validTimestamp} from './raceTime.js'
const positions=['win','second','third']
const probability=p=>typeof p==='number'&&Number.isFinite(p)&&p>=0&&p<=1
const signature=basis=>JSON.stringify(Object.entries(basis?.grouping?.membership??{}).sort(([a],[b])=>Number(a)-Number(b)))
const fieldSignature=basis=>JSON.stringify((basis?.field??[]).map(h=>Number(h.no)).sort((a,b)=>a-b))
export const raceSurface=race=>['芝','ダート','障害'].includes(race.surface)?race.surface:({'1':'芝','2':'ダート','3':'障害'})[String(race.surfaceCode)]??'情報未取得'
export const raceCategory=race=>!race.name?'情報未取得':/新馬/.test(race.name)?'新馬':/未勝利/.test(race.name)?'未勝利':'その他'

/** Only actual, received pre-race records with the exact classified field are compared. */
export function preRaceAceBasis(row,{registrations=[],predictions=[],receipts={}}={}){
  const candidates=[...registrations,...predictions].filter(p=>String(p.race?.id)===String(row.race.id)&&journalDate(p.race)===journalDate(row.race))
    .sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)||String(a.id).localeCompare(String(b.id)))
  if(!candidates.length)return {record:null,reason:'事前確率の保存なし'}
  const reasons=[]
  for(const record of candidates){
    const post=Date.parse(raceTimestamp(row.race,row.race.postTime)),times=[record.createdAt,record.probabilities?.asOf,record.snapshot?.observedAt,record.snapshot?.retrievedAt]
    if(!Number.isFinite(post)||times.some(t=>!validTimestamp(t)||Date.parse(t)>=post)||Date.parse(record.probabilities.asOf)>Date.parse(record.createdAt)
      ||Date.parse(record.snapshot.observedAt)>Date.parse(record.snapshot.retrievedAt)||Date.parse(record.snapshot.retrievedAt)>Date.parse(record.createdAt)){
      reasons.push('事後登録・参照時点不明');continue
    }
    const receipt=receipts[record.id]
    if(!validTimestamp(receipt)||Date.parse(receipt)>=post||Date.parse(receipt)<Date.parse(record.createdAt)){reasons.push('発走前のクラウド受付なし');continue}
    if(signature(record)!==signature(row.groupBasis)||fieldSignature(record)!==fieldSignature(row.groupBasis)){
      reasons.push('結果と事前記録の分類が異なる');continue
    }
    const groups=record.grouping.groups,probs=record.probabilities.groups
    const complete=Array.isArray(probs)&&probs.length===groups.length&&new Set(probs.map(g=>g.label)).size===groups.length
      &&groups.every(g=>{const p=probs.find(p=>p.label===g.label);return p?.status==='ready'&&p.count===g.horses.length&&p.fieldSize===record.field.length&&positions.every(k=>probability(p[k]))})
      &&positions.every(k=>Math.abs(probs.reduce((sum,g)=>sum+g[k],0)-1)<1e-6)
    if(!complete){reasons.push('全頭分の確率が未保存・保留');continue}
    return {record,reason:null}
  }
  return {record:null,reason:reasons[0]??'事前確率の保存なし'}
}

export function groupTendencyMetrics(rows,sources={}){
  const unique=[...new Map(rows.map(row=>[`${journalDate(row.race)}:${row.race.id}`,row])).values()]
  const ready=unique.filter(row=>row.groupResult?.state==='ready'),n=ready.length,groups=new Map(),pair=new Map(),triple=new Map(),comparable=[],excluded=new Map()
  for(const row of ready){
    const fieldSize=row.groupBasis.field.length
    for(const g of row.groupBasis.grouping.groups){
      if(!groups.has(g.label))groups.set(g.label,{label:g.label,present:0,heads:0,share:0,counts:[0,0,0]})
      const stats=groups.get(g.label);stats.present++;stats.heads+=g.horses.length;stats.share+=g.horses.length/fieldSize
    }
    row.groupResult.groups.forEach((label,i)=>groups.get(label).counts[i]++)
    for(const [map,labels] of [[pair,row.groupResult.groups.slice(0,2)],[triple,row.groupResult.groups]]){const key=labels.join(' → ');map.set(key,(map.get(key)??0)+1)}
    const ace=preRaceAceBasis(row,sources)
    if(ace.record)comparable.push({row,record:ace.record})
    else excluded.set(ace.reason,(excluded.get(ace.reason)??0)+1)
  }
  const summary=[...groups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(g=>({...g,averageHeads:g.heads/g.present,averageShare:g.share/g.present,rates:g.counts.map(c=>c/n)}))
  const combinations=map=>[...map].map(([pattern,count])=>({pattern,count,rate:count/n})).sort((a,b)=>b.count-a.count||a.pattern.localeCompare(b.pattern))
  const aceGroups=new Map()
  for(const {row,record} of comparable){
    for(const p of record.probabilities.groups){
      if(!aceGroups.has(p.label))aceGroups.set(p.label,{label:p.label,expected:[0,0,0],actual:[0,0,0]})
      const stats=aceGroups.get(p.label);positions.forEach((key,i)=>{stats.expected[i]+=p[key];if(row.groupResult.groups[i]===p.label)stats.actual[i]++})
    }
  }
  return {count:n,groups:summary,pairs:combinations(pair),triples:combinations(triple),ace:{count:comparable.length,total:n,excluded:[...excluded].map(([reason,count])=>({reason,count})),
    groups:[...aceGroups.values()].sort((a,b)=>a.label.localeCompare(b.label)).map(g=>({...g,differences:g.actual.map((value,i)=>value-g.expected[i])}))}}
}
