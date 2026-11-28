import {formatRaceTime,raceTimestamp} from './raceTime.js'
const percent=p=>Number.isFinite(p)?`${(p*100).toFixed(1)}%`:'未取得'
export function RegisteredResult({review}){
  return <><strong>{review?.groups?.join(' → ')??(review?.state==='unregistered'?'グループ未登録':review?.state==='held'?'グループ照合保留':'結果待ち')}</strong>{review?.counts&&<small className="block">{review.counts.map(n=>`${n}頭`).join(' ／ ')}</small>}{review?.probabilities&&<small className="block">登録時確率 {review.probabilities.map(percent).join(' ／ ')}</small>}</>
}
export default function RegisteredGroupSummary({registration,onOpenGroups,compact=false,history=[]}){
  if(!registration)return <div><p className="rca-muted">グループ未登録</p>{onOpenGroups&&<button className="rca-secondary" onClick={onOpenGroups}>グループを設定する</button>}</div>
  const after=Date.parse(registration.createdAt)>=Date.parse(raceTimestamp(registration.race,registration.race.postTime))
  return <div aria-label="結果に使う登録グループ" className="rca-registered-summary"><strong>登録グループ</strong><p>{registration.grouping.groups.map(g=>`${g.label}群 ${g.horses.length}頭`).join(' ／ ')}</p>
    <small className="block">登録 {formatRaceTime(registration.createdAt)}{after?' · 発走後の登録':''}</small>
    {!compact&&<details><summary>登録した馬番・履歴の基準</summary>{registration.grouping.groups.map(g=><p key={g.label}>{g.label}群：{g.horses.map(h=>`${h.no} ${h.name}`).join(' ／ ')}</p>)}<p>観測 {formatRaceTime(registration.snapshot.observedAt)} ／ 取得 {formatRaceTime(registration.snapshot.retrievedAt)}</p><p>この登録を結果と当日の集計に使います。保存済みの予想は保存時の分類を保持します。</p></details>}
    {!compact&&history.length>1&&<details><summary>グループの登録履歴（{history.length}件）</summary>{[...history].reverse().map(record=><div key={record.id}><small>{formatRaceTime(record.createdAt)}{record.id===registration.id?' · 現在の登録':''}</small><p>{record.grouping.groups.map(g=>`${g.label}群：${g.horses.map(h=>h.no).join('・')}`).join(' ／ ')}</p></div>)}</details>}
    {onOpenGroups&&<button className="rca-secondary" onClick={onOpenGroups}>登録グループを確認・変更する</button>}
  </div>
}
