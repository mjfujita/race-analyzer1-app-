import { useState } from 'react'
import { Save } from 'lucide-react'
import { assessAnchors } from './anchorAssessment.js'

const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const oddsLabel = value => Number.isFinite(value) ? `${value.toFixed(2)}倍` : '—'
const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const control = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const valueLabels = ['100%超の軸候補なし', '1頭に妙味候補あり', '2頭とも妙味候補']

export function FrozenAnchorAssessment({ forecast }) {
  const selection = forecast?.parameters.anchorSelection
  if (!selection) return null
  const summary = assessAnchors({ field: forecast.field, odds: forecast.inputs.winOdds,
    oddsFactor: forecast.parameters.oddsFactor, selected: selection.selected })
  return <div aria-label="保存時の2頭軸" className="space-y-2 text-sm">
    <p className="font-semibold">固定した軸馬 {summary.anchors.map(horse => `${horse.no}番 ${horse.name ?? ''}`).join(' ／ ')}</p>
    <p>どちらかが勝つ確率 {percent(summary.combinedWinProbability)} ／ 単勝同額の期待回収率 {percent(summary.equalWinReturn)}</p>
    <p className="text-xs text-slate-600">下落想定後 {percent(summary.equalStressReturn)} · 保存時の勝率・取得オッズで計算</p>
  </div>
}

export default function AnchorAssessmentPanel({ field, odds, stress, onStressChange, initialSelection,
  canSave, saving, actualLive, onSave, onOpenAbility, onOpenPace }) {
  const [selection, setSelection] = useState(initialSelection ?? null)
  const [note, setNote] = useState('')
  const oddsFactor = stress === '' ? NaN : 1 - Number(stress) / 100
  const summary = assessAnchors({ field, odds, oddsFactor, selected: selection })
  const selected = selection ?? summary.suggested
  const label = summary.valueCount == null ? '判断保留' : valueLabels[summary.valueCount]
  return <section className={`${panel} space-y-4`} aria-labelledby="two-anchor-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="two-anchor-title" className="text-lg font-bold text-[#0B2545]">軸馬2頭とレースの妙味</h2>
      <div className="flex flex-wrap gap-4 text-sm font-semibold text-sky-800">
        <button type="button" onClick={onOpenAbility}>能力・適性を見る</button>
        <button type="button" onClick={onOpenPace}>展開・馬場を見る</button>
      </div>
    </div>
    <p className="text-sm text-slate-600">AIは下落想定後の単勝期待回収率が100%を超える馬を勝率順に選びます。2頭未満なら、残りを勝率上位から補います。</p>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-sm">オッズ下落の想定（%）
        <input className={`${control} block max-w-32`} type="number" min="0" max="80" step="1" value={stress} onChange={event => onStressChange(event.target.value)} />
      </label>
      {summary.suggested.length === 2 && <p className="text-sm text-slate-600">AI候補 {summary.suggested.map(no => `${no}番`).join('・')}</p>}
      {selection != null && <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm" onClick={() => setSelection(null)}>AI候補に戻す</button>}
    </div>
    {summary.rows.length > 0 && <div className="grid gap-3 sm:grid-cols-2">
      {[0, 1].map(index => {
        const horse = summary.rows.find(row => row.no === selected[index])
        return <div key={index} className="min-w-0 space-y-2 rounded-xl border border-slate-200 p-3">
          <label className="block text-sm font-semibold">軸馬{index + 1}
            <select aria-label={`軸馬${index + 1}`} className={`${control} mt-1`} value={selected[index] ?? ''} onChange={event => {
              const changed = [...selected]
              changed[index] = Number(event.target.value)
              setSelection(changed)
            }}>
              <option value="">選択してください</option>
              {summary.rows.map(row => <option key={row.no} value={row.no} disabled={row.no === selected[1 - index]}>{row.no}番 {row.name}</option>)}
            </select>
          </label>
          <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
            {[['推定勝率', percent(horse?.probability)], ['単勝オッズ', oddsLabel(horse?.odds)],
              ['単勝期待回収率', percent(horse?.expectedReturn)], ['下落想定後', percent(horse?.stressReturn)]].map(([title, value]) =>
              <div key={title}><dt className="text-xs text-slate-600">{title}</dt><dd className="font-semibold text-[#0B2545]">{value}</dd></div>)}
          </dl>
          <p className="text-xs text-slate-600">損益分岐オッズ {oddsLabel(horse?.breakEvenOdds)}</p>
        </div>
      })}
    </div>}
    <div className="rounded-xl bg-slate-50 p-4">
      <p className="font-bold text-[#0B2545]">{label} <span className="text-xs font-normal text-slate-600">単勝基準・試算</span></p>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        {[['どちらかが勝つ確率', summary.combinedWinProbability], ['単勝同額の期待回収率', summary.equalWinReturn],
          ['下落想定後の期待回収率', summary.equalStressReturn]].map(([title, value]) =>
            <div key={title}><dt className="text-xs text-slate-600">{title}</dt><dd className="mt-1 text-xl font-bold tabular-nums text-[#0B2545]">{percent(value)}</dd></div>)}
      </dl>
      <p className="mt-2 text-xs text-slate-600">2頭の単勝を同額ずつ買った場合の参考値です。勝つ確率は2頭の推定勝率の合計、期待回収率は2頭の「勝率×単勝オッズ」の平均です。購入する券種・配分によって回収率は変わります。</p>
    </div>
    <p className="text-xs text-slate-600">勝率と期待回収率はモデルの試算です。実際の的中率・回収実績は保存した予想と結果で検証します。</p>
    {summary.issues.map(issue => <p key={issue} role="status" className="text-sm text-amber-900">{issue}</p>)}
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-sky-800">全出走馬の勝率と期待回収率</summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm" aria-label="全頭の軸候補比較">
          <thead className="border-b border-slate-200 text-xs text-slate-600"><tr>
            {['馬番・馬名', '推定勝率', '単勝オッズ', '単勝期待回収率', '下落想定後'].map(title => <th key={title} scope="col" className="p-2">{title}</th>)}
          </tr></thead>
          <tbody>{summary.rows.map(horse => <tr key={horse.no} className={selected.includes(horse.no) ? 'bg-sky-50' : 'border-b border-slate-100'}>
            <th scope="row" className="p-2">{horse.no}番 {horse.name}</th>
            <td className="p-2">{percent(horse.probability)}</td><td className="p-2">{oddsLabel(horse.odds)}</td>
            <td className="p-2">{percent(horse.expectedReturn)}</td><td className="p-2">{percent(horse.stressReturn)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
    <label className="block text-sm">軸馬を選んだ理由・判断メモ
      <textarea className={`${control} mt-1`} rows="2" value={note} maxLength="4000" onChange={event => setNote(event.target.value)} />
    </label>
    <button type="button" className="inline-flex items-center gap-2 rounded-lg bg-[#0B2545] px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
      disabled={!summary.complete || !canSave || saving} onClick={() => onSave({ suggested: summary.suggested, selected, note })}>
      <Save aria-hidden="true" className="h-4 w-4" />{saving ? '保存中…' : actualLive ? '2頭の軸馬と判断を固定保存' : '2頭の軸馬を過去検証として保存'}
    </button>
  </section>
}
