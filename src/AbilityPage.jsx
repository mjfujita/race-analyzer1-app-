import { Gauge } from 'lucide-react'
import { nearDistanceRecord } from './initialForecast.js'

function recordText(topThree, runs) {
  if (runs == null) return '未取得'
  return runs > 0 ? `${topThree} / ${runs}` : '該当走なし'
}

export default function AbilityPage({ race, horses, statistics, onSelectRace, onSelectHorse }) {
  if (!race) return <div className="rounded-2xl border border-slate-200 bg-white p-5">
    <button type="button" className="font-semibold text-[#2B6CB0]" onClick={onSelectRace}>レース一覧から選ぶ</button>
  </div>

  const statsByHorse = new Map(statistics.map(row => [Number(row.horse_no), row]))
  const rows = horses.map(horse => ({ ...horse, stats: statsByHorse.get(Number(horse.no)) }))
    .sort((a, b) => (a.predictedFavRank ?? Infinity) - (b.predictedFavRank ?? Infinity)
      || Number(a.no) - Number(b.no))
  const firstRank = rows[0]?.predictedFavRank
  const leaders = firstRank > 0 ? rows.filter(horse => horse.predictedFavRank === firstRank) : []
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="space-y-2 border-b border-slate-100 p-5">
        <h3 className="flex items-center gap-2 font-bold text-[#0B2545]"><Gauge className="h-5 w-5" />能力・適性</h3>
        <p className="text-sm text-slate-700">{leaders.length
          ? `能力の軸候補は ${leaders.map(horse => `${horse.no}番 ${horse.name}`).join('、')}。JRDBの出走時IDMで最上位です。`
          : '出走時IDMの順位が揃うと、能力の軸候補を表示します。'}</p>
        <p className="text-xs text-slate-500">実績は直近5走の3着内／出走数。同じ芝・ダート区分で集計します。近い距離は今回の±200m、同場同距離は競馬場と距離が一致する走です。</p>
        {!statistics.length && <p className="text-xs text-slate-500">IDM実数と競馬場別実績は、能力データ付きのDBの取得後に表示します。</p>}
      </div>
      {rows.length === 0 ? <p className="p-5 text-sm text-slate-600">このレースの出走馬情報は未取得です。</p> :
        <div className="overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500">
              <tr>{['IDM順位', '馬番・馬名', 'JRDB IDM', '能力スコア', '近い距離', '同じ競馬場', '同場同距離'].map(label =>
                <th scope="col" key={label} className="px-4 py-3 font-semibold">{label}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map(horse => {
                const stats = horse.stats
                const fallback = nearDistanceRecord(race, horse)
                return <tr key={horse.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold tabular-nums text-[#0B2545]">{horse.predictedFavRank ?? '—'}</td>
                  <td className="px-4 py-3"><button type="button" onClick={() => onSelectHorse(horse.id)}
                    className="font-semibold text-[#2B6CB0] hover:underline">{horse.no} {horse.name}</button></td>
                  <td className="px-4 py-3 tabular-nums">{stats?.idm == null ? '—' : Number(stats.idm).toFixed(1)}</td>
                  <td className="px-4 py-3 tabular-nums">{horse.abilityScore ?? '—'}</td>
                  <td className="px-4 py-3">{recordText(stats?.distance_top3 ?? fallback?.similarTopThree, stats?.distance_runs ?? fallback?.similarRuns)}</td>
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
