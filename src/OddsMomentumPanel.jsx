import { oddsMomentum } from './oddsMomentum.js'
import { formatRaceTime } from './raceTime.js'

const signed = value => `${value > 0 ? '+' : ''}${(value * 100).toFixed(1)}%`
const colors = ['#2673d1','#118d7d','#859bb5']
export default function OddsMomentumPanel({ race, field, current, events, cutoffAt }) {
  const momentum = oddsMomentum({ race, field, current, events, cutoffAt })
  const rows = field.map(h => ({ ...h, trend: momentum.rows.get(h.no) })).filter(h => h.trend)
    .sort((a,b) => Number(b.trend.rising) - Number(a.trend.rising) || b.trend.shareChange - a.trend.shareChange)
  const chartRows = rows.slice(0,3), reference = momentum.reference
  const high = Math.max(2,...chartRows.flatMap(h => [reference.odds[h.no],current.odds[h.no]])) * 1.1
  const y = value => 240 - 200 * value / high
  return <section className="rca-panel"><h2>単勝オッズの推移</h2><p className="rca-muted">人気上昇と、現在価格での妙味を分けて確認します。</p>
    {!reference ? <p className="rca-notice">比較できる時刻付きの全頭オッズが2時点揃っていません。時刻不明・締切後の記録から変化率は推測しません。</p> : <>
      <div className="flex flex-wrap gap-4 text-xs mt-4">{chartRows.map((h,i) => <span key={h.no} style={{ color: colors[i] }}>● {h.no} {h.name}</span>)}</div>
      <svg role="img" aria-label="取得した2時点の単勝オッズ比較" viewBox="0 0 820 290" className="rca-odds-chart">
        {[0,1,2,3,4].map(i => <g key={i}><line x1="50" y1={240-i*50} x2="770" y2={240-i*50} stroke="#e4ebf4" /><text x="8" y={244-i*50}>{(high*i/4).toFixed(1)}</text></g>)}
        {chartRows.map((h,i) => <g key={h.no}><line x1="60" y1={y(reference.odds[h.no])} x2="760" y2={y(current.odds[h.no])} stroke={colors[i]} strokeWidth="3" />{[[60,reference.odds[h.no]],[760,current.odds[h.no]]].map(([x,v]) => <circle key={x} cx={x} cy={y(v)} r="5" fill={colors[i]} />)}</g>)}
        <text x="50" y="278">{formatRaceTime(reference.observedAt)}</text><text x="770" y="278" textAnchor="end">{formatRaceTime(current.observedAt)}</text>
      </svg><div className="overflow-x-auto"><table className="rca-list-table whitespace-nowrap" aria-label="人気とオッズの変化"><thead><tr>{['馬番・馬名','以前 → 現在','単勝変化率','人気順位','市場支持率の変化','現在の単勝期待回収率'].map(h => <th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map(h => <tr key={h.no}><th scope="row">{h.no} {h.name}{h.trend.rising && <span className="block text-xs text-blue-600">人気上昇に注目</span>}</th><td>{reference.odds[h.no]} → {current.odds[h.no]}倍</td><td>{signed(h.trend.priceChange)}</td><td>{h.trend.previousRank}位 → {h.trend.currentRank}位</td><td>{signed(h.trend.shareChange)}</td><td>{Number.isFinite(h.probability) ? `${(h.probability*current.odds[h.no]*100).toFixed(1)}%` : '—'}</td></tr>)}</tbody></table></div>
    </>}<p className="rca-muted mt-4">変化率は同じレースの取得済み2時点を比較。支持率は全頭オッズを正規化した推定値で、投票金額や勝率の上昇とは区別します。</p>
  </section>
}
