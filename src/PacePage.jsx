import { useState } from 'react'
import { CloudSun, Flag } from 'lucide-react'

const card = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const percent = new Intl.NumberFormat('ja-JP', { style: 'percent' })

const styles = { 1: '逃げ', 2: '先行', 3: '差し', 4: '追込' }

const surfaceLabels = { 1: '芝', 2: 'ダート' }

export function summarizeBias(results) {
  const total = results.reduce((sum, row) => sum + row.top_count, 0)
  const front = results.reduce((sum, row) => sum + row.front_top_count, 0)
  const expected = results.reduce((sum, row) =>
    sum + row.top_count * Math.ceil(row.field_size / 3) / row.field_size, 0)
  const difference = total ? (front - expected) / total : 0
  const direction = results.length < 3 ? 'pending'
    : difference >= 0.15 ? 'front' : difference <= -0.15 ? 'rear' : 'neutral'
  return { total, front, expected, direction, results, verdict: {
    pending: '判定保留', front: '前残り傾向', rear: '中団・後方の好走が多い', neutral: '目立った偏りなし',
  }[direction] }
}

function horseList(horses) {
  return horses.length ? horses.slice(0, 5).map(horse => `${horse.no}番 ${horse.name}`).join('、') : '該当馬なし・脚質未取得'
}

function positionProfile(race, horse, style) {
  const goingRuns = (horse.pastRuns ?? []).filter(run => race.going && race.going !== '—'
    && run.dist?.startsWith(race.surface) && run.going === race.going && Number(run.rank) > 0).slice(0, 5)
  return {
    no: horse.no, name: horse.name, style, rank: horse.predictedFavRank, goingRuns: goingRuns.length,
    goingTop3: goingRuns.filter(run => Number(run.rank) <= 3).length,
  }
}

export function readPaceResults(userId, race) {
  const key = `pace-results:v1:${userId}:${race.raceDate}:${race.placeCode}`
  try {
    return {
      ...JSON.parse(localStorage.getItem(`${key}:芝`)),
      ...JSON.parse(localStorage.getItem(`${key}:ダート`)),
      ...JSON.parse(localStorage.getItem(key)),
    }
  } catch { return {} }
}

export function recordedPaceRows(earlierRaces, recorded) {
  return earlierRaces.filter(row => recorded[row.race_no]).map(row => {
    const { field, positions } = recorded[row.race_no]
    return { ...row, field_size: field, top_count: positions.length,
      front_top_count: positions.filter(pos => pos <= Math.ceil(field / 3)).length }
  })
}

export default function PacePage({ race, horses, statistics, earlierRaces, userId }) {
  const key = `pace-results:v1:${userId}:${race.raceDate}:${race.placeCode}`
  const [recorded, setRecorded] = useState(() => readPaceResults(userId, race))
  const [error, setError] = useState('')
  function saveResult(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const raceNo = Number(form.get('raceNo'))
    const field = Number(form.get('field'))
    const positions = ['first', 'second', 'third'].map(key => Number(form.get(key)))
    if (!earlierRaces.some(row => row.race_no === raceNo)
      || !Number.isInteger(field) || field < 6 || field > 18
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

  const results = recordedPaceRows(earlierRaces, recorded)
  const styleByNumber = new Map(statistics.map(row => [Number(row.horse_no), Number(row.running_style)]))
  const profiles = horses.map(horse => positionProfile(race, horse, styleByNumber.get(Number(horse.no))))
  const likelyFront = profiles.filter(horse => horse.style === 1 || horse.style === 2)
  const leaders = likelyFront.filter(horse => horse.style === 1)
  const knownProfiles = profiles.filter(horse => styles[horse.style]).length
  const summaries = Object.entries(surfaceLabels).map(([code, label]) => ({
    label, ...summarizeBias(results.filter(row => String(row.surface_code) === code)),
  }))
  const targetBias = summaries.find(summary => summary.label === race.surface)
  const paceLabel = knownProfiles < Math.ceil(horses.length * 2 / 3) || knownProfiles === 0 ? '判定保留'
    : leaders.length <= 1 && likelyFront.length <= 2 ? '隊列が落ち着く可能性'
    : leaders.length >= 2 || likelyFront.length >= Math.max(3, Math.ceil(knownProfiles / 3)) ? '前の位置取りが競る可能性'
    : '前に行く馬が複数'
  const orderByIdm = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.no - b.no
  const frontCandidates = [...likelyFront].sort(orderByIdm)
  const rearCandidates = profiles.filter(horse => horse.style === 3 || horse.style === 4).sort(orderByIdm)
  const contested = paceLabel === '前の位置取りが競る可能性'
  const favoriteScenario = targetBias?.direction === 'rear' ? '差しが届く展開を重視'
    : targetBias?.direction === 'front' ? (contested ? '前残り傾向あり。先行争い次第で差しも警戒' : '前残りの展開を重視')
    : paceLabel === '判定保留' ? '脚質データが揃うまで軸は保留'
    : contested ? '脚質構成から差しが届く展開に注意'
    : paceLabel === '隊列が落ち着く可能性' ? '脚質構成から前残りに注意'
    : '前残りと差しの両方を想定'

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
      <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm font-semibold text-[#0B2545]">
        今回の見立て　{favoriteScenario}
      </p>
      <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">隊列が落ち着いて前が残るなら</p>
          <p className="mt-1 text-slate-700">{horseList(frontCandidates)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="font-semibold">先行争いが続き、差しが届くなら</p>
          <p className="mt-1 text-slate-700">{horseList(rearCandidates)}</p>
        </div>
      </div>
      <p className="mt-2 text-xs text-slate-500">候補は脚質が合う馬をIDM順位順に最大5頭表示。</p>
    </section>
    <section className={card}>
      <h3 className="font-bold text-[#0B2545]">当日開催の傾向</h3>
      <p className="mt-1 text-xs text-slate-500">同日・同場で今回より前に終わったレースを集計。3レース以上で、4角前方3分の1にいた馬の3着内比率が比較基準から15ポイント以上離れると傾向ありと判定します。</p>
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {summaries.map(summary => <div key={summary.label} className="rounded-lg border border-slate-200 p-3 text-sm">
          <h4 className="font-semibold">{summary.label}　{summary.label === race.surface && '（今回の予想に使用）'}</h4>
          <p>{summary.verdict} ・ {summary.results.length}レース</p>
          {summary.total > 0 && <p className="text-xs text-slate-600">
            3着以内のうち4角前方 {summary.front}/{summary.total}頭（{percent.format(summary.front / summary.total)}、比較基準 {percent.format(summary.expected / summary.total)}）
          </p>}
          {summary.results.length > 0 && <ul className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
            {summary.results.map(row => <li key={row.race_no} className="rounded bg-slate-100 px-2 py-1">
              {row.race_no}R {row.distance}m　4角前方 {row.front_top_count}/{row.top_count}頭
            </li>)}
          </ul>}
        </div>)}
      </div>
      {earlierRaces.length > 0 && <details className="mt-3 text-sm text-slate-700">
        <summary className="cursor-pointer font-semibold text-[#2B6CB0]">確定したレース結果を記録</summary>
        <p className="mt-1 text-xs text-slate-500">4角で同じ集団にいた馬は、集団の先頭順位を入力してください。</p>
        <form onSubmit={saveResult} className="mt-2 flex flex-wrap items-end gap-2">
          <label>対象レース<select name="raceNo" className="ml-1 rounded border border-slate-300 p-1">
            {earlierRaces.map(row => <option key={row.race_no} value={row.race_no}>{row.race_no}R {surfaceLabels[row.surface_code]}</option>)}
          </select></label>
          {[['field', '実出走頭数', 6], ['first', '1着馬の4角', 1], ['second', '2着馬の4角', 1], ['third', '3着馬の4角', 1]]
            .map(([name, label, min]) => <label key={name}>{label}
              <input className="ml-1 w-16 rounded border border-slate-300 p-1" type="number" name={name} min={min} max="18" required />
            </label>)}
          <button type="submit" className="rounded bg-[#0B2545] px-3 py-1.5 text-white">このブラウザに保存</button>
          {error && <p role="alert" className="text-red-700">{error}</p>}
        </form>
      </details>}
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
