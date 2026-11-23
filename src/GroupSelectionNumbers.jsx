export default function GroupSelectionNumbers({grouping,slots=[],type,excluded=[],box=false}){
  const rows=box?[slots[0]??[]]:Array.from({length:type==='馬単'?2:3},(_,i)=>slots[i]??[])
  return <section className="rca-selection-numbers" aria-label="選択グループの馬番">
    <h3>選択した馬番</h3><p className="rca-muted">選んだグループを、除外馬を除いた馬番で表示します。{type==='3連複'?'3連複は着順不問です。':'同じ馬が重なる買い目は除外します。'}</p>
    <dl>{rows.map((labels,i)=>{
      const numbers=[...new Set(grouping.groups.filter(g=>labels.includes(g.label)).flatMap(g=>g.horses.map(h=>h.no)).filter(no=>!excluded.includes(no)))].sort((a,b)=>a-b)
      const title=box?'BOX対象':type==='3連複'?`${i+1}頭目`:`${i+1}着`
      return <div key={i} role="group" aria-label={`${title}の馬番`}><dt>{title}</dt><dd className="rca-selection-labels">{labels.length?labels.map(label=>`${label}群`).join('・'):'未選択'}</dd><dd className="rca-selection-values">{numbers.length?`馬番 ${numbers.join('・')}`:labels.length?'候補なし':'グループを選択してください'}</dd></div>
    })}</dl>
  </section>
}
