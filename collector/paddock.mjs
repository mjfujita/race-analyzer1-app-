const norm=value=>String(value??'').normalize('NFKC').replace(/[\s＊*]/g,'')
const blank=value=>!value||/^(?:null|undefined|[-―—]+|取消|除外|未発表|未提供)$/i.test(value.trim())

/** Parse only the named JRDB comment column after matching the complete race field. */
export function parsePaddockTab(tab,race,retrievedAt){
  const fallback={status:'not-collected',checkedAt:null,comments:[],fieldSize:0}
  if(!tab)return fallback
  const checkedAt=tab.checkedAt
  if(typeof checkedAt!=='string'||!/(?:Z|[+-]\d\d:\d\d)$/.test(checkedAt)||!Number.isFinite(Date.parse(checkedAt))||Date.parse(checkedAt)>Date.parse(retrievedAt))return {...fallback,status:'failed'}
  const base={checkedAt,comments:[],fieldSize:0}
  if(['failed','tab-missing'].includes(tab.status))return {...base,status:tab.accessNotice?'not-provided':tab.status}
  const rows=tab.rows
  if(!Array.isArray(rows)||rows.length!==race.fieldSize||rows.length!==race.horses.length)return {...base,status:tab.accessNotice?'not-provided':'failed'}
  const seen=new Set(),comments=[]
  for(const row of rows){
    const no=Number(row.umaban),horse=race.horses.find(h=>Number(h.horseNo)===no)
    const name=typeof row.bamei9m==='object'?row.bamei9m.fullName??row.bamei9m.text:row.bamei9m
    if(!horse||seen.has(no)||norm(name)!==norm(horse.name)||typeof row.comment!=='string')return {...base,status:'failed'}
    seen.add(no)
    const text=row.comment.replace(/\r/g,'').trim().slice(0,6000)
    if(blank(text))continue
    const parts=text.split(/(?=^(?:パドック|パ|返し馬|返馬|返)\s*[：:])/m)
    for(const part of parts){
      const match=/^(パドック|パ|返し馬|返馬|返)\s*[：:]\s*([\s\S]*)$/.exec(part.trim())
      if(!match||blank(match[2]))continue
      const stage=['パ','パドック'].includes(match[1])?'paddock':'warmup'
      comments.push({horseNo:no,stage,text:`${stage==='paddock'?'パドック':'返し馬'}：${match[2].trim().slice(0,2000)}`})
    }
  }
  return {...base,fieldSize:seen.size,comments,status:comments.length?'available':tab.accessNotice?'not-provided':'empty'}
}
