import GroupTendencyMetrics from './GroupTendencyMetrics.jsx'
import {raceSurface,raceCategory} from './groupTendencyMetrics.js'
import {useState} from 'react'
import {racePredictionRows,raceGroupTally,raceResultName} from './racePredictionResults.js'
import {resultBasisLabel} from './automaticResultGroups.js'
import {formatRaceTime} from './raceTime.js'
const percent=p=>Number.isFinite(p)?`${(p*100).toFixed(1)}%`:null
export default function RaceGroupTrends({raceDate,races,results,official,registrations,automaticGroups,onOpenRace,loading=false,predictions=[],receipts={}}){
  const [surface,setSurface]=useState(''),[category,setCategory]=useState(''),[venue,setVenue]=useState(''),[error,setError]=useState(''),[opening,setOpening]=useState(null)
  const rows=racePredictionRows({raceDate,races,results,official,registrations,automaticGroups})
  const venues=[...new Set(rows.map(r=>r.race.place).filter(Boolean))]
  const visible=rows.filter(r=>(!venue||r.race.place===venue)&&(!surface||raceSurface(r.race)===surface)&&(!category||raceCategory(r.race)===category)),tally=raceGroupTally(visible)
  const ready=visible.filter(r=>r.result).length,unclassified=visible.filter(r=>r.result&&r.groupResult.state==='unregistered').length
  async function open(race){setOpening(race.id);setError('');try{await onOpenRace(race)}catch(problem){setError(problem.message)}finally{setOpening(null)}}
  return <section className="rca-panel" aria-label="当日の全レース・グループ傾向"><h2>今日の結果をグループで見る</h2><p>{raceDate} · 予想の登録に関係なく、開催全レースを対象にします。</p>
    <label>競馬場<select aria-label="グループ傾向の会場" className="rounded-lg border border-slate-300 bg-white px-3 py-2 ml-2" value={venue} onChange={e=>setVenue(e.target.value)}><option value="">すべて</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label>
    <div className="rca-tendency-filters"><label>馬場<select aria-label="グループ傾向の馬場" className="rounded-lg border border-slate-300 bg-white px-3 py-2 ml-2" value={surface} onChange={e=>setSurface(e.target.value)}><option value="">すべて</option>{[...new Set(rows.map(r=>raceSurface(r.race)))].map(v=><option key={v}>{v}</option>)}</select></label><label>レース種別<select aria-label="グループ傾向のレース種別" className="rounded-lg border border-slate-300 bg-white px-3 py-2 ml-2" value={category} onChange={e=>setCategory(e.target.value)}><option value="">すべて</option>{[...new Set(rows.map(r=>raceCategory(r.race)))].map(v=><option key={v}>{v}</option>)}</select></label></div>
    <p aria-live="polite">開催 {visible.length}レース ／ 結果 {ready}レース ／ グループ集計 {tally.count}レース</p>
    <p className="rca-muted">自分の登録 {tally.registered}・自動 {tally.automatic}（うち参考 {tally.reference}）。登録があれば優先し、未登録は単勝オッズの自動分類を使います。</p>
    <GroupTendencyMetrics rows={visible} registrations={registrations} predictions={predictions} receipts={receipts} loading={loading}/>
    {unclassified>0&&<p className="rca-muted">{unclassified}レースは分類に必要な全頭のオッズ待ちです。</p>}
    <p className="rca-muted">この開催での回数です。次のレースの確率や回収率を示すものではありません。</p>
    {error&&<p role="alert" className="rca-error">{error}</p>}
    <h3>全レースの結果</h3>{!visible.length?<p>{loading?'開催情報を読み込み中です。':'開催レースを取得できていません。再読込してください。'}</p>:<table className="rca-list-table rca-all-result-table" aria-label="全レースのグループ結果"><thead><tr><th>レース・分類</th><th>1着</th><th>2着</th><th>3着</th></tr></thead><tbody>{visible.map(row=><tr key={row.race.id}>
      <th scope="row">{onOpenRace?<button type="button" className="rca-horse-name" disabled={Boolean(opening)} onClick={()=>open(row.race)} aria-label={`${raceResultName(row.race)}の詳細を開く`}>{opening===row.race.id?'読み込み中…':raceResultName(row.race)}</button>:raceResultName(row.race)}<small className="block">{resultBasisLabel(row.registration,row.automatic)}</small>{row.groupBasis&&<small className="block">{formatRaceTime(row.groupBasis.snapshot.observedAt)}</small>}</th>
      {[0,1,2].map(i=>{const no=row.result?.numbers[i],label=row.groupResult.groups?.[i],horse=row.groupBasis?.field.find(h=>h.no===no),prob=percent(row.groupResult.probabilities?.[i]);return <td key={i} data-label={`${i+1}着`}>
        {row.result?<><strong className="rca-result-group-letter">{label?`${label}群`:row.groupResult.state==='held'?'照合保留':'分類待ち'}</strong><small className="block">{no}番{horse?` ${horse.name}`:''}</small>{label&&<small className="block">群 {row.groupResult.counts[i]}頭</small>}{prob&&<small className="block">登録時 {prob}</small>}</>:<span className="rca-muted">結果待ち</span>}
      </td>})}
    </tr>)}</tbody></table>}
  </section>
}
