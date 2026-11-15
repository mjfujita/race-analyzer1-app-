import { useState } from 'react'
import { reviewTicket } from './oddsReview.js'

const oddsFields = [
  ['baseline', 'JRDB基準'], ['earlier', '15分前'], ['current', '10分前'],
  ['lower', '推定締切下限'], ['probability', '推定的中率 (%)'], ['stake', '配分 (円)'],
]
const newTicket = (id) => ({ id, type: '馬連', pair: '', reason: '', baseline: '', earlier: '',
  current: '', lower: '', probability: '', stake: '' })
const input = 'min-w-0 w-full rounded border border-slate-300 p-2'
const numeric = (value, digits = 2) => value === null ? '—' : value.toFixed(digits)
const percent = (value) => value === null ? '—' : `${(100 * value).toFixed(1)}%`

export default function OddsReview({ raceInfo }) {
  const [budget, setBudget] = useState('10000')
  const [tickets, setTickets] = useState([newTicket(1)])
  const [oddsTime, setOddsTime] = useState('')
  const update = (id, key, value) =>
    setTickets(tickets.map(ticket => ticket.id === id ? { ...ticket, [key]: value } : ticket))
  const reviewed = tickets.map(ticket => ({ ...ticket, ...reviewTicket(ticket) }))
  const budgetValid = budget !== '' && Number.isSafeInteger(Number(budget)) && Number(budget) >= 0
  const staked = reviewed.filter(ticket => ticket.stake !== '' && Number(ticket.stake) !== 0)
  const total = staked.reduce((sum, ticket) => sum + Number(ticket.stake), 0)
  const invalid = staked.some(ticket => Number(ticket.stake) < 100 || Number(ticket.stake) % 100 !== 0
    || !ticket.qualifies || !ticket.pair.trim() || !ticket.reason.trim())
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold">買い目の回収率比較</h2>
      {raceInfo && <p className="text-sm">{raceInfo.name}</p>}
      <p className="text-sm text-slate-600">発走10分前のオッズと、根拠のある的中率・締切オッズ下限を入力してください。ワイドは表示レンジの下限を比較に使います。</p>
      <div className="flex flex-wrap gap-4 text-sm">
        <label>予算上限（円）<input className={input} type="number" min="0" step="100" value={budget} onChange={event => setBudget(event.target.value)} /></label>
        <label>10分前オッズの表示時刻<input className={input} type="time" value={oddsTime} onChange={event => setOddsTime(event.target.value)} /></label>
      </div>
      {reviewed.map((ticket, index) => (
        <fieldset key={ticket.id} className="space-y-3 rounded border border-slate-200 p-3 text-sm">
          <legend className="px-1 font-semibold">候補 {index + 1}</legend>
          <div className="grid gap-3 sm:grid-cols-3">
            <label>券種<select className={input} value={ticket.type} onChange={event => update(ticket.id, 'type', event.target.value)}>
              {['単勝', '複勝', '馬連', '馬単', 'ワイド', '3連複', '3連単'].map(type => <option key={type}>{type}</option>)}
            </select></label>
            <label>馬番・着順<input className={input} value={ticket.pair} onChange={event => update(ticket.id, 'pair', event.target.value)} /></label>
            <label>来る根拠<input className={input} value={ticket.reason} onChange={event => update(ticket.id, 'reason', event.target.value)} /></label>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {oddsFields.map(([key, label]) => <label key={key}>{label}<input className={input} type="number" min="0" step="any" value={ticket[key]} onChange={event => update(ticket.id, key, event.target.value)} /></label>)}
          </div>
          <p className="text-slate-700">実÷基準 {numeric(ticket.gap)} ／ 変化率 {percent(ticket.movement)} ／ 損益分岐 {numeric(ticket.breakEven)}倍 ／ 下限の期待回収率 {percent(ticket.expectedReturn)}</p>
        </fieldset>
      ))}
      <button type="button" className="rounded border px-3 py-2 text-sm" onClick={() => setTickets([...tickets, newTicket(tickets.at(-1).id + 1)])}>候補を追加</button>
      <p className="text-sm font-semibold" role="status">
        {!budgetValid || total > Number(budget) ? '予算上限と配分を確認してください。'
          : invalid ? '配分先の根拠・期待回収率・100円単位の金額を確認してください。'
          : !staked.length ? '配分は未決定です。'
          : !oddsTime ? '実オッズの表示時刻を入力してください。'
          : `配分 ${total.toLocaleString()}円 ／ 残予算 ${(Number(budget) - total).toLocaleString()}円`}
      </p>
    </section>
  )
}
