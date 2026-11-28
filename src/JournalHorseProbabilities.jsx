const pct=p=>Number.isFinite(p)?`${(p*100).toFixed(1)}%`:'保留'
export default function JournalHorseProbabilities({rows,grouping}){
  if(!rows?.length)return <p className="rca-muted">各馬の確率は未取得です。</p>
  return <div className="overflow-x-auto"><table className="rca-list-table" aria-label="保存時の各馬の確率"><thead><tr><th>群・馬</th><th>1着</th><th>2着</th><th>3着</th><th>3着内</th></tr></thead><tbody>{rows.map(h=><tr key={h.no}><th>{grouping.membership[h.no]} {h.no} {h.name}</th>{['win','second','third','top3'].map(k=><td key={k}>{pct(h[k])}</td>)}</tr>)}</tbody></table></div>
}
