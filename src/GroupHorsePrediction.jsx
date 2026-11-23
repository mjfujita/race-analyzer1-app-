const pct=n=>Number.isFinite(n)?`${(100*n).toFixed(1)}%`:'判定保留'

export default function GroupHorsePrediction({horse,assessment,returnUsable,onOpen}){
  const p=assessment?.probabilities
  const metrics=[['推定勝率',pct(p?.win)],['推定3着内率',pct(p?.top3)],['推定2着率',pct(p?.second)],['推定3着率',pct(p?.third)],
    ['選択単勝オッズ',Number.isFinite(horse.odds)?`${horse.odds.toFixed(1)}倍`:'未取得'],['単勝期待回収率',pct(returnUsable?assessment?.expectedReturn:null)]]
  return <article className="rca-group-horse-card" aria-label={`${horse.no}番 ${horse.name}の予想指標`}>
    <button type="button" className="rca-group-horse-link" aria-label={`${horse.no}番 ${horse.name}の詳細`} onClick={event=>onOpen(horse.no,event)}><span>{horse.no} {horse.name}</span><span aria-hidden="true">›</span></button>
    <p className="rca-group-horse-role">{assessment?.role??'評価未取得'}</p>
    <dl className="rca-group-horse-metrics">{metrics.map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!p&&<p className="rca-group-horse-held">{assessment?.role==='出走対象外'?'出走対象外のため、確率は表示しません。':assessment?'比較材料が足りないため、確率の表示は保留しています。':'予想指標を取得できません。詳細で取得状態を確認してください。'}</p>}
  </article>
}
