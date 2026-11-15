import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Gauge } from 'lucide-react'
import { oddsStorageKey, readOddsHistory } from './oddsHistory.js'
import { nearDistanceRecord } from './initialForecast.js'

function recordText(topThree, runs) {
  if (runs == null) return '未取得'
  return runs > 0 ? `${topThree} / ${runs}` : '該当走なし'
}

const oddsChangeFormat = new Intl.NumberFormat('ja-JP', {
  style: 'percent', maximumFractionDigits: 1, signDisplay: 'exceptZero',
})

const columns = [
  { key: 'rank', label: 'IDM順位', ascending: true },
  { key: 'number', label: '馬番', ascending: true },
  { key: 'odds', label: '単勝オッズ', ascending: true },
  { key: 'oddsChange', label: '単勝オッズ変化率' },
  { key: 'idm', label: 'JRDB IDM' },
  { key: 'ability', label: '能力スコア' },
  { key: 'distance', label: '近い距離' },
  { key: 'venue', label: '同じ競馬場' },
  { key: 'course', label: '同場同距離' },
]

function recordRate(topThree, runs) {
  return runs > 0 && topThree != null ? topThree / runs : null
}

export default function AbilityPage({ race, horses, statistics, userId, onSelectRace, onSelectHorse }) {
  const storageKey = oddsStorageKey(userId, race)
  return <AbilityTable key={storageKey} {...{ race, horses, statistics, storageKey, onSelectRace, onSelectHorse }} />
}

function AbilityTable({ race, horses, statistics, storageKey, onSelectRace, onSelectHorse }) {
  const [sort, setSort] = useState({ key: 'rank', ascending: true })
  const [history, setHistory] = useState(() => readOddsHistory(storageKey))
  const [selectedTime, setSelectedTime] = useState('')
  const snapshotIndex = Math.max(0, history.findIndex(item => item.time === selectedTime))
  const snapshot = history[snapshotIndex]
  const previousSnapshot = history[snapshotIndex + 1]
  const [edit, setEdit] = useState(false)
  const [error, setError] = useState('')
  if (!race) return <div className="rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" className="font-semibold text-[#2B6CB0]" onClick={onSelectRace}>レース一覧から選ぶ</button>
  </div>

  function saveOdds(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const time = form.get('time')
    const lines = form.get('odds').trim().split(/\r?\n/).filter(line => line.trim())
    const horseNumbers = new Set(horses.map(horse => Number(horse.no)))
    const odds = {}
    for (const line of lines) {
      const match = line.trim().match(/^(\d+)[\s,、]+(\d+(?:\.\d+)?)$/)
      const number = Number(match?.[1])
      const value = Number(match?.[2])
      if (!horseNumbers.has(number) || !Number.isFinite(value) || value < 1 || number in odds) {
        setError(`馬番と単勝オッズを確認してください。入力行「${line}」`)
        return
      }
      odds[number] = value
    }
    if (!time || !lines.length) {
      setError('観測時刻と単勝オッズを入力してください。')
      return
    }
    const next = [...history.filter(item => item.time !== time), { time, odds }]
      .sort((a, b) => b.time.localeCompare(a.time))
    try {
      localStorage.setItem(storageKey, JSON.stringify(next))
      setHistory(next)
      setSelectedTime(time)
      setEdit(false)
      setError('')
    } catch {
      setError('このブラウザに保存できませんでした。')
    }
  }

  const statsByHorse = new Map(statistics.map(row => [Number(row.horse_no), row]))
  const rows = horses.map(horse => {
    const stats = statsByHorse.get(Number(horse.no))
    const fallback = nearDistanceRecord(race, horse)
    const distanceTop3 = stats?.distance_top3 ?? fallback?.similarTopThree
    const distanceRuns = stats?.distance_runs ?? fallback?.similarRuns
    const odds = snapshot?.odds[horse.no]
    const previousOdds = previousSnapshot?.odds[horse.no]
    const oddsChange = odds != null && previousOdds > 0 ? (odds / previousOdds - 1) * 100 : null
    const values = {
      rank: horse.predictedFavRank,
      number: Number(horse.no),
      odds,
      oddsChange,
      idm: stats?.idm,
      ability: horse.abilityScore,
      distance: recordRate(distanceTop3, distanceRuns),
      venue: recordRate(stats?.venue_top3, stats?.venue_runs),
      course: recordRate(stats?.course_top3, stats?.course_runs),
    }
    return { ...horse, stats, distanceTop3, distanceRuns, values }
  })
  const firstRank = Math.min(...rows.map(horse => horse.predictedFavRank ?? Infinity))
  const leaders = rows.filter(horse => horse.predictedFavRank === firstRank)
  rows.sort((a, b) => {
    const av = a.values[sort.key]
    const bv = b.values[sort.key]
    if (av == null && bv != null) return 1
    if (av != null && bv == null) return -1
    const order = (av - bv) * (sort.ascending ? 1 : -1)
    return order || a.values.number - b.values.number
  })
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="space-y-2 border-b border-slate-100 p-5">
        <h3 className="flex items-center gap-2 font-bold text-[#0B2545]"><Gauge className="h-5 w-5" />能力・適性</h3>
        <p className="text-sm text-slate-700">{leaders.length
          ? `能力の軸候補は ${leaders.map(horse => `${horse.no}番 ${horse.name}`).join('、')}。JRDBの出走時IDMで最上位です。`
          : '出走時IDMの順位が揃うと、能力の軸候補を表示します。'}</p>
        <p className="text-xs text-slate-500">実績は直近5走の3着内／出走数。同じ芝・ダート区分で集計します。近い距離は今回の±200m、同場同距離は競馬場と距離が一致する走です。実績列は3着内率で並び替えます。</p>
        {!statistics.length && <p className="text-xs text-slate-500">IDM実数と競馬場別実績は、能力データ付きのDBの取得後に表示します。</p>}
        {rows.length > 0 && <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <span className="text-slate-600">{snapshot ? `単勝オッズ ${snapshot.time}時点（日本時間・手入力）` : '単勝オッズは未入力です。'}</span>
            {history.length > 1 && <label>表示時刻
              <select value={snapshot.time} onChange={e => { setSelectedTime(e.target.value); setEdit(false) }}
                className="ml-1 rounded border border-slate-300 bg-white px-2 py-1">
                {history.map(item => <option key={item.time} value={item.time}>{item.time}</option>)}
              </select>
            </label>}
            {previousSnapshot && <span className="text-slate-600">変化率は {previousSnapshot.time} 時点と比較</span>}
            <button type="button" className="font-semibold text-[#2B6CB0] hover:underline" aria-expanded={edit}
              onClick={() => { setEdit(!edit); setError('') }}>{edit ? '閉じる' : '単勝オッズを記録'}</button>
          </div>
          {edit && <form onSubmit={saveOdds} className="max-w-md space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <label className="block">観測時刻（日本時間）
              <input name="time" type="time" required
                className="ml-2 rounded border border-slate-300 bg-white px-2 py-1" />
            </label>
            <label className="block">馬番と単勝オッズ（1頭につき1行）
              <textarea name="odds" required rows={4} placeholder={'7 4.6\n15 9.9'}
                className="mt-1 block w-full rounded border border-slate-300 bg-white p-2" />
            </label>
            {error && <p role="alert" className="text-red-700">{error}</p>}
            <button type="submit" className="rounded bg-[#0B2545] px-3 py-1.5 font-semibold text-white">このブラウザに保存</button>
          </form>}
        </div>}
      </div>
      {rows.length === 0 ? <p className="p-5 text-sm text-slate-600">このレースの出走馬情報は未取得です。</p> :
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>{columns.map(column => {
                const active = sort.key === column.key
                const Icon = active ? (sort.ascending ? ArrowUp : ArrowDown) : ChevronsUpDown
                return (
                  <th scope="col" key={column.key} className="px-4 py-3 font-semibold"
                    aria-sort={active ? (sort.ascending ? 'ascending' : 'descending') : undefined}>
                    <button type="button" className="inline-flex items-center gap-1 hover:text-[#2B6CB0]"
                      onClick={() => setSort(previous => ({
                        key: column.key,
                        ascending: previous.key === column.key ? !previous.ascending : Boolean(column.ascending),
                      }))}>
                      {column.label}<Icon aria-hidden="true" className="h-3.5 w-3.5" />
                    </button>
                  </th>
                )
              }).flatMap((header, index) => index === 1
                ? [header, <th scope="col" key="name" className="px-4 py-3 font-semibold">馬名</th>]
                : [header])}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(horse => {
                const stats = horse.stats
                return <tr key={horse.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold tabular-nums text-[#0B2545]">{horse.predictedFavRank ?? '—'}</td>
                  <td className="px-4 py-3 tabular-nums">{horse.no}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => onSelectHorse(horse.id)}
                    className="font-semibold text-[#2B6CB0] hover:underline">{horse.name}</button></td>
                  <td className="px-4 py-3 tabular-nums">{horse.values.odds == null ? '—' : horse.values.odds.toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums">
                    {horse.values.oddsChange == null ? '—' : oddsChangeFormat.format(horse.values.oddsChange / 100)}
                  </td>
                  <td className="px-4 py-3 tabular-nums">{stats?.idm == null ? '—' : Number(stats.idm).toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums">{horse.abilityScore ?? '—'}</td>
                  <td className="px-4 py-3">{recordText(horse.distanceTop3, horse.distanceRuns)}</td>
                  <td className="px-4 py-3">{recordText(stats?.venue_top3, stats?.venue_runs)}</td>
                  <td className="px-4 py-3">{recordText(stats?.course_top3, stats?.course_runs)}</td>
                </tr>
              })}
            </tbody>
          </table>
        </div>}
    </section>
  )
}
