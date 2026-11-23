import {ChevronDown} from 'lucide-react'
import GroupProbabilitySummary from './GroupProbabilitySummary.jsx'
import GroupHorsePrediction from './GroupHorsePrediction.jsx'

export default function GroupPredictionCard({group,summary,assessments,returnUsable,onOpen,type,slots,onToggle,ticketCount,onReview,disabled}) {
  const count=type==='馬単'?2:3
  return <article className="rca-group-card" aria-label={`${group.label}グループ`}>
    <header className="rca-group-card-heading"><strong>{group.label}</strong><span>{group.horses.length}頭 · {group.horses[0].odds}〜{group.horses.at(-1).odds}倍</span></header>
    <GroupProbabilitySummary summary={summary} mode="overview" />
    <div className="rca-group-add" aria-label={`${group.label}群を予想に追加`}>{Array.from({length:count},(_,i)=>{
      const position=type==='3連複'?`${i+1}頭目`:`${i+1}着`,selected=slots[i].includes(group.label)
      return <button key={i} type="button" className="rca-secondary" aria-label={`${group.label}群を${position}に追加`} aria-pressed={selected} disabled={disabled||!summary?.count} onClick={()=>onToggle(i,group.label)}>{position}{selected?'に選択中':'に追加'}</button>
    })}</div>
    <button type="button" className="rca-primary rca-group-review-button" disabled={disabled||!ticketCount} onClick={onReview}>買い目を確認（{ticketCount}点）</button>
    <details className="rca-group-horse-details"><summary className="rca-group-summary" aria-label={`${group.label}グループを開閉`}><span>各馬の詳細・平均勝率</span><span className="rca-group-toggle" aria-hidden="true"><span className="rca-group-close">閉じる</span><span className="rca-group-open">開く</span><ChevronDown size={18}/></span></summary>
      <GroupProbabilitySummary summary={summary} mode="details" onOpen={onOpen} />
      <ul className="rca-group-horses" aria-label={`${group.label}グループの馬`}>{group.horses.map(h=><li key={h.no}><GroupHorsePrediction horse={h} assessment={assessments.find(row=>row.no===h.no)} returnUsable={returnUsable} onOpen={onOpen} /></li>)}</ul>
    </details>
  </article>
}
