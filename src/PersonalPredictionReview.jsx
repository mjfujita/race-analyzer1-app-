import { personalPlanReview } from './personalGroupPrediction.js'
import { groupReceiptVerified } from './groupAnalysis.js'
import { formatRaceTime } from './raceTime.js'

export default function PersonalPredictionReview({plan,outcome,receipt,ownerId,loading=false}) {
  const review=personalPlanReview(plan,outcome)
  const method=/^私の予想｜[^｜]+｜([^｜\n]+)/.exec(plan.note??'')?.[1]
  const verified=groupReceiptVerified(plan,receipt,{userId:ownerId,raceId:plan.race.id,raceDate:plan.race.raceDate})
  return <section className="rca-personal-review" aria-label="予想した組み立てと結果">
    <p className="rca-muted">{review.type}{method&&` · ${method}`} · {plan.decision==='skip'?'見送り':`${plan.allocations.length}点・投入予定 ${plan.invested.toLocaleString('ja-JP')}円`} · {plan.mode==='replay'?'過去検証':verified?'締切前の受領確認済み':'締切前記録・受領未確認'}</p>
    <div className="rca-personal-patterns">
      <div><h3>予想の組み立て{review.unordered?'（着順不問）':''}</h3><p aria-label="保存した予想パターン">{review.pattern}</p></div>
      <div><h3>レース結果</h3><p aria-label="結果のグループパターン">{review.actualPattern??(review.state==='held'?'照合保留':'結果待ち')}</p></div>
    </div>
    <p className="rca-muted">予想時の分類で照合 · 保存 {formatRaceTime(plan.createdAt)} ／ オッズ観測 {formatRaceTime(plan.snapshot.observedAt)}</p>
    {loading&&<p role="status" className="rca-muted">結果の最新情報を確認中です。</p>}
    {review.unordered&&<p className="rca-muted">3連複は着順を問わず、保存した馬番の組み合わせで照合します。</p>}
    <div className="rca-personal-position-list">{review.positions.map(p=><article key={p.position} aria-label={`${p.position}${review.unordered?'頭目の候補':'着の予想と結果'}`}>
      <h3>{p.position}{review.unordered?'頭目':'着'}</h3>
      <div><span className="rca-muted">予想</span><strong>{p.labels.length?`${p.labels.join('・')}群`:'未選択'}</strong><p>馬番 {p.horses.map(h=>h.no).join('・')||'候補なし'}</p></div>
      {!review.unordered&&<div><span className="rca-muted">結果</span><strong>{p.actualNo===null?'未反映':`${p.actualGroup}群 · ${p.actualNo}番`}</strong><p>{p.actualName}</p>
        {p.actualNo!==null&&<span className={`rca-pill ${p.groupMatches&&p.candidateIncluded?'rca-personal-match':'rca-personal-miss'}`}>{!p.groupMatches?'グループ不一致':p.candidateIncluded?'一致':'除外した馬'}</span>}
      </div>}
    </article>)}</div>
    {review.unordered&&review.result&&<p>実際の上位3頭：{review.result.numbers.map(no=>`${plan.grouping.membership[no]}群 ${no}番`).join(' ／ ')}</p>}
    <p className="rca-notice" role="status">{plan.decision==='skip'?'見送りのため的中判定には含めません。':review.result?
      `予想の買い目：${review.result.hit?'的中あり':'的中なし'} ／ 候補馬：${review.result.candidatesCovered?'上位馬を含む':'不足'}${review.unordered?'':` ／ 着順指定：${review.result.formationCovered?'範囲内':'不一致'}`}`:
      review.state==='held'?'結果の照合を保留しています。同着・取消・競合などは、正式な結果と払戻の確認が必要です。':'結果の取込後に自動で照合します。'}</p>
    <details><summary>保存時のグループ・馬名を確認</summary><div className="rca-personal-frozen-groups">{plan.grouping.groups.map(g=><div key={g.label}><strong>{g.label}群 · {g.horses.length}頭</strong><p>{g.horses.map(h=>`${h.no} ${h.name}${plan.excluded.includes(h.no)?'（候補から除外）':''}`).join(' ／ ')}</p></div>)}</div></details>
    <p className="rca-muted">予想の的中と実購入の収支は別に管理します。</p>
  </section>
}
