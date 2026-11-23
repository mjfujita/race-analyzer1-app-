const pct=n=>Number.isFinite(n)?`${(100*n).toFixed(1)}%`:'判定保留'

export default function GroupProbabilitySummary({summary,onOpen}) {
  if(!summary)return null
  return <section className="rca-group-probability" aria-label={`${summary.label}群の推定確率`}>
    <h3>頭数を考慮して比較</h3>
    <p className="rca-muted">対象 {summary.count}頭 ／ 出走 {summary.fieldSize}頭{summary.excludedCount>0?` ／ 候補から除外 ${summary.excludedCount}頭`:''} · モデル試算</p>
    {summary.status!=='ready'?<p className="rca-notice">判定保留：{summary.reason}</p>:<>
      <dl className="rca-group-probability-metrics rca-group-strength-metrics" aria-label="頭数を考慮した比較"><div><dt>1頭あたりの平均勝率</dt><dd>{pct(summary.averageWin)}</dd></div><div><dt>頭数だけの基準に対して</dt><dd>{summary.relativeWin.toFixed(2)}倍</dd></div></dl>
      <p className="rca-muted">全馬が同じ強さなら、この群の勝率は {pct(summary.baselineWin)}。1.00倍が基準です。回収率・的中の保証ではありません。</p>
      <h3>グループ全体の見込み</h3>
      <dl className="rca-group-probability-metrics">{[['推定1着確率',summary.win],['推定2着確率',summary.second],['推定3着確率',summary.third],['1頭以上が3着以内',summary.anyTop3]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{pct(value)}</dd></div>)}</dl>
      <p className="rca-group-contribution"><strong>中心馬 {summary.leaders[0].no}番 {summary.leaders[0].name}</strong><br/>この馬が群の勝率の {pct(summary.leaders[0].share)} を占めます。</p>
      <details className="rca-group-contributors"><summary>各馬の勝率と寄与を見る（{summary.count}頭）</summary><ul>{summary.leaders.map(h=><li key={h.no}>
        {onOpen?<button type="button" className="rca-horse-name" aria-label={`${h.no}番 ${h.name}の詳細`} onClick={event=>onOpen(h.no,event)}>{h.no} {h.name}</button>:<strong>{h.no} {h.name}</strong>}
        <span>勝率 {pct(h.win)} ／ 群内寄与 {pct(h.share)}</span>
      </li>)}</ul></details>
      <p className="rca-muted">着順・3着内の確率は未校正の参考値です。</p>
      <details className="rca-group-probability-help"><summary>確率の読み方・計算条件</summary><p className="rca-muted">1〜3着は、それぞれその着順に群の誰かが入る確率です。3着以内は複数頭が入る場合も1回だけ数えます。平均勝率は各馬の勝率の平均です。頭数だけの基準は対象頭数÷全出走頭数、基準に対する倍率は群の推定勝率÷その基準です。これは同じ強さと仮定した比較で、学習済みの優位性や統計的有意差を示しません。頭数が多い群ほど全体の確率は高くなりやすく、投資妙味とは別です。候補から除外した馬も、出走する相手として計算に残します。</p></details>
    </>}
  </section>
}
