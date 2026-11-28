import { compareGroupPlans, formationTickets, reviewGroupPlan } from './groupAnalysis.js'

export const personalMethods = { formation:'フォーメーション', box:'グループBOX', flow:'グループ軸ながし' }

// Compile personal choices into the existing immutable group-plan format.
export function personalSelection({ grouping, type, method, slots = [[],[],[]], box = [], axis = '', opponents = [], position = 0 }) {
  if (!['馬単','3連単','3連複'].includes(type) || !Object.hasOwn(personalMethods,method)) throw new Error('券種と買い方を選んでください。')
  const count = type === '馬単' ? 2 : 3
  if (!Number.isInteger(position) || position < 0 || position >= count) throw new Error('軸の着順を確認してください。')
  let selected
  if (method === 'box') selected = [box,box,count === 3 ? box : []]
  else if (method === 'flow') {
    selected = Array.from({length:3},(_,i) => i >= count ? [] : i === (type === '3連複' ? 0 : position) ? (axis ? [axis] : []) : opponents)
  } else selected = slots.map((s,i) => i < count ? s : [])
  if (!Array.isArray(selected) || selected.length !== 3 || selected.some(s => !Array.isArray(s))) throw new Error('グループを選んでください。')
  const normalized = selected.map(s => [...new Set(s)].sort())
  const tickets = formationTickets(grouping,normalized,type)
  const description = method === 'box' ? `対象 ${normalized[0].join('・') || '未選択'}`
    : method === 'flow' ? `軸 ${axis || '未選択'}${type === '3連複' ? '（着順不問）' : `（${position+1}着）`} ／ 相手 ${opponents.join('・') || '未選択'}`
      : normalized.slice(0,count).map(s => s.join('・') || '未選択').join(type === '3連複' ? ' − ' : ' → ')
  return { slots:normalized, variant:({馬単:'exacta','3連単':'ordered','3連複':'trio'})[type], tickets,
    note:`私の予想｜${type}｜${personalMethods[method]}｜${description}` }
}

// Read the immutable saved classification, never the currently displayed odds/groups.
export function personalPlanReview(plan,outcome) {
  const selected=compareGroupPlans(plan.grouping,plan.slots,plan.excluded).find(p=>p.id===plan.variant)
  const result=reviewGroupPlan(plan,outcome),unordered=selected.type==='3連複',count=selected.type==='馬単'?2:3
  const positions=selected.slots.slice(0,count).map((labels,i)=>{
    const horses=plan.grouping.groups.filter(g=>labels.includes(g.label)).flatMap(g=>g.horses)
      .filter(h=>!plan.excluded.includes(h.no)).sort((a,b)=>a.no-b.no)
    const actualNo=result?.numbers[i]??null,actualGroup=actualNo===null?null:plan.grouping.membership[actualNo]
    return {position:i+1,labels,horses,actualNo,actualGroup,
      actualName:plan.field.find(h=>h.no===actualNo)?.name??'',
      groupMatches:!unordered&&actualGroup!==null?labels.includes(actualGroup):null,
      candidateIncluded:!unordered&&actualNo!==null?horses.some(h=>h.no===actualNo):null}
  })
  return {type:selected.type,unordered,positions,result,
    pattern:positions.map(p=>p.labels.join('・')||'未選択').join(unordered?' − ':' → '),
    actualPattern:result?result.numbers.slice(0,count).map(no=>plan.grouping.membership[no]).join(' → '):null,
    state:result?'ready':outcome?'held':'pending'}
}
