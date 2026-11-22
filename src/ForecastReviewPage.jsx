import { useState } from 'react'
import { formatRaceTime } from './raceTime.js'

const panel = 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6'
const resultStatus = { matched: '照合済み', 'awaiting-results': '着順待ち', 'awaiting-payout': '払戻待ち',
  'incomplete-or-abnormal': '着順不足・異常着順', 'result-conflict': '結果に相違' }
const modelStatus = { active: '採用中', rejected: '見送り', 'paused-degradation': '劣化を検知し停止', 'paused-correction': '結果の訂正を検知し停止' }
const percent = value => Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—'
const score = value => Number.isFinite(value) ? value.toFixed(4) : '—'
const dateText = day => String(day ?? '').replace(/^(\d{4})(\d{2})(\d{2})$/, '$1/$2/$3')

function ScoreTable({ comparison, caption }) {
  if (!comparison?.before) return null
  const rows = [['校正前', comparison.before], ['校正後', comparison.after], ...(comparison.incumbent ? [['従来採用版', comparison.incumbent]] : [])]
  return <div className="overflow-x-auto"><table className="w-full min-w-[340px] text-left text-sm tabular-nums">
    <caption className="py-2 text-left font-semibold">{caption} · {comparison.before.races}レース</caption>
    <thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th scope="col" className="py-2">比較</th><th scope="col">Log loss</th><th scope="col">Brier</th></tr></thead>
    <tbody>{rows.map(([name, value]) => <tr key={name} className="border-b border-slate-100"><th scope="row" className="py-2 font-medium">{name}</th><td>{score(value?.logLoss)}</td><td>{score(value?.brier)}</td></tr>)}</tbody>
  </table></div>
}

export default function ForecastReviewPage({ review, loading, error, onRefresh, initialForecastId = '', view = 'all' }) {
  const [selected, setSelected] = useState(initialForecastId)
  const [versionId, setVersionId] = useState('')
  const race = selected ? review?.races.find(row => row.forecastId === selected) : review?.races[0]
  const version = review?.versions.find(item => item.id === versionId) ?? review?.versions[0]
  const bins = version?.evaluation?.after?.bins ?? []
  return <div className="space-y-4">
    {view !== 'learning' && <section className={panel} aria-labelledby="review-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="review-title" className="text-xl font-bold text-[#0B2545]">予想の振り返り</h1>
        {onRefresh && <button type="button" className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50" onClick={onRefresh} disabled={loading}>{loading ? '同期中…' : '振り返りを同期'}</button>}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}
      {!review && <p className="mt-3 text-sm text-slate-600">{loading ? '振り返りを読み込んでいます。' : '取得ワーカーからの集計を待っています。'}</p>}
      {review && <>
        <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[['固定予想', `${review.totalForecasts}レース`], ['学習・評価対象', `${review.eligibleRaces}レース`],
            ['実際に保存した予想の1位的中率', percent(review.actual?.topPickRate)], ['集計時刻', formatRaceTime(review.generatedAt)]].map(([name, value]) =>
            <div key={name} className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-600">{name}</dt><dd className="mt-1 font-semibold text-[#0B2545]">{value}</dd></div>)}
        </dl>
        {!race && <p className="mt-4 text-sm text-slate-600">{selected ? '選んだ予想の振り返りを確認中です。' : '軸候補で判断を固定保存すると、ここで着順と照合できます。'}</p>}
        {!race && selected && review.races.length > 0 && <button type="button" className="mt-2 text-sm font-semibold text-sky-800 underline" onClick={() => setSelected('')}>取り込み済みの振り返りを見る</button>}
        {Object.keys(review.sourceCounts ?? {}).length > 0 && <p className="mt-3 text-xs text-slate-600">取込済みの記録数 {Object.entries(review.sourceCounts).map(([name, count]) => `${name} ${count}`).join(' ／ ')}</p>}
      </>}
    </section>}
    {view !== 'learning' && race && <section className={panel} aria-labelledby="review-race">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="review-race" className="font-bold text-[#0B2545]">固定予想と着順</h2>
        <label className="flex flex-wrap items-center gap-2 text-sm">対象レース
          <select className="rounded-lg border border-slate-300 px-2 py-1" value={race.forecastId} onChange={event => setSelected(event.target.value)}>
            {review.races.map(item => <option key={item.forecastId} value={item.forecastId}>{dateText(item.raceDate)} · {item.raceId}</option>)}
          </select>
        </label>
      </div>
      <p className="my-3 text-sm text-slate-600">{resultStatus[race.state]}{race.source ? ` (${race.source === 'LIVE' ? 'JRDBレース画面' : race.source})` : ''} · {race.verified ? '締切前受領済み' : '締切前受領の証跡なし'} · 予想1位 {race.topPick}番{race.winnerNo && ` · 着順1位 ${race.winnerNo}番`}</p>
      <p className="my-3 break-all text-xs text-slate-500">予想モデル {race.modelVersion}{race.calibrationId && ` ／ 校正版 ${race.calibrationId}`}</p>
      {Object.keys(race.references ?? {}).length > 0 && <details className="mb-3 rounded-lg bg-slate-50 p-2 text-xs">
        <summary className="cursor-pointer font-medium">開催・番組・登録の参考データ</summary>
        <ul className="mt-2 space-y-1">{Object.entries(race.references).map(([kind, ref]) => <li key={kind}>
          {kind} · {ref.registeredCount != null ? `登録 ${ref.registeredCount}頭`
            : ref.declaredCount != null ? `番組 ${ref.declaredCount}頭・発走 ${ref.postTime ?? '不明'}`
            : `天候コード ${ref.weatherCode || '—'}・芝 ${ref.turfGoingCode || '—'}・ダ ${ref.dirtGoingCode || '—'}`}
        </li>)}</ul>
      </details>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
        <thead className="border-b border-slate-200 text-xs text-slate-500"><tr><th scope="col" className="py-2">馬番</th><th scope="col">保存時の勝率</th><th scope="col">JRDB着順</th></tr></thead>
        <tbody>{[...race.field].sort((a, b) => b.probability - a.probability).map(h => <tr key={h.no} className={h.rank === 1 ? 'bg-cyan-50' : 'border-b border-slate-100'}><th scope="row" className="py-2 font-medium">{h.no}番</th><td>{percent(h.probability)}</td><td>{h.rank ?? '—'}</td></tr>)}</tbody>
      </table></div>
    </section>}
    {view !== 'review' && review && <section className={panel} aria-labelledby="review-model">
      <h2 id="review-model" className="font-bold text-[#0B2545]">確率校正とモデル採用履歴</h2>
      <p className="mt-2 text-sm text-slate-600">採用中 {review.active.length}版。学習には最低40レース・10開催日、採否にはその後の最低20レース・5開催日が必要です。</p>
      {review.statesByStack.map(group => <div key={group.stack} className="my-3">
        <p className="text-sm font-medium">{modelStatus[group.status]}{group.activeId && ` · ${group.activeId}`}</p>
        <ScoreTable comparison={group.monitor} caption="採用後の監視" />
      </div>)}
      {!version && <p className="mt-3 text-sm text-slate-600">日付順の独立評価に必要なデータを収集中です。</p>}
      {version && <>
        <label className="my-3 flex flex-wrap items-center gap-2 text-sm">モデル版
          <select className="max-w-full rounded-lg border border-slate-300 px-2 py-1" value={version.id} onChange={event => setVersionId(event.target.value)}>
            {review.versions.map(item => <option key={item.id} value={item.id}>{item.id} · {item.decision === 'adopted' ? '採用履歴あり' : '見送り'}</option>)}
          </select>
        </label>
        <p className="mb-2 text-xs text-slate-600">学習終了 {dateText(version.trainedThrough)} · 独立評価終了 {dateText(version.testedThrough)} · 温度 {version.temperature}</p>
        <ScoreTable comparison={version.evaluation} caption="採否に使った独立評価" />
        <ScoreTable comparison={version.walkForward} caption="時系列バックテスト" />
        {bins.length > 0 && <div className="mt-5 overflow-x-auto"><table className="w-full min-w-[325px] text-left text-xs tabular-nums">
          <caption className="py-2 text-left text-sm font-semibold">独立評価の確率帯別の校正</caption>
          <thead className="border-b border-slate-200"><tr><th scope="col" className="py-2">確率帯</th><th scope="col">馬の件数</th><th scope="col">平均予測</th><th scope="col">実際の勝率</th></tr></thead>
          <tbody>{bins.map(bin => <tr className="border-b border-slate-100" key={bin.lower}><th scope="row" className="py-2 font-medium">{Math.round(100 * bin.lower)}–{Math.round(100 * (bin.lower + .1))}%</th><td>{bin.count}</td><td>{percent(bin.predicted)}</td><td>{percent(bin.actual)}</td></tr>)}</tbody>
        </table></div>}
      </>}
    </section>}
  </div>
}
