import {groupTendencyMetrics} from './groupTendencyMetrics.js'
const percent=p=>`${(p*100).toFixed(1)}%`
const difference=n=>{const rounded=Math.round(n*10)/10;return `${rounded>0?'+':''}${rounded.toFixed(1)}回`}
function Combinations({title,rows,total}){
  return <section className="rca-combination-panel"><h4>{title}</h4>{!rows.length?<p className="rca-muted">集計できる結果を待っています。</p>:<><ol>{rows.slice(0,5).map(row=><li key={row.pattern}><strong>{row.pattern}</strong><span>{row.count}／{total}レース（{percent(row.rate)}）</span></li>)}</ol>{rows.length>5&&<details><summary>残り{rows.length-5}パターンを見る</summary><ol>{rows.slice(5).map(row=><li key={row.pattern}><strong>{row.pattern}</strong><span>{row.count}／{total}レース（{percent(row.rate)}）</span></li>)}</ol></details>}</>}</section>
}
export default function GroupTendencyMetrics({rows,registrations,predictions,receipts,loading}){
  const stats=groupTendencyMetrics(rows,{registrations,predictions,receipts})
  return <>
    <h3>グループ別の着順回数・実績率</h3>
    <table className="rca-list-table rca-tendency-summary" aria-label="全レースのグループ別着順回数"><thead><tr><th>群</th><th>平均頭数</th><th>1着</th><th>2着</th><th>3着</th></tr></thead><tbody>{stats.groups.map(g=><tr key={g.label}><th scope="row">{g.label}群</th><td data-label="平均頭数"><strong>{g.averageHeads.toFixed(1)}頭</strong><small className="block">存在 {g.present}／{stats.count}レース</small><small className="block">平均占有 {percent(g.averageShare)}</small></td>{g.counts.map((n,i)=><td key={i} data-label={`${i+1}着`}><strong>{n}回</strong><small className="block">{percent(g.rates[i])}</small></td>)}</tr>)}</tbody></table>
    {!stats.count&&<p className="rca-muted">{loading?'結果と分類を読み込み中です。':'集計できる結果はまだありません。予想の登録は不要です。'}</p>}
    <p className="rca-muted">実績率は集計{stats.count}レースが分母です。平均頭数・占有率は、その群が存在するレースで計算します。</p>
    <section className="rca-tendency-section" aria-label="ACEの事前予測との比較"><h3>ACEの想定回数と実績の差</h3><p>比較可能 {stats.ace.count}／{stats.ace.total}レース</p>
      {!stats.ace.count?<p className="rca-muted">比較できる事前確率の記録がまだありません。過去の結果から予測確率を作り直しません。</p>:<>
        <p className="rca-muted">比較可能な同じ{stats.ace.count}レースについて、保存した推定確率の合計を「ACE想定回数」として実績と比べます。</p>
        <table className="rca-list-table rca-ace-tendency-table" aria-label="ACEの想定回数と実績"><thead><tr><th>群</th><th>1着</th><th>2着</th><th>3着</th></tr></thead><tbody>{stats.ace.groups.map(g=><tr key={g.label}><th scope="row">{g.label}群</th>{g.expected.map((expected,i)=><td key={i} data-label={`${i+1}着`}><small className="block">ACE想定 {expected.toFixed(1)}回</small><strong>実績 {g.actual[i]}回</strong><small className="block">差 {difference(g.differences[i])}</small></td>)}</tr>)}</tbody></table>
      </>}
      {stats.ace.excluded.length>0&&<details><summary>比較対象外 {stats.ace.total-stats.ace.count}レースの内訳</summary>{stats.ace.excluded.map(r=><p key={r.reason}>{r.reason}：{r.count}レース</p>)}</details>}
      <p className="rca-muted">ACE想定は保存時のモデル試算です。差は、この対象レースでの実績との比較です。</p>
    </section>
    <h3>よく出たグループの組み合わせ</h3><div className="rca-combination-grid"><Combinations title="1・2着の組み合わせ（着順あり）" rows={stats.pairs} total={stats.count}/><Combinations title="1〜3着の組み合わせ（着順あり）" rows={stats.triples} total={stats.count}/></div>
  </>
}
