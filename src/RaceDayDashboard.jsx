import { useEffect, useState } from 'react'
import { ArrowRight, Database } from 'lucide-react'
import { decisionCutoff, formatRaceTime, japanRaceDay, raceDateISO, raceTimestamp, validTimestamp } from './raceTime.js'
import { ledgerScope, readLedger } from './forecastLedger.js'

const panelBase = 'rounded-2xl border px-4 py-4 shadow-sm sm:px-5'
const panel = `${panelBase} border-slate-200 bg-white`
const link = 'inline-flex items-center gap-1 rounded text-left text-sm font-semibold text-sky-800 hover:underline disabled:opacity-50'
const primary = 'inline-flex items-center gap-2 rounded-lg bg-[#0B2545] px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50'
const raceClock = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
const timeLabel = value => validTimestamp(value) ? raceClock.format(new Date(value)) : '時刻未取得'
const dateLabel = date => dayLabel.format(new Date(`${raceDateISO({ raceDate: date })}T00:00:00+09:00`))
const arrow = <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />

function forecastStatus(race, userId) {
  if (race.hasForecast || race.receipt) return 'saved'
  const { ledger, error } = readLedger(localStorage, ledgerScope(userId, race))
  return error ? 'unknown' : ledger.forecasts.length > 0 ? 'local' : 'none'
}

function raceStatus(race, now) {
  if (race.review?.state === 'matched') return { label: '着順照合済み', action: 'review', text: '振り返る' }
  if (race.review?.state === 'result-conflict' || race.review?.state === 'incomplete-or-abnormal') {
    return { label: '着順を確認中', action: 'review', text: '振り返る' }
  }
  if (race.receipt) return { label: '予想を締切前に受領済み', action: 'forecast', text: '保存した予想を見る' }
  if (race.saved === 'saved' || race.saved === 'local') {
    return { label: race.saved === 'local' ? 'このブラウザに予想保存済み' : '予想保存済み', action: 'forecast', text: '保存した予想を見る' }
  }
  if (race.saved === 'unknown') return { label: '予想の保存状況を確認中', action: 'forecast', text: 'レースを開く' }
  if (Number.isFinite(race.post) && race.post <= now) return { label: '結果照合待ち', action: 'automation', text: '取得状況を確認' }
  if (Number.isFinite(race.cutoff) && race.cutoff <= now) return { label: '判断締切を経過', action: 'forecast', text: 'レースを開く' }
  if (race.oddsRetrievedAt) return { label: '単勝オッズ取得済み・予想未保存', action: 'forecast', text: '軸馬2頭を確認' }
  return { label: '単勝オッズ取得待ち', action: 'automation', text: '取得状況を確認' }
}

export default function RaceDayDashboard({ userId, dashboard, placeNames, onNavigate, onOpenRace, onOpenReview, onOpenList, children }) {
  const [now, setNow] = useState(() => Date.now())
  const [opening, setOpening] = useState(null)
  const [openError, setOpenError] = useState('')
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000)
    return () => clearInterval(timer)
  }, [])
  const date = japanRaceDay(now)
  const data = dashboard.data?.date === date ? dashboard.data : null
  const races = (data?.races ?? []).map(race => ({
    ...race, saved: forecastStatus(race, userId), cutoff: Date.parse(decisionCutoff(race)),
    post: Date.parse(raceTimestamp(race, race.postTime)), place: race.place ?? placeNames[race.placeCode] ?? '',
  })).sort((a, b) => (a.post || Infinity) - (b.post || Infinity) || a.id.localeCompare(b.id))
  const next = dashboard.error ? null : races.find(race => race.cutoff > now && Date.parse(race.oddsRetrievedAt) <= now
    && race.saved === 'none' && !race.review)
  const otherRaces = [
    ...races.filter(race => race.id !== next?.id && (!Number.isFinite(race.post) || race.post > now)).slice(0, 4),
    ...races.filter(race => race.post <= now).reverse().slice(0, 2),
  ]

  async function openRace(race) {
    setOpening(race.id)
    setOpenError('')
    try { await onOpenRace(race) }
    catch (error) { setOpenError(error.message) }
    finally { setOpening(null) }
  }

  const loading = dashboard.loading || (!data && !dashboard.error)
  return <div className="space-y-4 pb-14">
    <header>
      <p className="text-sm font-bold tabular-nums text-[#2B6CB0]">{dateLabel(date)}</p>
      <h1 className="mt-1 text-3xl font-black text-[#0B2545]">開催ダッシュボード</h1>
    </header>
    {children}
    <section aria-label="JRDBの同期状況" className={`${panel} flex flex-wrap items-center justify-between gap-3`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="flex items-center gap-2 font-bold text-[#0B2545]"><Database aria-hidden="true" className="h-4 w-4" /> JRDBデータ</h2>
        <p role="status" className="text-sm text-slate-600">{data?.lastDataSentAt
          ? `最終受信 ${formatRaceTime(data.lastDataSentAt)}`
          : loading ? '受信状況を確認中' : '受信時刻を確認できません'}</p>
      </div>
      <button type="button" className={link} onClick={() => onNavigate('automation')}>同期状況を確認 {arrow}</button>
    </section>
    {dashboard.error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{dashboard.error}</p>}
    {openError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{openError}</p>}
    {next && <section aria-labelledby="next-race-title" className={`${panelBase} flex flex-wrap items-center justify-between gap-4 border-sky-200 bg-sky-50`}>
      <div>
        <p className="text-sm font-semibold text-sky-800">次に予想を確認できるレース</p>
        <h2 id="next-race-title" className="mt-1 text-xl font-bold text-[#0B2545]">{next.place}{next.raceNo}R {next.name}</h2>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm tabular-nums">
          <span>発走 <strong>{timeLabel(new Date(next.post).toISOString())}</strong></span>
          <span>判断締切 <strong>{timeLabel(new Date(next.cutoff).toISOString())}</strong></span>
        </div>
        <p className="mt-1 text-xs tabular-nums text-slate-600">単勝オッズ {timeLabel(next.oddsRetrievedAt)} 取得 · 予想未保存</p>
      </div>
      <button type="button" className={primary} onClick={() => openRace(next)} disabled={Boolean(opening)}>{opening === next.id ? '読み込み中…' : '軸馬2頭を確認'} {arrow}</button>
    </section>}
    {races.length > 0 && <section aria-labelledby="race-progress-title" className={panel}>
      <h2 id="race-progress-title" className="font-bold text-[#0B2545]">{next ? 'ほかのレースの進捗' : 'レースの進捗'}</h2>
      {!next && !dashboard.error && <p className="mt-1 text-sm text-slate-600">判断締切前で、単勝オッズ取得済みの未保存レースはありません。</p>}
      {otherRaces.length > 0 && <ul className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
        {otherRaces.map(race => {
          const state = raceStatus(race, now)
          return <li key={race.id} className="grid items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-[#0B2545]">{race.place}{race.raceNo}R {race.name}</p>
              <p className="text-xs tabular-nums text-slate-600">{Number.isFinite(race.post) ? `${timeLabel(new Date(race.post).toISOString())} 発走` : '発走時刻未取得'}</p>
            </div>
            <span className="text-sm text-slate-700">{state.label}</span>
            <button type="button" disabled={state.action === 'forecast' && Boolean(opening)}
              className={`${link} w-fit`} aria-label={`${race.place}${race.raceNo}Rの${state.text}`}
              onClick={() => state.action === 'review' ? onOpenReview(race.review.forecastId)
                : state.action === 'forecast' ? openRace(race) : onNavigate('automation')}>
              {opening === race.id ? '読み込み中…' : state.text} {arrow}
            </button>
          </li>
        })}
      </ul>}
      <button type="button" className={`${link} mt-3`} onClick={() => onOpenList(date)}>レース一覧を開く {arrow}</button>
    </section>}
    {!races.length && <section aria-labelledby="race-day-empty-title" className={panel}>
      <h2 id="race-day-empty-title" className="font-bold text-[#0B2545]">{data?.schedule === 'no-races'
        ? '本日の開催なし' : data?.schedule === 'scheduled' ? '開催情報の取得待ち' : '開催情報を確認中'}</h2>
      {data?.schedule === 'no-races'
        ? <><p className="mt-1 text-sm text-slate-600">{data.lastMeeting ? `取込済みの直近開催 ${dateLabel(data.lastMeeting)}` : 'JRAの開催日程を確認しました。'}</p>
          <button type="button" className={`${link} mt-3`} onClick={() => onOpenReview()}>予想の振り返りを開く {arrow}</button></>
        : <p className="mt-1 text-sm text-slate-600">{data?.schedule === 'scheduled' ? 'JRAの開催予定を確認しました。JRDBのレースデータが届き次第表示します。'
          : '開催日程を確認でき次第、レースの進捗を表示します。'}</p>}
    </section>}
  </div>
}
