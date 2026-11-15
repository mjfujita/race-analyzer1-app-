import { useState } from 'react'
import { Upload, Database } from 'lucide-react'
import { parseRaceObservations, mergeRaceObservations } from './forecastLedger.js'
import { formatRaceTime } from './raceTime.js'

const dataKey = scope => `race-observations:v1:${encodeURIComponent(scope.userId)}:${scope.raceDate}:${encodeURIComponent(scope.raceId)}`

export function readRaceData(scope) {
  try {
    const raw = globalThis.localStorage.getItem(dataKey(scope))
    return { bundle: raw ? parseRaceObservations(raw, scope) : null, error: null }
  } catch (error) { return { bundle: null, error: `観測データを読み込めませんでした。元データは保護しています。${error.message}` } }
}

export default function RaceDataPanel({ scope, data, onChange }) {
  const [error, setError] = useState(data.error)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const events = data.bundle?.observations ?? []
  const paddock = new Map()
  for (const event of [...events].sort((a, b) => Date.parse(a.retrievedAt) - Date.parse(b.retrievedAt))) {
    if (event.kind === 'TYB') paddock.set(event.payload.horseNo, event)
  }
  const payouts = events.filter(event => event.kind === 'HJC')
  async function importData(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true); setNotice('')
    try {
      if (data.error) throw new Error('保存済みデータを読み出せないため、上書きは行いません。')
      if (file.size > 15_000_000) throw new Error('15MB以下のJSONを指定してください。')
      const incoming = parseRaceObservations(await file.text(), scope)
      const merged = mergeRaceObservations(data.bundle, incoming, scope)
      globalThis.localStorage.setItem(dataKey(scope), JSON.stringify(merged))
      onChange({ bundle: merged, error: null }); setError(null)
      setNotice(`このレースの観測記録${merged.observations.length}件を保存しました。`)
    } catch (problem) { setError(problem.message) }
    finally { setBusy(false); event.target.value = '' }
  }
  return <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><Database className="h-4 w-4 text-cyan-700" />JRDB直前情報と確定払戻</h3>
      <label className={`inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold ${busy || data.error ? 'opacity-40' : 'cursor-pointer hover:bg-slate-50'}`}><Upload className="h-4 w-4" />{busy ? '取込み中…' : '観測データJSONを取り込む'}<input type="file" accept="application/json,.json" className="sr-only" disabled={busy || Boolean(data.error)} onChange={importData} /></label></div>
    <p className="text-xs text-slate-500">自動取込みが出力したobservations.jsonから、このレースのTYBとHJCを照合します。HJCは下の実購入記録への払戻入力に利用できます。</p>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}{notice && <p role="status" className="text-sm text-cyan-800">{notice}</p>}
    {!events.length ? <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">このレースの直前情報・払戻データは未取込みです。</p> : <p className="text-sm">直前情報 {paddock.size}頭 ／ 払戻データ {payouts.length}版 {payouts.some(event => event.payload.status === 'published') ? '（確定払戻あり）' : '（確定待ち）'}</p>}
    {paddock.size > 0 && <details><summary className="cursor-pointer text-sm font-semibold text-cyan-800">パドック・馬体重を確認</summary><p className="my-2 text-xs text-amber-800">ZIPの取込み時刻は配信時刻ではありません。公開時刻を確認できない情報は過去検証用として表示し、確率へ自動加点しません。</p><div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="bg-slate-50 text-xs"><tr>{['馬番', '直前IDM', 'パドック指数', '馬体重', '増減', '取得時刻'].map(title => <th key={title} className="p-2" scope="col">{title}</th>)}</tr></thead><tbody>{[...paddock.values()].sort((a, b) => a.payload.horseNo - b.payload.horseNo).map(event => <tr key={event.eventId} className="border-t border-slate-100"><th className="p-2" scope="row">{event.payload.horseNo}</th><td className="p-2">{event.payload.idm ?? '—'}</td><td className="p-2">{event.payload.paddockIndex ?? '—'}</td><td className="p-2">{event.payload.horseWeight ?? '—'}</td><td className="p-2">{event.payload.horseWeightDelta ?? '—'}</td><td className="p-2 text-xs">{formatRaceTime(event.retrievedAt)}</td></tr>)}</tbody></table></div></details>}
  </section>
}
