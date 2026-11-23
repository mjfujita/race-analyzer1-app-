import { useMemo, useState } from 'react'
import { Save } from 'lucide-react'
import { ANCHOR_METHOD, SINGLE_ANCHOR_METHOD, assessAnchors, assessAnchorCandidates } from './anchorAssessment.js'
import { formatRaceTime } from './raceTime.js'
import { oddsMomentum } from './oddsMomentum.js'

const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const price = value => Number.isFinite(value) ? `${value.toFixed(2)}倍` : '未取得'
const comparisonPrice = value => Number.isFinite(value)
  ? `${value.toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 })}倍` : '未取得'
const signed = value => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${(100 * value).toFixed(1)}%` : '比較待ち'
const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5'
const control = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm'
const decisionLabels = { hold: '判断保留', pending: '候補から軸を1頭選んでください', selected: '軸馬を1頭選択済み', skip: 'このレースは見送り' }

function comparisonRows(summary) {
  const candidates = summary.suggested.map(no => summary.rows.find(horse => horse.no === no))
  const ranked = [...summary.rows].sort((a, b) => b.probability - a.probability || a.no - b.no)
  return [...new Map([...candidates, ...ranked].map(horse => [horse.no, horse])).values()]
    .sort((a, b) => Number(summary.suggested.includes(b.no)) - Number(summary.suggested.includes(a.no))
      || b.probability - a.probability || a.no - b.no).slice(0, 3)
}

function AnchorComparisonTable({ rows, suggested, selected, skip, onSelect, label }) {
  return <div className="min-w-0 space-y-2">
    <div className="rca-desktop-comparison max-w-full overflow-x-auto rounded-xl border border-slate-200" role="region" aria-label={`${label}の横スクロール`} tabIndex={0}>
      <table className="w-full min-w-[640px] whitespace-nowrap text-left text-sm tabular-nums" aria-label={label}>
        <thead className="border-b border-slate-200 bg-slate-50 text-xs text-slate-600"><tr>
          {['馬番・馬名', '推定勝率', '推定3着内率', '単勝オッズ', '単勝期待回収率'].map((title, index) =>
            <th key={title} scope="col" className={`px-3 py-3 ${index === 0 ? 'sticky left-0 z-20 bg-slate-50' : ''}`}>{title}</th>)}
        </tr></thead>
        <tbody>{rows.length ? rows.map(horse => {
          const candidate = suggested.includes(horse.no)
          const chosen = selected === horse.no && !skip
          const Name = candidate && onSelect ? 'label' : 'div'
          return <tr key={horse.no} className={`border-b border-slate-100 last:border-b-0 ${chosen ? 'bg-sky-100' : candidate ? 'bg-sky-50' : 'bg-white'}`}>
            <th scope="row" className="sticky left-0 z-10 bg-inherit px-3 py-3 font-semibold text-[#0B2545]">
              <Name className="flex items-center gap-2">
                {candidate && onSelect && <input type="radio" name="single-anchor" checked={chosen}
                  aria-label={`${horse.no}番 ${horse.name} を軸にする`} onChange={() => onSelect(horse.no)} />}
                <span>{horse.no} {horse.name}</span>
              </Name>
              <span className={`mt-1 block text-xs font-normal ${candidate ? 'text-sky-800' : 'text-slate-500'}`}>
                {candidate ? onSelect ? `${horse.valueTypes.join('・')}に妙味候補` : '保存時の軸候補' : '比較馬'}
              </span>
            </th>
            <td data-label="推定勝率" className="px-3 py-3">{percent(horse.probability)}</td>
            <td data-label="推定3着内率" className="px-3 py-3">{percent(horse.top3Probability)}</td>
            <td data-label="単勝オッズ" className="px-3 py-3">{comparisonPrice(horse.odds)}</td>
            <td data-label="単勝期待回収率" className="px-3 py-3 font-semibold">{percent(horse.expectedReturn)}</td>
          </tr>
        }) : <tr><td colSpan={5} className="px-3 py-4 text-slate-500">全頭の勝率とオッズが揃うと比較を表示します。</td></tr>}</tbody>
      </table>
    </div>

  </div>
}

function HorseMetrics({ horse, trend }) {
  return <div className="space-y-2">
    <dl className="grid grid-cols-2 gap-2 text-sm tabular-nums">
      {[['推定勝率', percent(horse.probability)], ['推定3着内率', percent(horse.top3Probability)],
        ['単勝オッズ', price(horse.odds)], ['単勝期待回収率', percent(horse.expectedReturn)],
        ['複勝オッズ下限', price(horse.placeOdds)], ['複勝期待回収率・下限', percent(horse.placeReturn)],
        ['単勝・下落想定後', percent(horse.stressReturn)], ['複勝・下落想定後', percent(horse.placeStressReturn)]].map(([title, value]) =>
        <div key={title}><dt className="text-xs text-slate-600">{title}</dt><dd className="font-semibold text-[#0B2545]">{value}</dd></div>)}
    </dl>
    {horse.placeOdds != null && horse.placePositions === 2 && <p className="text-xs text-slate-600">複勝は2着以内の確率 {percent(horse.placeProbability)} で計算</p>}
    <p className="text-xs text-slate-600">単勝の損益分岐 {price(horse.breakEvenOdds)}</p>
    {trend ? <div className="text-xs text-slate-600">
      <p className={trend.rising ? 'font-semibold text-sky-800' : ''}>{trend.rising ? '注目・人気上昇傾向' : 'オッズの推移'} · 単勝変化 {signed(trend.priceChange)}</p>
      <p>人気 {trend.previousRank}位 → {trend.currentRank}位 ／ 市場支持率の変化 {signed(trend.shareChange)}</p>
    </div> : <p className="text-xs text-slate-600">人気の推移は比較待ち</p>}
  </div>
}

export function FrozenAnchorAssessment({ forecast }) {
  const selection = forecast?.parameters.anchorSelection
  if (!selection) return null
  if (selection.method === ANCHOR_METHOD) {
    const legacy = assessAnchors({ field: forecast.field, odds: forecast.inputs.winOdds,
      oddsFactor: forecast.parameters.oddsFactor, selected: selection.selected })
    return <div aria-label="保存した旧2頭候補" className="space-y-2 text-sm">
      <p className="font-semibold">保存した2頭 {legacy.anchors.map(horse => `${horse.no}番 ${horse.name ?? ''}`).join(' ／ ')}</p>
      <p>どちらかが勝つ確率 {percent(legacy.combinedWinProbability)} ／ 単勝同額の期待回収率 {percent(legacy.equalWinReturn)}</p>
    </div>
  }
  const summary = assessAnchorCandidates({ field: forecast.field, odds: forecast.inputs.winOdds,
    placeQuotes: forecast.inputs.quotes, oddsFactor: forecast.parameters.oddsFactor, minTop3: selection.minTop3,
    releaseFieldSize: forecast.inputs.releaseFieldSize ?? forecast.field.length, placePositions: forecast.inputs.placePositions ?? undefined,
    selected: selection.selected, skip: selection.decision === 'skip' })
  const reference = forecast.inputs.anchorTrendReference
  const trend = reference ? oddsMomentum({ race: { id: reference.raceId, raceDate: reference.raceDate }, field: forecast.field,
    current: { ...forecast.inputs, kind: 'observed', raceId: reference.raceId, raceDate: reference.raceDate, odds: forecast.inputs.winOdds },
    events: [reference], cutoffAt: forecast.cutoffAt }) : null
  return <div aria-label="保存時の軸馬と判断" className="space-y-2 text-sm">
    <p className="font-semibold">{summary.anchor ? `固定した軸馬 ${summary.anchor.no}番 ${summary.anchor.name ?? ''}` : decisionLabels[selection.decision]}</p>
    <p>AI候補 {selection.suggested.map(no => `${no}番`).join('・') || '該当なし'} ／ 3着内率の下限 {percent(selection.minTop3)}</p>
    <AnchorComparisonTable rows={comparisonRows(summary)} suggested={selection.suggested} selected={selection.selected}
      skip={selection.decision === 'skip'} label="保存時の予想比較" />
    {summary.anchor && <details><summary className="cursor-pointer font-semibold text-sky-800">保存した軸馬の複勝・下落想定・人気の詳細</summary>
      <div className="mt-3"><HorseMetrics horse={summary.anchor} trend={trend?.rows.get(summary.anchor.no)} /></div>
    </details>}
    <p className="text-xs text-slate-600">保存時の勝率・取得オッズ・下落想定で計算</p>
  </div>
}

export default function AnchorAssessmentPanel({ field, odds, placeQuotes, releaseFieldSize, placePositions,
  momentum, stress, onStressChange, initialSelection, defaultThreshold = 50, canSave, saving, actualLive, onSave, onOpenAbility, onOpenPace,grouping }) {
  const saved = initialSelection?.method === SINGLE_ANCHOR_METHOD ? initialSelection : null
  const [selected, setSelected] = useState(saved?.selected ?? null)
  const [skip, setSkip] = useState(saved?.decision === 'skip')
  const [threshold, setThreshold] = useState(String(saved ? saved.minTop3 * 100 : defaultThreshold))
  const [note, setNote] = useState('')
  const oddsFactor = stress === '' ? NaN : 1 - Number(stress) / 100
  const minTop3 = threshold === '' ? NaN : Number(threshold) / 100
  const summary = useMemo(() => assessAnchorCandidates({ field, odds, placeQuotes, releaseFieldSize, placePositions,
    oddsFactor, minTop3, selected, skip }), [field, odds, placeQuotes, releaseFieldSize, placePositions, oddsFactor, minTop3, selected, skip])
  const candidates = summary.rows.filter(horse => summary.suggested.includes(horse.no))
  const ready = summary.complete && ['selected', 'skip'].includes(summary.decision) && canSave
  const saveLabel = summary.decision === 'skip' ? '見送りを固定保存' : '軸馬1頭と判断を固定保存'
  return <section className={`${panel} space-y-4`} aria-labelledby="anchor-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="anchor-title" className="text-lg font-bold text-[#0B2545]">妙味のある候補から軸を1頭選ぶ</h2>
      <div className="flex flex-wrap gap-4 text-sm font-semibold text-sky-800">
        <button type="button" onClick={onOpenAbility}>能力・適性を見る</button>
        <button type="button" onClick={onOpenPace}>展開・馬場を見る</button>
      </div>
    </div>
    <p className="text-sm text-slate-600">条件を満たす候補を最大2頭表示します。軸にする1頭を選ぶか、見送ります。</p>
    {summary.rows.some(horse => horse.placeOdds == null) && <p className="text-xs text-slate-600">複勝オッズが未取得の馬は、取得済みの単勝オッズだけで妙味を判定します。</p>}
    <details><summary className="cursor-pointer text-sm font-semibold text-sky-800">判断条件を確認・変更</summary><p className="mt-2 text-xs text-slate-600">3着内率の下限と、下落想定後の単勝または複勝期待回収率100%超の条件で判定します。</p><div className="mt-3 grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">3着内率の下限（%）
        <input className={control} type="number" min="0" max="100" value={threshold} onChange={event => setThreshold(event.target.value)} />
      </label>
      <label className="space-y-1 text-sm">オッズ下落の想定（%）
        <input className={control} type="number" min="0" max="80" value={stress} onChange={event => onStressChange(event.target.value)} />
      </label>
    </div></details>
    <p role="status" className="rounded-xl bg-slate-50 p-3 font-bold text-[#0B2545]">{decisionLabels[summary.decision]} <span className="text-xs font-normal text-slate-600">モデル試算</span></p>
    {summary.decision === 'skip' && !summary.suggested.length && <p className="text-sm text-slate-600">3着内率と期待回収率の両方を満たす候補がありません。</p>}
    {summary.invalidSelection && <p role="alert" className="text-sm text-amber-900">取得データまたは条件が変わりました。現在の候補から軸を選び直してください。</p>}
    <div className="rca-axis-grid"><div className="min-w-0 space-y-4"><fieldset className="min-w-0 space-y-3">
      <legend className="mb-3 text-sm font-semibold">軸候補と比較馬</legend>
      <AnchorComparisonTable rows={comparisonRows(summary)} suggested={summary.suggested} selected={selected} skip={skip}
        onSelect={no => { setSelected(no); setSkip(false) }} label="軸候補の比較" />
      <p className="text-xs text-slate-600">軸候補を先頭に、勝率上位の比較馬を含む最大3頭を表示します。軸は候補の行から1頭選択できます。</p>
      {candidates.length > 0 && <label className="flex items-center gap-2 text-sm"><input type="radio" name="single-anchor" checked={skip}
        onChange={() => { setSkip(true); setSelected(null) }} />今回は見送る</label>}
    </fieldset>
    {candidates.length > 0 && <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-sky-800">候補の複勝・下落想定・人気の詳細</summary>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{candidates.map(horse => <div key={horse.no} className="space-y-3 rounded-xl border border-slate-200 p-3">
        <p className="font-bold">{horse.no}番 {horse.name}</p><HorseMetrics horse={horse} trend={momentum?.rows.get(horse.no)} />
      </div>)}</div>
    </details>}
    {summary.pair && <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-sky-800">2候補の3着内確率を比較</summary>
      <p className="mt-2">どちらかが3着以内 {percent(summary.pair.eitherTop3)} ／ 2頭とも3着以内 {percent(summary.pair.bothTop3)}</p>
    </details>}
    <p className="text-xs text-slate-500">確率・回収率はモデル試算です。3着内率は未校正の参考値です。</p><details><summary className="text-sm font-semibold text-sky-800">確率・人気の推移の読み方</summary><p className="mt-2 text-xs text-slate-600">3着内率は全頭の勝率から着順モデルで計算した未校正の参考値です。複勝は発売時の頭数に応じた的中範囲と取得オッズ下限で試算し、払戻の変動を含む実績で検証します。券種・相手・配分を決める際に各買い目の価格も確認してください。</p>
    {momentum?.reference ? <p className="text-xs text-slate-600">人気の推移は {formatRaceTime(momentum.reference.observedAt)} から選択した観測時刻までの比較です。オッズ低下と市場支持率の上昇を「人気上昇傾向」と表示します。</p>
      : <p className="text-xs text-slate-600">時刻を確認できる同じレースのオッズが2時点揃うと、変化率と人気順位の推移を表示します。</p>}
    </details>
    {summary.issues.map(issue => <p key={issue} className="text-sm text-amber-900">{issue}</p>)}
    <details className="text-sm">
      <summary className="cursor-pointer font-semibold text-sky-800">全頭の妙味と人気の推移</summary>
      <p className="text-xs text-slate-600 mt-2">{grouping?.complete?`グループは表示中の単勝オッズで分類（${grouping.manual?'グループ画面の手動区切り':`自動・倍率${grouping.threshold}`}）。能力の順位ではありません。`:'全頭の単勝オッズが揃っていないため、グループは判定保留です。'}{grouping?.differentObservation?'別の観測時点の手動区切りは適用していません。':''}{grouping?.reset&&grouping.complete?'区切りを適用できないため自動分類を表示しています。':''}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full whitespace-nowrap text-left text-sm" aria-label="全頭の軸候補比較">
          <thead className="border-b border-slate-200 text-xs text-slate-600"><tr>
            {['グループ・馬番・馬名', '推定勝率', '推定3着内率', '単勝オッズ', '単勝期待回収率', '複勝期待回収率・下限', '単勝変化率', '人気順位', '判断'].map(title => <th key={title} scope="col" className="p-2">{title}</th>)}
          </tr></thead>
          <tbody>{summary.rows.map(horse => {
            const trend = momentum?.rows.get(horse.no)
            return <tr key={horse.no} className={summary.suggested.includes(horse.no) ? 'bg-sky-50' : 'border-b border-slate-100'}>
              <th scope="row" className="p-2"><span className="rca-pill mr-2" aria-label={`グループ ${grouping?.complete?grouping.membership[horse.no]??'判定保留':'判定保留'}`}>{grouping?.complete?grouping.membership[horse.no]??'—':'—'}</span>{horse.no}番 {horse.name}</th>
              <td className="p-2">{percent(horse.probability)}</td><td className="p-2">{percent(horse.top3Probability)}</td>
              <td className="p-2">{comparisonPrice(horse.odds)}</td>
              <td className="p-2">{percent(horse.expectedReturn)}</td><td className="p-2">{percent(horse.placeReturn)}</td>
              <td className="p-2">{signed(trend?.priceChange)}</td><td className="p-2">{trend ? `${trend.previousRank}位 → ${trend.currentRank}位` : '比較待ち'}</td>
              <td className="p-2">{horse.qualifies ? '条件内' : '条件外'}{trend?.rising ? '・人気上昇に注目' : ''}</td>
            </tr>
          })}</tbody>
        </table>
      </div>
    </details>
    </div><aside className="rca-stack"><div className="rca-axis-summary"><h3>選択した軸馬</h3><h4>{summary.anchor ? `${summary.anchor.no} ${summary.anchor.name}` : summary.decision === 'skip' ? '今回は見送り' : summary.decision === 'hold' ? 'データの確認が必要' : '候補から1頭を選択'}</h4>
      {summary.anchor && <dl className="rca-details">{[['推定3着内率',percent(summary.anchor.top3Probability)],['単勝・下落想定後',percent(summary.anchor.stressReturn)],['損益分岐の単勝オッズ',price(summary.anchor.breakEvenOdds)]].map(([name,value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl>}
      <button type="button" className="rca-primary disabled:opacity-40" disabled={!ready || saving} onClick={() => onSave({ method: SINGLE_ANCHOR_METHOD, suggested: summary.suggested,
        selected: summary.anchor?.no ?? null, decision: summary.decision, minTop3, note })}>
        <Save aria-hidden="true" className="h-4 w-4" />{saving ? '保存中…' : `${saveLabel}${actualLive ? '' : '（過去検証）'}`}
      </button><small>保存しても馬券購入にはなりません</small></div>
      <div className="rca-panel"><h2>判断メモ</h2><label className="block text-sm">軸馬を選んだ理由・判断メモ<textarea className={`${control} mt-2`} rows="3" value={note} maxLength="4000" onChange={event => setNote(event.target.value)} /></label><p className="rca-muted mt-3">買い方・相手・金額は自分で決めます。</p></div>
    </aside></div>
  </section>
}
