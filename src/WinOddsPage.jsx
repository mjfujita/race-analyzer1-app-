import { useState } from 'react'
import { ArrowUpDown, TrendingUp, Upload } from 'lucide-react'
import { oddsStorageKey, readOddsHistory } from './oddsHistory.js'
import { analyzeMarket, buildAbilityField } from './marketModel.js'
import { formatRaceTime, snapshotTiming } from './raceTime.js'
import { loadModel, saveModel } from './modelStore.js'

const pct = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const num = value => Number.isFinite(value) ? value.toFixed(2) : '—'
const select = 'ml-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-slate-800'

export default function WinOddsPage({ race, horses, statistics = [], userId, onOpenAbility }) {
  const key = oddsStorageKey(userId, race)
  const [history] = useState(() => readOddsHistory(key))
  const [selected, setSelected] = useState(history[0]?.id ?? '')
  const [sort, setSort] = useState('gapLog')
  const [descending, setDescending] = useState(true)
  const [factor, setFactor] = useState('90')
  const [model, setModel] = useState(() => loadModel(userId))
  const [error, setError] = useState('')
  const current = history.find(item => item.id === selected)
  const available = current?.retrievedAt ? readOddsHistory(key, { asOf: current.retrievedAt }) : []
  const previous = available.find(item => Date.parse(item.observedAt) < Date.parse(current?.observedAt))
  const baseline = current?.retrievedAt ? readOddsHistory(key, { kind: 'baseline', asOf: current.retrievedAt })
    .find(item => Date.parse(item.observedAt) <= Date.parse(current.observedAt)) : null
  const ability = buildAbilityField({ horses, statistics, race, model })
  const analysis = analyzeMarket({ field: ability.field, odds: current?.odds ?? {}, baselineOdds: baseline?.odds ?? {},
    previousOdds: previous?.odds ?? {}, priceFactor: Number(factor) / 100 })
  const rows = [...analysis.rows].sort((a, b) => {
    const av = a[sort], bv = b[sort]
    if (av == null) return bv == null ? a.no - b.no : 1
    if (bv == null) return -1
    return (av - bv) * (descending ? -1 : 1) || a.no - b.no
  })
  const timing = current ? snapshotTiming(current, race) : null
  const candidates = rows.filter(row => row.stressReturn > 1).length
  const columns = [
    ['no', '馬番・馬名'], ['pF', '能力モデル勝率'], ['marketShare', '市場支持率'],
    ['baselineShare', '基準人気支持率'], ['odds', '実オッズ'], ['movement', '前回からの変化'],
    ['gapLog', '市場評価差'], ['expectedReturn', '現在価格の回収率'], ['stressReturn', '下落時の回収率'], ['fairOdds', '損益分岐オッズ'],
  ]
  return <div className="space-y-4">
    <section className="overflow-hidden rounded-2xl bg-[#0B2545] p-5 text-white shadow-sm sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs tracking-[.18em] text-cyan-300">ABILITY × MARKET</p><h3 className="mt-2 flex items-center gap-2 text-xl font-bold"><TrendingUp aria-hidden="true" />実力と市場の評価差</h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-200">強さ、売れ方、購入価格を分けて比較。人気順位の差を、確率と価格の差に置き換えます。</p></div>
        <div className="rounded-xl border border-white/20 bg-white/5 px-4 py-3 font-mono text-sm text-cyan-200">G = log(pF / q)<br /><span className="text-white">E = p × O</span></div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[['能力データ', `${ability.field.length} / ${horses.length}頭`], ['実価格で比較', `${rows.filter(r => r.odds != null).length}頭`], ['下落想定でも100%超', `${candidates}頭（試算）`]].map(([label, value]) => <div key={label} className="rounded-xl bg-white/10 p-3"><p className="text-xs text-slate-300">{label}</p><p className="mt-1 text-lg font-semibold tabular-nums">{value}</p></div>)}
      </div>
    </section>
    <section className="space-y-3 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={onOpenAbility} className="font-semibold text-[#2B6CB0]">実オッズ・基準オッズを記録</button>
        <label>表示記録<select className={select} value={selected} onChange={e => setSelected(e.target.value)}>
          {!history.length && <option value="">記録なし</option>}
          {history.map(item => <option key={item.id} value={item.id}>{item.time}</option>)}
        </select></label>
        <label>価格の感度<select className={select} value={factor} onChange={e => setFactor(e.target.value)}>
          {[100, 95, 90, 80, 70].map(value => <option key={value} value={value}>{100 - value}%下落</option>)}
        </select></label>
      </div>
      <p className="text-xs leading-relaxed text-slate-600">{current ? `元更新 ${formatRaceTime(current.observedAt)} / 取得 ${formatRaceTime(current.retrievedAt)}` : 'オッズを記録すると価格比較ができます。'}{baseline ? ` ・ 基準オッズ ${formatRaceTime(baseline.observedAt)}` : ' ・ 基準オッズ未取得'}</p>
      {timing?.reason && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{timing.reason} 表示は研究・振り返り用です。</p>}
      <p className="text-xs leading-relaxed text-slate-600">モデルは検証中です。市場支持率は投票シェアの近似で、勝率ではありません。下落率は手動の感度分析であり、学習済み最終オッズ予測ではありません。</p>
      {[...(ability.issues ?? []), ...(analysis.issues ?? [])].length > 0 && <ul className="list-inside list-disc text-sm text-amber-900">{[...new Set([...(ability.issues ?? []), ...(analysis.issues ?? [])])].map(issue => <li key={String(issue)}>{String(issue)}</li>)}</ul>}
    </section>
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 p-5"><h3 className="font-bold text-[#0B2545]">価格との比較</h3><span className="text-xs text-slate-500">列名で並び替え</span></div>
      {!rows.length ? <p className="p-5 text-sm text-slate-600">全頭の出走時IDMと、正式な出走頭数を確認してください。</p> : <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-600"><tr>{columns.map(([column, label]) => <th key={column} scope="col" className="px-4 py-3" aria-sort={sort === column ? descending ? 'descending' : 'ascending' : undefined}><button type="button" className="inline-flex items-center gap-1" onClick={() => { setSort(column); setDescending(sort === column ? !descending : column !== 'no') }}>{label}<ArrowUpDown aria-hidden="true" size={12} /></button></th>)}<th scope="col" className="p-3">解釈</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{rows.map(row => <tr key={row.no} className="hover:bg-slate-50">
          <th scope="row" className="px-4 py-3 font-semibold"><span className="mr-2 inline-flex h-6 w-6 items-center justify-center rounded bg-slate-100 font-mono">{row.no}</span>{row.name}</th>
          <td className="px-4 py-3 font-mono">{pct(row.pF)}</td><td className="px-4 py-3 font-mono">{pct(row.marketShare)}</td><td className="px-4 py-3 font-mono">{pct(row.baselineShare)}</td>
          <td className="px-4 py-3 font-mono">{num(row.odds)}</td><td className="px-4 py-3 font-mono">{pct(row.movement)}</td><td className="px-4 py-3 font-mono">{num(row.gapLog)}</td>
          <td className="px-4 py-3 font-mono">{pct(row.expectedReturn)}</td><td className={`px-4 py-3 font-mono ${row.stressReturn > 1 ? 'font-bold text-teal-700' : ''}`}>{pct(row.stressReturn)}</td>
          <td className="px-4 py-3 font-mono">{num(row.fairOdds)}</td><td className="px-4 py-3 text-xs">{row.marketShare == null ? '価格比較保留' : row.stressReturn > 1 ? '価格面の候補・検証中' : row.pF > row.marketShare ? '市場より高評価・購入条件不足' : '価格が見合わない可能性'}</td>
        </tr>)}</tbody>
      </table></div>}
      <p className="border-t border-slate-100 p-4 text-xs text-slate-500">市場評価差は正なら能力モデルの方が高評価。基準人気が揃う場合は、下の内訳で差の由来を確認できます。</p>
    </section>
    {baseline && rows.length > 0 && <details className="rounded-2xl border border-slate-200 bg-white p-5 text-sm"><summary className="cursor-pointer font-semibold text-[#0B2545]">評価差の内訳</summary><p className="my-3 text-xs text-slate-600">log(pF/q) = log(pF/q基準) + log(q基準/q)。右側は予想人気との差で、実際の資金流入額を示すものではありません。</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{rows.map(row => <p key={row.no} className="rounded-lg bg-slate-50 p-3"><strong>{row.no}番</strong>　実力と予想人気 {num(row.abilityBaselineGap)}<br /><span className="text-slate-600">予想人気と現在 {num(row.baselineMarketGap)}</span></p>)}</div></details>}
    <details className="rounded-2xl border border-slate-200 bg-white p-5 text-sm">
      <summary className="cursor-pointer font-semibold text-[#0B2545]">学習モデルと検証結果</summary>
      <p className="mt-3 text-sm">{ability.model.status === 'research' ? `適用中 ${ability.model.id} ・ 学習期限 ${ability.model.trainedThrough} ・ 温度 ${Number(ability.model.temperature).toFixed(2)}` : '初期のIDM比較モデルを使用。温度8は仮設定で、勝率校正は未検証です。'}</p>
      {model && ability.model.id !== model.id && <p className="mt-2 text-xs text-amber-800">読み込んだモデルはこのレースの時点条件を満たさないため適用されていません。</p>}
      {model && <p className="mt-2 text-xs text-slate-600">研究用の学習成果物です。過去の予想時点の証跡と10分前価格の運用成績が未検証のため、収益性が確認されたモデルとは表示しません。</p>}
      <div className="mt-3 flex gap-4"><label className="flex cursor-pointer items-center gap-1 font-semibold text-[#2B6CB0]"><Upload aria-hidden="true" size={16} />モデルJSONを読込<input type="file" accept=".json,application/json" className="sr-only" onChange={async event => {
        const file = event.target.files?.[0]
        if (!file) return
        try { if (file.size > 1000000) throw new Error('1MB以下のモデルを指定してください。'); setModel(saveModel(userId, JSON.parse(await file.text()))); setError('') } catch (err) { setError(err.message) }
        event.target.value = ''
      }} /></label>
      {model && <button type="button" className="text-slate-600" onClick={() => { try { localStorage.removeItem(`race-market-model:v1:${userId}`); setModel(null) } catch { setError('設定を保存できませんでした。') } }}>初期モデルに戻す</button>}</div>
      {error && <p role="alert" className="mt-3 text-red-700">{error}</p>}
    </details>
  </div>
}
