import { useState } from 'react'
import { CloudSun, Flag } from 'lucide-react'

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const percent = new Intl.NumberFormat('ja-JP', { style: 'percent' })

const styles = { 1: '逃げ', 2: '先行', 3: '差し', 4: '追込' }

function positionProfile(race, horse, style) {
  const goingRuns = (horse.pastRuns ?? []).filter(run => race.going && race.going !== '—'
    && run.dist?.startsWith(race.surface) && run.going === race.going && Number(run.rank) > 0).slice(0, 5)
  return {
    no: horse.no, name: horse.name, style, goingRuns: goingRuns.length,
    goingTop3: goingRuns.filter(run => Number(run.rank) <= 3).length,
  }
}

export default function PacePage({ race, horses, statistics, earlierRaces, userId }) {
  const key = `pace-results:v1:${userId}:${race.raceDate}:${race.placeCode}:${race.surface}`
  const [recorded, setRecorded] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? {} }
    catch { return {} }
  })
  const [error, setError] = useState('')
  function saveResult(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const raceNo = Number(form.get('raceNo'))
    const field = Number(form.get('field'))
    const positions = ['first', 'second', 'third'].map(key => Number(form.get(key)))
    if (!earlierRaces.some(row => row.race_no === raceNo)
      || !Number.isInteger(field) || field < 6 || field > 18
      || new Set(positions).size !== positions.length
      || positions.some(pos => !Number.isInteger(pos) || pos < 1 || pos > field)) {
      setError('実出走頭数と4角順位を確認してください。')
      return
    }
    const next = { ...recorded, [raceNo]: { field, positions } }
    try {
      localStorage.setItem(key, JSON.stringify(next))
      setRecorded(next)
      setError('')
    } catch { setError('このブラウザに保存できませんでした。') }
  }

  const results = earlierRaces.filter(row => recorded[row.race_no]).map(row => {
    const { field, positions } = recorded[row.race_no]
    return { ...row, field_size: field, top_count: positions.length,
      front_top_count: positions.filter(pos => pos <= Math.ceil(field / 3)).length }
  })
  const styleByNumber = new Map(statistics.map(row => [Number(row.horse_no), Number(row.running_style)]))
  const profiles = horses.map(horse => positionProfile(race, horse, styleByNumber.get(Number(horse.no))))
  const likelyFront = profiles.filter(horse => horse.style === 1 || horse.style === 2)
  const leaders = likelyFront.filter(horse => horse.style === 1)
  const knownProfiles = profiles.filter(horse => styles[horse.style]).length
  const topCount = results.reduce((sum, row) => sum + row.top_count, 0)
  const frontTop = results.reduce((sum, row) => sum + row.front_top_count, 0)
  const expectedFront = results.reduce((sum, row) =>
    sum + row.top_count * Math.ceil(row.field_size / 3) / row.field_size, 0)
  const frontBias = results.length >= 3 && (frontTop - expectedFront) / topCount >= 0.15
  const rearBias = results.length >= 3 && (expectedFront - frontTop) / topCount >= 0.15
  const biasLabel = results.length < 3 ? '判定保留' : frontBias ? '前残り傾向'
    : rearBias ? '中団・後方の好走が多い' : '目立った偏りなし'
  const paceLabel = knownProfiles < Math.ceil(horses.length * 2 / 3) || knownProfiles === 0 ? '判定保留'
    : leaders.length <= 1 && likelyFront.length <= 2 ? '隊列が落ち着く可能性'
    : leaders.length >= 2 || likelyFront.length >= Math.max(3, Math.ceil(knownProfiles / 3)) ? '前の位置取りが競る可能性'
    : '前に行く馬が複数'
  const candidates = frontBias ? likelyFront : rearBias
    ? profiles.filter(horse => horse.style === 3 || horse.style === 4) : []

  return <div className="space-y-4">
    <section className={card}>
      <h3 className="flex items-center gap-2 font-bold text-[#0B2545]"><CloudSun className="h-5 w-5" />天候・馬場</h3>
      <p className="mt-2 text-sm text-slate-700">天候 {race.weather || '未取得'} ・ 馬場 {race.going || '未取得'} ・ {race.distance}</p>
      <p className="mt-1 text-xs text-slate-500">レース情報に登録されている値です。</p>
    </section>
    <section className={card}>
      <h3 className="flex items-center gap-2 font-bold text-[#0B2545]"><Flag className="h-5 w-5" />展開予想</h3>
      <p className="mt-2 text-sm font-semibold">想定展開　{paceLabel}</p>
      <p className="mt-1 text-sm text-slate-700">逃げ {leaders.length}頭 ・ 逃げ／先行 {likelyFront.length}頭 ／ 判定できた馬 {knownProfiles}頭</p>
      <p className="mt-2 text-sm font-semibold">当日の傾向　{biasLabel}</p>
      <p className="mt-1 text-sm text-slate-700">{topCount > 0
        ? `同日・同場・同じ芝／ダートのそれ以前の ${results.length} レースで、3着以内の延べ ${topCount} 頭中 ${frontTop} 頭（${percent.format(frontTop / topCount)}）が4角で前方3分の1。頭数に応じた比較基準は ${percent.format(expectedFront / topCount)}。`
        : '対象レースより前の、4角順位が揃った結果は未取得です。'}</p>
      <p className="mt-2 text-xs text-slate-500">3レース以上で、比較基準との差が15ポイント以上の場合に傾向ありと判定します。</p>
      {candidates.length > 0 && <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-[#0B2545]">
        当日の傾向に合う候補　{candidates.map(horse => `${horse.no}番 ${horse.name}`).join('、')}
        {frontBias && paceLabel === '前の位置取りが競る可能性' && '。先行争いが続く場合は割り引いて見ます。'}
      </p>}
      {earlierRaces.length > 0 && <details className="mt-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-[#2B6CB0]">確定したレース結果を記録</summary>
        <form onSubmit={saveResult} className="mt-2 flex flex-wrap items-end gap-2">
          <label>対象レース<select name="raceNo" className="ml-1 rounded border border-slate-300 p-1">
            {earlierRaces.map(row => <option key={row.race_no} value={row.race_no}>{row.race_no}R</option>)}
          </select></label>
          {[['field', '実出走頭数', 6], ['first', '1着馬の4角', 1], ['second', '2着馬の4角', 1], ['third', '3着馬の4角', 1]]
            .map(([name, label, min]) => <label key={name}>{label}
              <input className="ml-1 w-16 rounded border border-slate-300 p-1" type="number" name={name} min={min} max="18" required />
            </label>)}
          <button type="submit" className="rounded bg-[#0B2545] px-3 py-1.5 text-white">このブラウザに保存</button>
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </form>
      </details>}
      {results.length > 0 && <ul className="mt-3 flex flex-wrap gap-2 text-xs text-slate-700" aria-label="傾向の根拠となるレース">
        {results.map(row => <li key={row.race_no} className="rounded bg-slate-100 px-2 py-1">
          {row.race_no}R {row.distance}m　前方 {row.front_top_count}/{row.top_count}頭
        </li>)}
      </ul>}
    </section>
    <section className={card}>
      <h3 className="font-bold text-[#0B2545]">出走馬ごとの根拠</h3>
      <p className="mt-1 text-xs text-slate-500">脚質はJRDBの出走馬データを使用。馬場実績は同じ芝・ダートと馬場状態の直近最大5走です。</p>
      {profiles.length === 0 ? <p className="mt-3 text-sm text-slate-600">出走馬情報は未取得です。</p> :
        <div className="mt-3 overflow-x-auto">
          <table className="w-full whitespace-nowrap text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600"><tr>
              <th scope="col" className="p-2">馬番・馬名</th>
              <th scope="col" className="p-2">JRDB脚質</th>
              <th scope="col" className="p-2">同じ馬場状態の3着内／出走</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {profiles.map(horse => <tr key={horse.no}>
                <th scope="row" className="p-2 font-medium">{horse.no} {horse.name}</th>
                <td className="p-2">{styles[horse.style] ?? '未取得'}</td>
                <td className="p-2">{horse.goingRuns ? `${horse.goingTop3} / ${horse.goingRuns}` : '該当走なし'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
    </section>
  </div>
}
