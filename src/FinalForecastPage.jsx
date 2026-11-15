import { useState } from 'react'
import { Target } from 'lucide-react'
import { oddsStorageKey, readOddsHistory } from './oddsHistory.js'
import { readPaceResults, recordedPaceRows, summarizeBias } from './PacePage.jsx'
import { betTypes, buildTickets, frameNumbers, scoreField, ticketKey } from './finalForecast.js'

const card = 'space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const styles = { 1: '逃げ', 2: '先行', 3: '差し', 4: '追込' }
const yen = value => `${value.toLocaleString('ja-JP')}円`
const pct = value => `${(value * 100).toFixed(1)}%`
const record = (top, runs) => runs > 0 ? `${top}/${runs}` : '—'

function parseOdds(value, numbers, frames) {
  const entries = new Map()
  for (const line of value.trim().split(/\r?\n/).filter(line => line.trim())) {
    const [type, selection, price, ...extra] = line.trim().split(/\s+/)
    if (extra.length || !Object.hasOwn(betTypes, type) || ['単勝', '応援馬券'].includes(type)
      || !/^\d+(?:[-－→]\d+)*$/.test(selection ?? '')
      || !/^\d+(?:\.\d+)?(?:[-－〜～]\d+(?:\.\d+)?)?$/.test(price ?? '')) return null
    const picks = selection.split(/[-－→]/).map(Number)
    const allowed = type === '枠連' ? [...frames.values()] : numbers
    const [odds, upper = odds] = price.split(/[-－〜～]/).map(Number)
    if (picks.length !== betTypes[type] || picks.some(no => !allowed.includes(no))
      || (type !== '枠連' && new Set(picks).size !== picks.length)
      || !Number.isFinite(upper) || odds < 1 || upper < odds) return null
    const key = ticketKey(type, picks)
    if (entries.has(key)) return null
    entries.set(key, { type, numbers: picks, odds })
  }
  return [...entries.values()]
}

export default function FinalForecastPage({ race, horses, statistics, earlierRaces, userId, onOpenAbility, onOpenPace }) {
  const postTime = String(race.postTime ?? '').replace(':', '')
  const [history] = useState(() => readOddsHistory(oddsStorageKey(userId, race))
    .filter(item => !/^\d{4}$/.test(postTime) || item.time.replace(':', '') < postTime)
    .sort((a, b) => b.time.localeCompare(a.time)))
  const [time, setTime] = useState(history[0]?.time ?? '')
  const [anchor, setAnchor] = useState('')
  const [minimumHit, setMinimumHit] = useState('10')
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
  const numbers = horses.map(horse => Number(horse.no))
  const fullField = Number(race.fieldSize) === numbers.length
  const frames = fullField ? frameNumbers(numbers) : new Map()
  const pairs = parseOdds(pairText, numbers, frames)
  const budgetValid = budget !== '' && Number.isSafeInteger(Number(budget)) && Number(budget) >= 0
  const pairTimeValid = !pairText.trim() || (Boolean(time) && pairTime === time)
  const anchorNo = anchor === '' ? null : Number(anchor)
  const anchorHorse = horses.find(horse => Number(horse.no) === anchorNo)
  const canAllocate = budgetValid && Boolean(current) && pairs !== null && pairTimeValid && field.length > 0
  const { evaluated, tickets } = canAllocate
    ? buildTickets(field, current.odds, previous?.odds ?? {}, pairs, Number(budget), anchorNo, Number(minimumHit) / 100, fullField) : { evaluated: [], tickets: [] }
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
        <label>軸馬<select className="ml-2 rounded border border-slate-300 bg-white p-1" value={anchor}
          onChange={event => setAnchor(event.target.value)}>
          <option value="">指定なし（全馬を比較）</option>
          {[...horses].sort((a, b) => a.no - b.no).map(horse =>
            <option key={horse.no} value={horse.no}>{horse.no}番 {horse.name}</option>)}
        </select></label>
        <label>最低評価的中率<select className="ml-2 rounded border border-slate-300 p-1" value={minimumHit} onChange={e => setMinimumHit(e.target.value)}>
          {[0, 5, 10, 20, 30, 50].map(value => <option key={value} value={value}>{value ? `${value}%` : '指定なし'}</option>)}
        </select></label>
        <label>予算上限（円）<input className="ml-2 w-28 rounded border border-slate-300 p-1" type="number" min="0" step="100" value={budget} onChange={e => setBudget(e.target.value)} /></label>
        <label>単勝オッズ時刻<select className="ml-2 rounded border border-slate-300 p-1" value={time} onChange={e => setTime(e.target.value)}>
          {!history.length && <option value="">未記録</option>}
          {history.map(item => <option key={item.time}>{item.time}</option>)}
        </select></label>
      </div>
      {anchorHorse && <p className="text-sm text-slate-600">
        {anchorHorse.no}番 {anchorHorse.name}を含む買い目を比較します。枠連では同馬が入る枠を対象にします。
      </p>}
      <details className="text-sm">
        <summary className="cursor-pointer font-semibold text-[#2B6CB0]">各券種の実オッズを追加</summary>
        <label className="mt-2 block">組み合わせオッズの時刻<input className="ml-2 rounded border border-slate-300 p-1" type="time" value={pairTime} onChange={e => setPairTime(e.target.value)} /></label>
        <label className="mt-2 block">1行につき券種・馬番（枠連は枠番）・倍率
          <textarea className="mt-1 block w-full max-w-md rounded border border-slate-300 p-2" rows="3"
            placeholder={'複勝 7 1.9-2.4\nワイド 7-15 8.0\n3連単 15-7-16 300.0'} value={pairText} onChange={e => setPairText(e.target.value)} />
        </label>
        <p className="mt-2 text-xs text-slate-600">複勝・枠連・馬連・馬単・ワイド・3連複・3連単を入力できます。倍率に幅があるときは下限を使用。単勝・複勝が揃うと応援馬券も比較します。WIN5は5レースをまたぐ券種です。</p>
        {!frames.size && <p className="text-xs text-slate-600">枠連は全馬の枠を判定できる9〜18頭立てで比較できます。</p>}
        {!pairs && <p role="alert" className="text-red-700">券種・馬番・倍率・重複を確認してください。</p>}
        {!pairTimeValid && <p role="alert" className="text-red-700">単勝と同じ時刻のオッズを指定してください。</p>}
      </details>
      <p className="text-xs text-slate-600">評価にはオッズを最低10%下げた想定を使用。単勝は前回より大きく下落した場合、その下落率を最大25%まで適用します。的中率は推定値の85%で評価します。試算回収率 ＝ 評価的中率 × 評価オッズ。</p>
    </section>
    <section className={card}>
      <h3 className="font-bold text-[#0B2545]">買い目とリスク</h3>
      {!budgetValid && <p className="text-sm text-red-700">0円以上の整数で予算を入力してください。</p>}
      {canAllocate ? <>
        <p className="text-sm font-semibold">{tickets.length ? `${tickets.length}点 ・ 購入 ${yen(total)} ・ 残り ${yen(Number(budget) - total)} ・ 第一候補の試算回収率 ${pct(expectedReturn)}`
          : evaluated.length === 0 ? '比較できる実オッズがありません。' : '見送り ・ 購入 0円'}</p>
        {tickets.length > 0 && <ul className="flex flex-wrap gap-2 text-sm">
          {tickets.map(ticket => <li key={`${ticket.type}:${ticket.pair}`} className="rounded-lg bg-blue-50 px-3 py-2 font-semibold text-[#0B2545]">
            {ticket.type} {ticket.pair}　{yen(ticket.stake)}
          </li>)}
        </ul>}
        <p className="text-xs text-slate-600">最低評価的中率を満たし、試算回収率が100%を超える買い目から、予算内で配分できる最上位の1点を選びます。比較対象 {evaluated.length}点。</p>
        {tickets.length > 0 && <p className="text-sm">損失が出る確率 {pct(tickets[0].lossProbability)} ・ 最大損失 {yen(total)}。配分上限は予算の半分です。</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.keys(betTypes).map(type => <span key={type} className="rounded bg-slate-100 px-2 py-1">
            {type} {evaluated.filter(ticket => ticket.type === type).length || '比較データなし'}
          </span>)}
        </div>
        {evaluated.length > 0 && <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
          <thead className="bg-slate-50 text-xs"><tr>{['券種・馬番','観測オッズ','変化率','評価オッズ','評価的中率','損失確率','試算回収率','配分'].map(label => <th key={label} scope="col" className="p-2">{label}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{evaluated.map(ticket => {
            const allocation = tickets.find(item => item.type === ticket.type && item.pair === ticket.pair)
            return <tr key={`${ticket.type}:${ticket.pair}`} className={allocation ? 'bg-blue-50' : ''}>
              <th scope="row" className="p-2 font-semibold">{ticket.type} {ticket.pair}</th>
              <td className="p-2">{ticket.odds?.toFixed(1) ?? '—'}</td>
              <td className="p-2">{ticket.movement == null ? '—' : pct(ticket.movement)}</td>
              <td className="p-2">{ticket.lower?.toFixed(2) ?? '—'}</td>
              <td className="p-2">{pct(ticket.conservativeProbability)}</td>
              <td className="p-2">{pct(ticket.lossProbability)}</td>
              <td className="p-2">{pct(ticket.expectedReturn)}</td>
              <td className="p-2 font-semibold">{allocation ? yen(allocation.stake) : '—'}</td>
            </tr>
          })}</tbody>
        </table></div>}
      </> : <p className="text-sm text-slate-600">予算・能力値・発走前オッズが揃うと、買い目を比較できます。</p>}
    </section>
  </div>
}
