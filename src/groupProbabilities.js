const valid = p => typeof p === 'number' && Number.isFinite(p) && p >= 0 && p <= 1
const bounded = p => Math.min(1,Math.max(0,p))

// Sum disjoint ordered outcomes from the SAME protected ACE model as horse details.
// Excluding a betting candidate never removes that horse from the race or renormalizes odds.
export function summarizeGroupProbabilities(grouping,assessment,excluded=[]) {
  if (!grouping) return []
  const rows=assessment?.rows??[], outcomes=assessment?.outcomes??[]
  const active=rows.filter(h=>h.role!=='出走対象外')
  const byNo=new Map(rows.map(h=>[h.no,h]))
  const ready=grouping.complete && active.length===grouping.groups.reduce((n,g)=>n+g.horses.length,0) && active.length>=2 && active.every(h=>h.probabilities && ['win','second','third','top3'].every(key=>valid(h.probabilities[key])))
    && outcomes.length>0 && outcomes.every(o=>valid(o.probability))
    && Math.abs(outcomes.reduce((sum,o)=>sum+o.probability,0)-1)<1e-7
  return grouping.groups.map(group=>{
    const horses=group.horses.filter(h=>!excluded.includes(h.no))
    const base={label:group.label,count:horses.length,totalCount:group.horses.length,excludedCount:group.horses.length-horses.length,fieldSize:active.length}
    if (!horses.length) return {...base,status:'held',reason:'候補馬がいません。除外した馬を確認してください。'}
    if (!ready || horses.some(h=>!byNo.get(h.no)?.probabilities)) return {...base,status:'held',reason:'全出走馬の比較材料または着順確率が揃わないため、群の確率は判定保留です。'}
    const selected=new Set(horses.map(h=>h.no)), positions=[0,0,0]
    let anyTop3=0
    for (const o of outcomes) {
      for(let i=0;i<3;i++) if(selected.has(o.order[i])) positions[i]+=o.probability
      if(o.order.some(no=>selected.has(no))) anyTop3+=o.probability
    }
    const win=bounded(positions[0])
    const leaders=horses.map(h=>({no:h.no,name:h.name,win:byNo.get(h.no).probabilities.win}))
      .sort((a,b)=>b.win-a.win || a.no-b.no).map(h=>({...h,share:win>0?bounded(h.win/win):null}))
    return {...base,status:'ready',win,second:bounded(positions[1]),third:bounded(positions[2]),anyTop3:bounded(anyTop3),
      averageWin:win/horses.length,baselineWin:horses.length/active.length,relativeWin:win/(horses.length/active.length),leaders}
  })
}
