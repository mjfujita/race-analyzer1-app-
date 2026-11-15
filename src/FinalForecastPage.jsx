import { useState } from 'react'
import { Target } from 'lucide-react'
import { oddsStorageKey, readOddsHistory } from './oddsHistory.js'
import { readPaceResults, recordedPaceRows, summarizeBias } from './PacePage.jsx'
import { buildTickets, scoreField } from './finalForecast.js'

const card = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const styles = { 1: '逃げ', 2: '先行', 3: '差し', 4: '追込' }
const yen = value => `${value.toLocaleString('ja-JP')}円`
const pct = value => `${(value * 100).toFixed(1)}%`
const record = (top, runs) => runs > 0 ? `${top}/${runs}` : '—'

function parsePairs(value, numbers) {
  const pairs = new Map()
  for (const line of value.trim().split(/\r?\n/).filter(line => line.trim())) {
    const match = line.trim().match(/^(馬連|馬単)\s+(\d+)[-－→](\d+)\s+(\d+(?:\.\d+)?)$/)
    if (!match) return null
    const [, type, a, b, odds] = match
    let first = Number(a), second = Number(b)
    if (first === second || !numbers.has(first) || !numbers.has(second) || !Number.isFinite(Number(odds)) || Number(odds) < 1) return null
    if (type === '馬連' && first > second) [first, second] = [second, first]
    const key = `${type}:${first}:${second}`
    if (pairs.has(key)) return null
    pairs.set(key, { type, first, second, odds: Number(odds) })
  }
  return [...pairs.values()]
}

export default function FinalForecastPage({ race, horses, statistics, earlierRaces, userId, onOpenAbility, onOpenPace }) {
  const postTime = String(race.postTime ?? '').replace(':', '')
  const [history] = useState(() => readOddsHistory(oddsStorageKey(userId, race))
    .filter(item => !/^\d{4}$/.test(postTime) || item.time.replace(':', '') < postTime)
    .sort((a, b) => b.time.localeCompare(a.time)))
  const [time, setTime] = useState(history[0]?.time ?? '')
  const [budget, setBudget] = useState('10000')
  const [pairText, setPairText] = useState('')
  const [pairTime, setPairTime] = useState(history[0]?.time ?? '')
  const current = history.find(item => item.time === time)
  const previous = history.find(item => item.time < time)
  const surfaces = { '芝': '1', 'ダート': '2' }
  const results = recordedPaceRows(earlierRaces, readPaceResults(userId, race))
    .filter(row => String(row.surface_code) === surfaces[race.surface])
  const bias = summarizeBias(results)
  const field = scoreField(horses, statistics, race, bias.direction)
  const pairs = parsePairs(pairText, new Set(horses.map(horse => Number(horse.no))))
  const budgetValid = budget !== '' && Number.isSafeInteger(Number(budget)) && Number(budget) >= 0
  const pairTimeValid = !pairText.trim() || (Boolean(time) && pairTime === time)
  const canAllocate = budgetValid && Boolean(current) && pairs !== null && pairTimeValid && field.length > 0
  const { evaluated, tickets } = canAllocate
    ? buildTickets(field, current.odds, previous?.odds ?? {}, pairs, Number(budget)) : { evaluated: [], tickets: [] }
  const total = tickets.reduce((sum, ticket) => sum + ticket.stake, 0)
  const expectedReturn = total ? tickets.reduce((sum, ticket) => sum + ticket.expectedReturn * ticket.stake, 0) / total : null
  return <div className="space-y-4">
    <section className={card}>
      <h3 className="flex items-center gap-2 font-bold text-[#0B2545]"><Target className="h-5 w-5" />最終予想・買い目</h3>
      <p className="text-sm">天候 {race.weather || '未取得'} ・ 馬場 {race.going || '未取得'} ・ {race.surface}の当日傾向 {bias.verdict}（{results.length}レース）</p>
      <p className="text-xs text-slate-600">IDMを軸に、近い距離・同じ競馬場・同じ馬場状態での成績、逃げ馬の数と当日の傾向を補正します。確率と補正幅は検証前の試算です。</p>
      {!field.length ? <p className="text-sm text-slate-600">全出走馬の出走時IDMが揃うと予想を表示します。</p> :
        <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {field.slice(0, 6).map(horse => <li key={horse.no} className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-semibold">{horse.no}番 {horse.name} ・ 推定勝率 {pct(horse.probability)}</p>
            <div aria-hidden="true" className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
              <div className="h-full rounded-full bg-gradient-to-r from-[#0B2545] to-[#4A90E2]"
                style={{ width: pct(horse.probability / field[0].probability) }} />
            </div>
            <p className="mt-1 text-xs text-slate-600">IDM {horse.idm.toFixed(1)} ・ {styles[horse.style] ?? '脚質未取得'}{horse.trend > 0 && ' ・ 当日の傾向に合う'}{horse.pace > 0 && ' ・ 想定展開に合う'}</p>
            <p className="mt-1 text-xs text-slate-600">3着内／走数　距離 {record(horse.stat.distance_top3, horse.stat.distance_runs)} ・ 会場 {record(horse.stat.venue_top3, horse.stat.venue_runs)} ・ 馬場 {record(horse.goingTop3, horse.goingRuns)}</p>
          </li>)}
        </ol>}
      <div className="flex flex-wrap gap-4 text-sm font-semibold text-[#2B6CB0]">
        <button type="button" onClick={onOpenAbility}>能力・単勝オッズを確認</button>
        <button type="button" onClick={onOpenPace}>当日の傾向を確認</button>
      </div>
    </section>
    <section className={card}>
      <h3 className="font-bold text-[#0B2545]">オッズと予算</h3>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label>予算上限（円）<input className="ml-2 w-28 rounded border border-slate-300 p-1" type="number" min="0" step="100" value={budget} onChange={e => setBudget(e.target.value)} /></label>
        <label>単勝オッズ時刻<select className="ml-2 rounded border border-slate-300 p-1" value={time} onChange={e => setTime(e.target.value)}>
          {!history.length && <option value="">未記録</option>}
          {history.map(item => <option key={item.time}>{item.time}</option>)}
        </select></label>
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-[#2B6CB0]">馬連・馬単の実オッズを追加</summary>
        <label className="mt-2 block">組み合わせオッズの時刻<input className="ml-2 rounded border border-slate-300 p-1" type="time" value={pairTime} onChange={e => setPairTime(e.target.value)} /></label>
        <label className="mt-2 block">1行につき券種・馬番・倍率
          <textarea className="mt-1 block w-full max-w-md rounded border border-slate-300 p-2" rows="3"
            placeholder={'馬連 7-15 30.0\n馬単 15-7 70.0'} value={pairText} onChange={e => setPairText(e.target.value)} />
        </label>
        {!pairs && <p role="alert" className="text-red-700">券種・馬番・倍率・重複を確認してください。</p>}
        {!pairTimeValid && <p role="alert" className="text-red-700">単勝と同じ時刻のオッズを指定してください。</p>}
      </details>
      <p className="text-xs text-slate-600">評価にはオッズを最低10%下げた想定を使用。単勝は前回より大きく下落した場合、その下落率を最大25%まで適用します。的中率は推定値の85%で評価します。試算回収率 ＝ 評価的中率 × 評価オッズ。</p>
    </section>
    <section className={card}>
      <h3 className="font-bold text-[#0B2545]">買い目と配分</h3>
      {!budgetValid && <p className="text-sm text-red-700">0円以上の整数で予算を入力してください。</p>}
      {canAllocate ? <>
        <p className="text-sm font-semibold">{tickets.length ? `${tickets.length}点 ・ 購入 ${yen(total)} ・ 残り ${yen(Number(budget) - total)} ・ 投入分の試算回収率 ${pct(expectedReturn)}`
          : '見送り ・ 購入 0円'}</p>
        {tickets.length > 0 && <ul className="flex flex-wrap gap-2 text-sm">
          {tickets.map(ticket => <li key={`${ticket.type}:${ticket.pair}`} className="rounded-lg bg-blue-50 px-3 py-2 font-semibold text-[#0B2545]">
            {ticket.type} {ticket.pair}　{yen(ticket.stake)}
          </li>)}
        </ul>}
        <p className="text-xs text-slate-600">試算回収率が100%を超える候補から最大5点。100円単位で配分し、合計を予算の半分以内に抑えます。比較対象 {evaluated.length}点。</p>
        {evaluated.length > 0 && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="bg-slate-50 text-xs"><tr>{['券種・馬番','観測オッズ','変化率','評価オッズ','評価的中率','試算回収率','配分'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{evaluated.map(ticket => {
            const allocation = tickets.find(item => item.type === ticket.type && item.pair === ticket.pair)
            return <tr key={`${ticket.type}:${ticket.pair}`} className={allocation ? 'bg-blue-50' : ''}>
              <th scope="row" className="p-2 font-semibold">{ticket.type} {ticket.pair}</th>
              <td className="p-2">{ticket.odds.toFixed(1)}</td>
              <td className="p-2">{ticket.movement == null ? '—' : pct(ticket.movement)}</td>
              <td className="p-2">{ticket.lower.toFixed(2)}</td>
              <td className="p-2">{pct(ticket.conservativeProbability)}</td>
              <td className="p-2">{pct(ticket.expectedReturn)}</td>
              <td className="p-2 font-semibold">{allocation ? yen(allocation.stake) : '—'}</td>
            </tr>
          })}</tbody>
        </table></div>}
      </> : <p className="text-sm text-slate-600">予算・能力値・発走前オッズが揃うと、買い目を比較できます。</p>}
    </section>
  </div>
}
