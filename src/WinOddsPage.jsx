import { useState } from 'react'
import { TrendingUp } from 'lucide-react'
import { oddsStorageKey, readOddsHistory } from './oddsHistory.js'

const percent = new Intl.NumberFormat('ja-JP', {
  style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
})
const timeClass = 'ml-2 rounded border border-slate-300 bg-white px-2 py-1'

function oddsAt(snapshot, no) {
  const value = snapshot?.odds?.[no]
  return Number.isFinite(value) && value >= 1 ? value : null
}

export default function WinOddsPage({ race, horses, userId, onOpenAbility }) {
  const [history] = useState(() => readOddsHistory(oddsStorageKey(userId, race))
    .sort((a, b) => b.time.localeCompare(a.time)))
  const [time, setTime] = useState(history[0]?.time ?? '')
  const [baseTime, setBaseTime] = useState('')
  const [sort, setSort] = useState('gap')
  const current = history.find(item => item.time === time)
  const earlier = history.filter(item => item.time < time)
  const base = earlier.find(item => item.time === baseTime) ?? earlier[0]
  const market = horses.map(horse => oddsAt(current, horse.no)).filter(odds => odds != null)
    .sort((a, b) => a - b)
  const complete = horses.length > 0 && market.length === horses.length
  const rows = horses.map(horse => {
    const odds = oddsAt(current, horse.no)
    const before = oddsAt(base, horse.no)
    const rank = complete && odds != null ? market.indexOf(odds) + 1 : null
    const idmRank = Number(horse.predictedFavRank) > 0 ? Number(horse.predictedFavRank) : null
    return {
      ...horse, odds, before, rank, idmRank,
      gap: rank != null && idmRank != null ? rank - idmRank : null,
      change: odds != null && before != null ? odds / before - 1 : null,
    }
  })
  rows.sort((a, b) => {
    if (sort === 'gap') {
      const magnitude = horse => horse.gap == null ? -1 : Math.abs(horse.gap)
      return magnitude(b) - magnitude(a) || a.no - b.no
    }
    return (a[sort] ?? Infinity) - (b[sort] ?? Infinity) || a.no - b.no
  })

  return <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
    <div className="space-y-3 border-b border-slate-100 p-5">
      <h3 className="flex items-center gap-2 font-bold text-[#0B2545]">
        <TrendingUp className="h-5 w-5" />単勝オッズ分析
      </h3>
      <button type="button" onClick={onOpenAbility} className="text-sm font-semibold text-[#2B6CB0] hover:underline">
        能力・適性でオッズを記録
      </button>
      {current && <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>表示時刻<select className={timeClass} value={time} onChange={event => setTime(event.target.value)}>
          {history.map(item => <option key={item.time} value={item.time}>{item.time}</option>)}
        </select></label>
        <label>比較時刻<select className={timeClass} value={base?.time ?? ''} disabled={!earlier.length}
          onChange={event => setBaseTime(event.target.value)}>
          {earlier.length ? earlier.map(item => <option key={item.time} value={item.time}>{item.time}</option>)
            : <option value="">比較データなし</option>}
        </select></label>
        <label>並び順<select className={timeClass} value={sort} onChange={event => setSort(event.target.value)}>
          <option value="gap">順位差が大きい順</option>
          <option value="change">オッズが下がった順</option>
          <option value="odds">オッズが低い順</option>
          <option value="no">馬番順</option>
        </select></label>
      </div>}
      <p className="text-xs text-slate-600">
        人気順位は単勝オッズの低い順。同オッズは同順位です。人気順位 − IDM順位が +3以上なら過小評価候補、−3以下なら買われすぎ候補とします。
      </p>
      {current && !complete && <p className="text-xs text-slate-600">
        {market.length}/{horses.length}頭のオッズを取得済み。全頭分が揃うと順位差を判定します。
      </p>}
    </div>
    {!current ? <p className="p-5 text-sm text-slate-600">このレースの単勝オッズは未記録です。</p> :
      <div className="overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-600"><tr>
            {['馬番・馬名', 'IDM順位', '人気順位', '比較時点', '単勝オッズ', '変化率', '順位差', '推測'].map(label =>
              <th key={label} scope="col" className="px-4 py-3">{label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(horse => <tr key={horse.no}>
              <th scope="row" className="px-4 py-3 font-semibold">{horse.no} {horse.name}</th>
              <td className="px-4 py-3">{horse.idmRank ?? '—'}</td>
              <td className="px-4 py-3">{horse.rank ?? '—'}</td>
              <td className="px-4 py-3">{horse.before?.toFixed(1) ?? '—'}</td>
              <td className="px-4 py-3">{horse.odds?.toFixed(1) ?? '—'}</td>
              <td className={`px-4 py-3 tabular-nums ${horse.change < 0 ? 'text-[#2B6CB0]' : horse.change > 0 ? 'text-amber-800' : ''}`}>{horse.change == null ? '—' : percent.format(horse.change)}</td>
              <td className="px-4 py-3 font-mono tabular-nums">{horse.gap > 0 ? `+${horse.gap}` : horse.gap ?? '—'}</td>
              <td className="px-4 py-3">
                {horse.gap >= 3 && <span className="rounded bg-blue-50 px-2 py-1 font-semibold text-[#0B2545]">過小評価候補</span>}
                {horse.gap <= -3 && <span className="rounded bg-amber-50 px-2 py-1 font-semibold text-amber-800">買われすぎ候補</span>}
                {horse.gap == null && '判定保留'}
                {horse.gap != null && Math.abs(horse.gap) < 3 && '大きな差なし'}
              </td>
            </tr>)}
          </tbody>
        </table>
      </div>}
  </section>
}
