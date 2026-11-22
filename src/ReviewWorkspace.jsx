import { useEffect, useState } from 'react'
import ForecastReviewPage from './ForecastReviewPage.jsx'
import { fetchCloudRace, readCloudRace } from './cloudStore.js'
import { workspaceLedgers, workspaceReview } from './workspaceReview.js'
import { assessAnchorCandidates } from './anchorAssessment.js'
import { formatRaceTime } from './raceTime.js'
import GroupReviewSection from './GroupReviewSection.jsx'

const percent = value => Number.isFinite(value) ? `${(value*100).toFixed(1)}%` : '—'
export default function ReviewWorkspace({ userId, review, loading, error, onRefresh, initialForecastId, onOpenRecords, onOpenGroupRecords }) {
  const [local] = useState(() => workspaceLedgers(userId))
  const [receipts, setReceipts] = useState({})
  const [groupReceipts,setGroupReceipts] = useState({})
  const [groupCloud,setGroupCloud] = useState({})
  const [receiptError, setReceiptError] = useState('')
  const [pending, setPending] = useState(true)
  const [openError, setOpenError] = useState('')
  const [opening, setOpening] = useState(false)
  const [filter, setFilter] = useState('すべて')
  useEffect(() => {
    let cancelled = false, cursor = 0
    // Bound private read-only requests; never restart a collector or upload records here.
    const targets = local.ledgers.slice(0,48)
    const worker = async () => {
      while (cursor < targets.length && !cancelled) {
        const ledger = targets[cursor++]
        try {
          const data = await fetchCloudRace({ id: ledger.scope.raceId, raceDate: ledger.scope.raceDate })
          if (!cancelled) {
            setReceipts(previous => ({ ...previous, ...data.receipts })); setGroupReceipts(previous => ({ ...previous,...data.groupReceipts }))
            setGroupCloud(previous => ({ ...previous,[`${ledger.scope.raceDate}:${ledger.scope.raceId}`]:data }))
          }
        } catch { if (!cancelled) setReceiptError('一部の締切前受領を確認できません。未確認の軸は的中率の集計から除外しています。') }
      }
    }
    Promise.all(Array.from({ length: Math.min(4,targets.length) },worker)).finally(() => { if (!cancelled) setPending(false) })
    return () => { cancelled = true }
  }, [local, userId])
  const summary = workspaceReview(local.ledgers, review, receipts)
  const rows = summary.rows.filter(row => row.ledger.forecasts.length > 0 && (filter === 'すべて' || (filter === '選択した軸' ? row.selection?.decision === 'selected' : row.selection?.decision === 'skip')))
  return <div className="rca-stack"><div className="rca-page-title"><div><h1>予想の振り返り</h1><p>保存した判断と結果を比較し、実購入の収支を分けて評価します。</p></div>{onRefresh && <button className="rca-secondary" type="button" disabled={loading} onClick={onRefresh}>{loading ? '同期中…' : '振り返りを同期'}</button>}</div>
    {openError && <p role="alert" className="rca-error">{openError}</p>}{local.errors.map((text,i) => <p key={i} role="alert" className="rca-error">{text}</p>)}{receiptError && <p role="alert" className="rca-error">{receiptError}</p>}
    <dl className="rca-stat-grid">{[['このブラウザの保存レース',summary.rows.length,'旧方式の記録も保持'],['選んだ軸の3着内率',percent(summary.top3Rate),`${summary.hits} / ${summary.resolved}レース · 締切前受領を確認済み`],['実購入の回収率',percent(summary.returnRate),'このブラウザの精算済み購入だけで計算'],['受領の確認',pending ? '確認中' : '確認終了','直近48保存レースの受領を照合']].map(([name,value,detail]) => <div key={name}><dt>{name}</dt><dd>{value}</dd><p className="rca-muted">{detail}</p></div>)}</dl>
    <section className="rca-panel"><h2>レースごとの軸と購入記録</h2><div className="rca-filterbar">{['すべて','選択した軸','見送り'].map(name => <button key={name} type="button" aria-pressed={filter === name} onClick={() => setFilter(name)}>{name}</button>)}</div><div className="overflow-x-auto"><table className="rca-list-table whitespace-nowrap" aria-label="保存した軸と結果"><thead><tr>{['レース','保存した判断','推定3着内率','確定着順','購入・精算','操作'].map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.map(row => {
      const { ledger, forecast, horse, selection } = row
      const metadata = readCloudRace(userId,{ id:ledger.scope.raceId,raceDate:ledger.scope.raceDate })?.race
      const place = metadata?.place ?? ({ '01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉' })[metadata?.placeCode]
      const name = place && metadata?.raceNo ? `${place}${metadata.raceNo}R` : ledger.scope.raceId
      const date = ledger.scope.raceDate.replace(/^(\d{4})(\d{2})(\d{2})$/,'$1/$2/$3')
      const estimated = horse ? assessAnchorCandidates({ field: forecast.field, odds: forecast.inputs.winOdds, oddsFactor: forecast.parameters.oddsFactor, minTop3: selection.minTop3 }).rows.find(h => h.no === horse.no)?.top3Probability : null
      return <tr key={`${ledger.scope.raceDate}:${ledger.scope.raceId}`}><th scope="row">{name}<span className="block text-xs">{date}</span></th><td>{horse ? `${horse.no} ${horse.name ?? ''}` : selection?.decision === 'skip' ? '見送り' : '保存済み予想を確認'}<span className="block text-xs text-slate-500">{forecast ? `${formatRaceTime(forecast.createdAt)} · ${row.verified ? '締切前受領済み' : '参考・受領未確認'}` : '旧方式の記録'}</span></td><td>{percent(estimated)}</td><td>{row.rank ? `${row.rank}着` : selection?.decision === 'skip' ? '—' : '結果待ち・未照合'}</td><td>{row.totals.purchaseCount ? `${row.totals.purchaseCount}件・未精算${row.totals.pendingCount}件` : '購入未記録'}</td><td><button type="button" disabled={opening} onClick={async () => { setOpening(true); setOpenError(''); try { await onOpenRecords(ledger.scope,forecast?.id) } catch (problem) { setOpenError(problem.message) } finally { setOpening(false) } }}>記録・購入・精算 →</button></td></tr>
    })}</tbody></table></div>{!rows.length && <p className="rca-notice">表示するブラウザ記録はありません。同期済みの予想と着順は下で確認できます。</p>}<p className="rca-muted mt-4">各レースの締切前の最終判断を集計します。過去検証・受領未確認・異常着順は、軸の的中率へ含めません。購入未記録の予想は収支に計上しません。</p></section>
    <GroupReviewSection ledgers={local.ledgers} review={review} groupReceipts={groupReceipts} cloudRaces={groupCloud} onOpen={onOpenGroupRecords} />
    <details className="rca-panel" open={Boolean(initialForecastId)}><summary>同期済みの固定予想と着順</summary><ForecastReviewPage key={initialForecastId} view="review" review={review} loading={loading} error={error} initialForecastId={initialForecastId} /></details>
    {error && <p role="alert" className="rca-error">{error}</p>}
  </div>
}
