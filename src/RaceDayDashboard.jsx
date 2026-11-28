import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { decisionCutoff, formatRaceTime, japanRaceDay, raceDateISO, raceTimestamp, validTimestamp } from './raceTime.js'
import { ledgerScope, readLedger } from './forecastLedger.js'

const primary = 'inline-flex items-center gap-2 rounded-lg bg-[#0B2545] px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-50'
const raceClock = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayLabel = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
const timeLabel = value => validTimestamp(value) ? raceClock.format(new Date(value)) : '時刻未取得'
const dateLabel = date => dayLabel.format(new Date(`${raceDateISO({ raceDate: date })}T00:00:00+09:00`))
const arrow = <ArrowRight aria-hidden="true" className="h-4 w-4 shrink-0" />

function forecastStatus(race, userId) {
  if (race.hasForecast || race.receipt) return 'saved'
  const { ledger, error } = readLedger(localStorage, ledgerScope(userId, race))
  return error ? 'unknown' : ledger.forecasts.length > 0 || ledger.groupPlans?.length > 0 ? 'local' : 'none'
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
  if (Number.isFinite(race.post) && race.post <= now) return { label: '結果照合待ち', action: 'forecast', text: '予想と結果を見る' }
  if (Number.isFinite(race.cutoff) && race.cutoff <= now) return { label: '判断締切を経過', action: 'forecast', text: 'レースを開く' }
  if (race.oddsRetrievedAt) return { label: '単勝オッズ取得済み・予想未保存', action: 'forecast', text: 'グループを確認' }
  return { label: '単勝オッズ取得待ち', action: 'forecast', text: '予想と結果を見る' }
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
  const [filter, setFilter] = useState('すべて')
  const [search, setSearch] = useState('')
  const filtered = races.filter(race => (filter === 'すべて' || filter === race.place || filter === '未保存だけ' && race.saved === 'none')
    && `${race.place}${race.raceNo}R ${race.name}`.includes(search))
  const places = [...new Set(races.map(race => race.place).filter(Boolean))]


  async function openRace(race,goTab=null) {
    setOpening(race.id)
    setOpenError('')
    try { await onOpenRace(race,goTab) }
    catch (error) { setOpenError(error.message) }
    finally { setOpening(null) }
  }

  const loading = dashboard.loading || (!data && !dashboard.error)
  return <div className="space-y-5">
    <header className="rca-page-title"><div><p className="text-sm font-bold text-blue-600">{dateLabel(date)}</p><h1>本日のレース</h1><p>グループで予想を組み立て、各レースの結果と照合する。</p></div><button type="button" className="rca-secondary" onClick={() => onOpenList(date)}>過去開催・PACIレース一覧</button></header>
    {children}
    {dashboard.error && <p role="alert" className="rca-error">{dashboard.error} 最後に取得した表示を保持しています。</p>}
    {openError && <p role="alert" className="rca-error">{openError}</p>}
    <dl className="rca-stat-grid">{[
      ['本日のレース', loading ? '—' : races.length, '取得済みの開催情報'],
      ['単勝データあり', loading ? '—' : races.filter(r => r.oddsRetrievedAt).length, '軸候補の有無は予想画面で判定'],
      ['判断を保存済み', loading ? '—' : races.filter(r => ['saved','local'].includes(r.saved)).length, 'ローカル保存と受領を区別'],
      ['単勝データ待ち', loading ? '—' : races.filter(r => !r.oddsRetrievedAt).length, '未取得レースを確認'],
    ].map(([name,value,detail]) => <div key={name}><dt>{name}</dt><dd>{value}</dd><p className="rca-muted">{detail}</p></div>)}</dl>
    <div className="rca-columns"><div className="rca-stack">
    {races.length > 0 ? <section className="rca-panel" aria-labelledby="race-progress-title"><h2 id="race-progress-title">開催レース</h2>
      <div className="rca-filterbar">{['すべて',...places,'未保存だけ'].map(name => <button type="button" key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}<input type="search" aria-label="レース名・番号で検索" placeholder="レース名・番号で検索" value={search} onChange={event => setSearch(event.target.value)} /></div>
      <table className="rca-list-table rca-race-table" aria-label="本日の開催レース"><thead><tr>{['発走','場・レース','条件','判断・保存','操作'].map(name => <th scope="col" key={name}>{name}</th>)}</tr></thead><tbody>{filtered.map(race => {
        const state = raceStatus(race, now)
        return <tr key={race.id}><td className="tabular-nums">{Number.isFinite(race.post) ? timeLabel(new Date(race.post).toISOString()) : '時刻未取得'}</td><th scope="row">{race.place}{race.raceNo}R <span className="block text-xs font-normal text-slate-500">{race.name}</span></th><td>{race.distance == null ? race.surface ?? '区分未取得' : /^\d+$/.test(String(race.distance)) ? `${race.surface ?? ''}${race.distance}m` : race.distance}<span className="block text-xs text-slate-500">{race.fieldSize ?? '—'}頭</span></td><td><span className="rca-pill">{state.label}</span></td><td><button type="button" aria-label={`${race.place}${race.raceNo}Rの${state.text}`} disabled={Boolean(opening)} onClick={() => openRace(race)}>{opening === race.id ? '読み込み中…' : state.text} →</button></td></tr>
      })}</tbody></table>{!filtered.length && <p className="rca-notice">条件に合うレースがありません。絞り込みを変更してください。</p>}
      <p className="rca-muted mt-4">{filtered.length} / {races.length}レースを表示。旧方式の注目レース数・推測ラベルは表示しません。</p>
    </section> : <section aria-labelledby="race-day-empty-title" className="rca-panel"><h2 id="race-day-empty-title">{data?.schedule === 'no-races' ? '本日の開催なし' : data?.schedule === 'scheduled' ? '開催情報の取得待ち' : '開催情報を確認中'}</h2><p className="rca-muted">{loading ? '開催情報を読み込んでいます。' : data?.schedule === 'no-races' ? data.lastMeeting ? `取込済みの直近開催 ${dateLabel(data.lastMeeting)}` : 'JRAの開催日程を確認しました。' : 'JRDBの開催データが届き次第、ここに表示します。'}</p><button type="button" className="rca-secondary" onClick={() => onOpenReview()}>予想の振り返りを開く</button></section>}
    </div><aside className="rca-stack">
      {next && <section aria-labelledby="next-race-title" className="rca-panel"><p className="rca-muted">次に予想を確認できるレース</p><h2 id="next-race-title" className="mt-2">{next.place}{next.raceNo}R {next.name}</h2><p className="tabular-nums">判断締切 {timeLabel(new Date(next.cutoff).toISOString())}</p><p className="rca-muted">単勝オッズ {timeLabel(next.oddsRetrievedAt)} 取得 · 予想未保存</p><button type="button" className={primary} onClick={() => openRace(next,'groups')} disabled={Boolean(opening)}>{opening === next.id ? '読み込み中…' : 'グループを確認'} {arrow}</button></section>}
      <section aria-label="JRDBの同期状況" className="rca-panel"><h2>取得状況</h2><p role="status" className="rca-muted">{data?.lastDataSentAt ? `最終受信 ${formatRaceTime(data.lastDataSentAt)}` : loading ? '受信状況を確認中' : '受信時刻を確認できません'}</p><button type="button" className="rca-secondary" onClick={() => onNavigate('automation')}>同期状況を確認 {arrow}</button></section>
    </aside></div>
  </div>
}
