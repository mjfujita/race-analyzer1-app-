import { useState } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, Gauge } from 'lucide-react'
import { nearDistanceRecord } from './initialForecast.js'

function recordText(topThree, runs) {
  if (runs == null) return '未取得'
  return runs > 0 ? `${topThree} / ${runs}` : '該当走なし'
}

const columns = [
  { key: 'rank', label: 'IDM順位', ascending: true },
  { key: 'number', label: '馬番・馬名', ascending: true },
  { key: 'idm', label: 'JRDB IDM' },
  { key: 'ability', label: '能力スコア' },
  { key: 'distance', label: '近い距離' },
  { key: 'venue', label: '同じ競馬場' },
  { key: 'course', label: '同場同距離' },
]

function recordRate(topThree, runs) {
  return runs > 0 && topThree != null ? topThree / runs : null
}

export default function AbilityPage({ race, horses, statistics, onSelectRace, onSelectHorse }) {
  const [sort, setSort] = useState({ key: 'rank', ascending: true })
  if (!race) return <div className="rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" className="font-semibold text-[#2B6CB0]" onClick={onSelectRace}>レース一覧から選ぶ</button>
  </div>

  const statsByHorse = new Map(statistics.map(row => [Number(row.horse_no), row]))
  const rows = horses.map(horse => {
    const stats = statsByHorse.get(Number(horse.no))
    const fallback = nearDistanceRecord(race, horse)
    const distanceTop3 = stats?.distance_top3 ?? fallback?.similarTopThree
    const distanceRuns = stats?.distance_runs ?? fallback?.similarRuns
    const values = {
      rank: horse.predictedFavRank,
      number: Number(horse.no),
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
              })}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(horse => {
                const stats = horse.stats
                return <tr key={horse.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold tabular-nums text-[#0B2545]">{horse.predictedFavRank ?? '—'}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => onSelectHorse(horse.id)}
                    className="font-semibold text-[#2B6CB0] hover:underline">{horse.no} {horse.name}</button></td>
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
