import { useState } from 'react'
import { groupOutcome, groupReceiptVerified, groupHitInterval, reviewGroupPlan } from './groupAnalysis.js'
import { readCloudRace } from './cloudStore.js'
import { activePurchases, latestSettlement } from './forecastLedger.js'
import { GroupPlanResult } from './GroupWorkspace.jsx'

const pct = n => `${(n*100).toFixed(1)}%`
export default function GroupReviewSection({ ledgers, review, groupReceipts = {}, cloudRaces = {}, onOpen }) {
  const [opening,setOpening] = useState(false), [error,setError] = useState('')
  const rows = ledgers.flatMap(ledger => {
    const plans = ledger.groupPlans ?? []
    if (!plans.length) return []
    const cloud = cloudRaces[`${ledger.scope.raceDate}:${ledger.scope.raceId}`] ?? readCloudRace(ledger.scope.userId,{ id:ledger.scope.raceId,raceDate:ledger.scope.raceDate })
    const receipts = { ...cloud?.groupReceipts,...groupReceipts }
    const verified = plans.filter(p => groupReceiptVerified(p,receipts[p.id],ledger.scope))
      .sort((a,b) => Date.parse(receipts[b.id].receivedAt)-Date.parse(receipts[a.id].receivedAt))
    const plan = verified[0] ?? plans.at(-1)
    const outcome = groupOutcome(plan,review,cloud)
    return [{ ledger,plan,receipt:receipts[plan.id],outcome,formal:Boolean(verified.length),result:reviewGroupPlan(plan,outcome) }]
  })
  const eligible = rows.filter(r => r.formal && r.result && r.plan.decision === 'plan')
  const hits = eligible.filter(r => r.result.hit).length, interval = groupHitInterval(hits,eligible.length)
  const totals = rows.reduce((sum,{ ledger }) => {
    const ids = new Set((ledger.groupPlans ?? []).map(p => p.id))
    for (const p of activePurchases(ledger).filter(p => ids.has(p.forecastId))) {
      const settlement = latestSettlement(ledger,p.id)
      if (!settlement) continue
      sum.invested += p.tickets.reduce((s,t) => s+t.stake,0)
      const payout = p.tickets.reduce((s,t) => s+t.stake*settlement.payouts[t.key]/100,0)
      sum.payout += payout; sum.maximum = Math.max(sum.maximum,payout)
    }
    return sum
  },{ invested:0,payout:0,maximum:0 })
  return <section className="rca-panel" aria-label="グループ判断の振り返り"><h2>グループ判断の振り返り</h2>
    <p className="rca-muted">１レースにつき締切前受領を確認した最後の案を集計。後日の試算で置き換えません。過去検証と未確認記録も個別に表示します。</p>
    <dl className="rca-stat-grid">{[['集計対象',`${eligible.length}レース`],['買い目の的中',eligible.length ? `${hits}/${eligible.length}（${pct(hits/eligible.length)}）` : '未集計'],['95%区間（Wilson）',interval ? interval.map(pct).join('〜') : 'データ待ち'],['実購入の回収率',totals.invested ? pct(totals.payout/totals.invested) : '購入・精算待ち']].map(([name,value]) => <div key={name}><dt>{name}</dt><dd className="!text-xl">{value}</dd></div>)}</dl>
    <p className="rca-muted mt-3">異なる開催日での独立検証前です。同日・選択レースの区間は参考値。グループの頭数・価格帯が異なるため、AやBの勝ち数だけで優劣を決めません。{totals.payout > 0 && `最大１購入記録への払戻依存：${pct(totals.maximum/totals.payout)}。`}</p>
    {!rows.length && <p className="rca-notice">グループ判断を保存すると、候補の不足・着順の不一致・配分の影響を確認できます。</p>}
    {rows.map(({ ledger,plan,receipt,outcome }) => <article key={plan.id} className="my-4 border-t border-slate-200 pt-4"><h3>{plan.race.raceDate} · {plan.race.name || plan.race.id}</h3><GroupPlanResult plan={plan} receipt={receipt} outcome={outcome} ownerId={ledger.scope.userId} />{onOpen && <button className="rca-secondary" disabled={opening} onClick={async () => { setOpening(true); setError(''); try { await onOpen(ledger.scope) } catch (problem) { setError(problem.message) } finally { setOpening(false) } }}>グループ判断と購入記録を開く</button>}</article>)}
    {error && <p role="alert" className="rca-error">{error}</p>}
  </section>
}
