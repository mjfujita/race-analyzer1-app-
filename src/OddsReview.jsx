import { useState } from 'react'
import { allocateTickets, reviewTicket } from './oddsReview.js'

const oddsFields = [
  ['baseline', 'JRDB基準'], ['earlier', '15分前'], ['current', '10分前'],
  ['lower', '推定締切下限'], ['probability', '推定的中率 (%)'], ['stake', '配分 (円)'],
]
const newTicket = (id) => ({ id, type: '馬連', pair: '', reason: '', baseline: '', earlier: '',
  current: '', lower: '', probability: '', stake: '' })
const input = 'min-w-0 w-full rounded border border-slate-300 p-2'
const numeric = (value, digits = 2) => value === null ? '—' : value.toFixed(digits)
const percent = (value) => value === null ? '—' : `${(100 * value).toFixed(1)}%`

export default function OddsReview({ raceInfo, userId }) {
  const storageKey = `race-review:v1:${userId}:${raceInfo?.raceDate}:${raceInfo?.id}`
  const [record, setRecord] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) ?? {}
    } catch {
      return {}
    }
  })
  const [observation, setObservation] = useState('')
  const [storageError, setStorageError] = useState('')
  const { budget = '10000', tickets = [newTicket(1)], oddsTime = '', observations = [],
    final = null, payouts = {} } = record
  const save = (patch) => {
    const next = { ...record, ...patch }
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setRecord(next)
      setStorageError('')
      return true
    } catch {
      setStorageError('このブラウザに保存できませんでした。空き容量またはサイトの保存設定を確認してください。')
      return false
    }
  }
  const setBudget = budget => save({ budget })
  const setTickets = tickets => save({ tickets })
  const setOddsTime = oddsTime => save({ oddsTime })
  const update = (id, key, value) =>
    setTickets(tickets.map(ticket => ticket.id === id ? { ...ticket, [key]: value } : ticket))
  const reviewed = tickets.map(ticket => ({ ...ticket, ...reviewTicket(ticket) }))
  const budgetValid = budget !== '' && Number.isSafeInteger(Number(budget)) && Number(budget) >= 0
  const staked = reviewed.filter(ticket => ticket.stake !== '' && Number(ticket.stake) !== 0)
  const total = staked.reduce((sum, ticket) => sum + Number(ticket.stake), 0)
  const invalid = staked.some(ticket => Number(ticket.stake) < 100 || Number(ticket.stake) % 100 !== 0
    || !ticket.qualifies || !ticket.pair.trim() || !ticket.reason.trim())
  const canFinalize = budgetValid && !invalid && total <= Number(budget) && (total === 0 || oddsTime)
  const settled = final?.tickets.every(ticket => payouts[ticket.id] !== undefined && payouts[ticket.id] !== ''
    && Number.isSafeInteger(Number(payouts[ticket.id])) && Number(payouts[ticket.id]) >= 0)
  const returned = settled ? final.tickets.reduce((sum, ticket) =>
    sum + Number(payouts[ticket.id]) * Number(ticket.stake) / 100, 0) : null
  if (!raceInfo?.id) return <p>レース一覧から対象レースを選んでください。</p>

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-bold">買い目の回収率比較</h2>
      {raceInfo && <p className="text-sm">{raceInfo.name}</p>}
      <p className="text-sm text-slate-600">発走10分前のオッズと、根拠のある的中率・締切オッズ下限を入力してください。ワイドは表示レンジの下限を比較に使います。</p>
      {storageError && <p role="alert" className="text-sm text-rose-700">{storageError}</p>}
      <p className="text-xs text-slate-500">記録はこのブラウザに保存します。</p>
      <aside className="space-y-2 rounded border border-slate-200 p-3 text-sm">
        <h3 className="font-semibold">当日の会場メモ</h3>
        {observations.map(entry => <p key={entry.at} className="whitespace-pre-wrap break-words">
          <time className="mr-2 text-slate-500">{new Date(entry.at).toLocaleTimeString('ja-JP', { timeZone: 'Asia/Tokyo' })}</time>
          {entry.text}
        </p>)}
        <textarea aria-label="会場で気づいたこと" className={input} value={observation}
          placeholder="例：京都芝は外から伸びる馬が目立つ。確認したレースや根拠も記録。"
          onChange={event => setObservation(event.target.value)} />
        <button type="button" disabled={!observation.trim()} className="rounded border px-3 py-2 disabled:opacity-50"
          onClick={() => {
            if (save({ observations: [...observations, { text: observation.trim(), at: new Date().toISOString() }] })) setObservation('')
          }}>メモを保存</button>
      </aside>
      <fieldset disabled={Boolean(final)} className="space-y-4 disabled:opacity-75">
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
      <button type="button" className="ml-2 rounded border px-3 py-2 text-sm disabled:opacity-50"
        disabled={!budgetValid || !oddsTime}
        onClick={() => setTickets(allocateTickets(reviewed, Number(budget)))}>自動配分（試算）</button>
      <p className="text-xs text-slate-500">期待回収率100%超の候補に、1点ごとの推定優位性に応じて配分します。買い目間の相関は未反映です。</p>
      <p className="text-sm font-semibold" role="status">
        {!budgetValid || total > Number(budget) ? '予算上限と配分を確認してください。'
          : invalid ? '配分先の根拠・期待回収率・100円単位の金額を確認してください。'
          : !staked.length ? '配分は未決定です。'
          : !oddsTime ? '実オッズの表示時刻を入力してください。'
          : `配分 ${total.toLocaleString()}円 ／ 残予算 ${(Number(budget) - total).toLocaleString()}円`}
      </p>
      <button type="button" disabled={!canFinalize} className="rounded bg-[#0B2545] px-3 py-2 text-sm text-white disabled:opacity-50"
        onClick={() => save({ final: { at: new Date().toISOString(), budget: Number(budget),
          tickets: staked, candidates: reviewed, oddsTime, observations, total, version: 1 } })}>
        {total > 0 ? '買い目と予算を確定' : '見送りを確定'}
      </button>
      </fieldset>
      {final && <section className="space-y-2 border-t pt-4 text-sm">
        <h3 className="font-semibold">確定記録・払戻の検証（シミュレーション）</h3>
        <p>{new Date(final.at).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} 確定 ／ 配分 {final.total.toLocaleString()}円</p>
        {final.tickets.map(ticket => <label key={ticket.id} className="block">
          {ticket.type} {ticket.pair} ／ {Number(ticket.stake).toLocaleString()}円 ／ 100円あたりの確定払戻（外れは0円）
          <input className={`${input} max-w-44`} type="number" min="0" step="1" value={payouts[ticket.id] ?? ''}
            onChange={event => save({ payouts: { ...payouts, [ticket.id]: event.target.value } })} />
        </label>)}
        {final.total > 0 && <p role="status">{returned === null ? '払戻の入力待ち' :
          `合計払戻 ${returned.toLocaleString()}円 ／ 回収率 ${percent(returned / final.total)}`}</p>}
        <button type="button" className="rounded border px-3 py-2" onClick={() => {
          const url = URL.createObjectURL(new Blob([JSON.stringify({ race: raceInfo.id, date: raceInfo.raceDate,
            final, payouts }, null, 2)], { type: 'application/json' }))
          const link = document.createElement('a')
          link.href = url
          link.download = `race-review-${raceInfo.raceDate}-${raceInfo.id}.json`
          link.click()
          setTimeout(() => URL.revokeObjectURL(url), 1000)
        }}>確定記録をJSONで出力</button>
      </section>}
    </section>
  )
}
