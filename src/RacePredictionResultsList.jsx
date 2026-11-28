import RegisteredGroupSummary,{RegisteredResult} from './RegisteredGroupSummary.jsx'
import {useState} from 'react'
import {racePredictionRows,raceGroupTally,raceResultName} from './racePredictionResults.js'
import {formatRaceTime} from './raceTime.js'
const yen=value=>value==null?'払戻未登録':`${value.toLocaleString('ja-JP')}円`
export default function RacePredictionResultsList({raceDate,races,plans,results,official,registrations=[],onOpenRace,loading=false}){
  const [venue,setVenue]=useState(''),[error,setError]=useState(''),[opening,setOpening]=useState(null)
  const rows=racePredictionRows({raceDate,races,plans,results,official,registrations})
  const venues=[...new Set(rows.map(r=>r.race.place).filter(Boolean))]
  const visible=rows.filter(row=>!venue||row.race.place===venue),tally=raceGroupTally(visible)
  async function open(race){setOpening(race.id);setError('');try{await onOpenRace(race)}catch(problem){setError(problem.message)}finally{setOpening(null)}}
  return <section className="rca-panel" aria-label="当日の予想・結果一覧"><h2>当日の予想・結果一覧</h2><p>{raceDate} · 予想を保存していないレースも表示</p>
    <label>会場<select aria-label="結果一覧の会場" className="rounded-lg border border-slate-300 bg-white px-3 py-2" value={venue} onChange={e=>setVenue(e.target.value)}><option value="">すべて</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
    {error&&<p role="alert" className="rca-error">{error}</p>}
    {!visible.length?<p className="rca-muted">{loading?'開催レースと保存済みの予想を読み込み中です。':'表示できるレースがありません。'}</p>:<div className="overflow-x-auto"><table className="rca-list-table rca-journal-table" aria-label="予想と結果の組み合わせ"><thead><tr><th>レース</th><th>予想（保存時）</th><th>結果（登録グループ）</th><th>買い目・照合</th><th>確定払戻／100円</th></tr></thead><tbody>{visible.map(({race,plan,plans:saved,result,view,registration,groupResult})=><tr key={race.id}>
      <th scope="row">{onOpenRace?<button type="button" className="rca-horse-name" disabled={Boolean(opening)} onClick={()=>open(race)} aria-label={`${raceResultName(race)}の予想と結果を開く`}>{opening===race.id?'読み込み中…':raceResultName(race)}</button>:raceResultName(race)}<small className="block">{race.name}</small><small className="block">{race.postTime?String(race.postTime).replace(/^(\d{2}):?(\d{2})$/,'$1:$2'):''}</small><RegisteredGroupSummary registration={registration} compact/></th>
      <td data-label="私の予想">{plan?<><strong>{view.pattern}</strong><small className="block">{plan.type} · {view.positions.map(p=>`${p.horses.length}頭`).join(' ／ ')}</small><small className="block">{view.positions.map(p=>p.horses.map(h=>h.no).join('・')).join(plan.type==='3連複'?' − ':' → ')}</small><small className="block">保存 {formatRaceTime(plan.createdAt)}{saved.length>1?` ／ ${saved.length}件中の最新`:''}</small></>:<span className="rca-muted">予想未登録</span>}</td>
      <td data-label="レース結果">{result?<><strong>{result.numbers.join(' → ')}</strong><div><RegisteredResult review={groupResult}/></div><small className="block">{({manual:'手入力','user-image':'ユーザー画像',jrdb:'JRDB'})[result.source]}</small>{result.status!=='normal'&&<span className="rca-pill">照合保留</span>}</>:<span className="rca-muted">結果待ち</span>}</td>
      <td data-label="買い目・照合">{view?<>{view.pointCount}点 ／ 対象 {view.uniqueHorses}頭<small className="block">{view.state==='pending'?'結果待ち':view.state==='held'?'照合保留':view.hit?'買い目にあり':'買い目になし'}</small></>:'—'}</td>
      <td data-label="確定払戻／100円">{view?yen(view.payout):result?.status==='normal'&&result.payouts?.length?result.payouts.map(p=><small className="block" key={p.type}>{p.type} {yen(p.per100)}</small>):'払戻未登録'}</td>
    </tr>)}</tbody></table></div>}
    <h3 className="mt-5">グループ別の着順回数</h3><p className="rca-muted">照合できた{tally.count}レース。予想の有無にかかわらず、最後に登録したグループで1レース1回だけ数えます。グループ未登録・照合保留は除外し、発走後の登録も含みます。次のレースの確率は示しません。</p>
    <table className="rca-list-table rca-journal-tally" aria-label="グループ別の着順回数"><thead><tr><th>群</th><th>1着</th><th>2着</th><th>3着</th></tr></thead><tbody>{tally.groups.map(([g,values])=><tr key={g}><th>{g}</th>{values.map((n,i)=><td key={i}>{n}回</td>)}</tr>)}</tbody></table>
  </section>
}
