import {useState} from 'react'
import {createJournalResult,journalDate,latestResult,reviewPrediction,legacyPrediction,resolvedResult,officialJournalResult} from './predictionJournal.js'
import {formatRaceTime,raceTimestamp} from './raceTime.js'
import JournalHorseProbabilities from './JournalHorseProbabilities.jsx'
import GroupProbabilitySummary from './GroupProbabilitySummary.jsx'
const yen=p=>p===null?'未登録':`${p.toLocaleString('ja-JP')}円`
const control='rounded-lg border border-slate-300 bg-white px-3 py-2 max-w-full'
const name=plan=>`${plan.race.place??''}${plan.race.raceNo?`${plan.race.raceNo}R`:plan.race.name}`

export default function PredictionJournalPanel({journal,race,field,legacy=[],cloud,hasComposer=false}){
  const [selected,setSelected]=useState(''),[venue,setVenue]=useState('')
  const plans=[...new Map([...legacy.filter(p=>p.decision==='plan').map(legacyPrediction),...(journal.remote.legacy??[]),...journal.data.predictions].map(p=>[p.id,p])).values()].sort((a,b)=>a.createdAt.localeCompare(b.createdAt))
  const current=plans.filter(p=>p.race.id===String(race.id)),plan=current.find(p=>p.id===selected)??current.at(-1)
  const officialFor=id=>id===String(race.id)?officialJournalResult(race,cloud?.observations)??journal.remote.official?.find(r=>r.raceId===id):journal.remote.official?.find(r=>r.raceId===id)
  const resultFor=id=>resolvedResult(latestResult(journal.data.results,id),officialFor(id))
  const result=resultFor(String(race.id)),view=plan?reviewPrediction(plan,result):null
  const venues=[...new Set(plans.map(p=>p.race.place).filter(Boolean))]
  const visible=plans.filter(p=>!venue||p.race.place===venue)
  // A race contributes once to the descriptive tendency table, using the latest saved classification.
  const racePlans=[...new Map(visible.map(p=>[p.race.id,p])).values()]
  const tally=new Map();let counted=0
  for(const p of racePlans){const v=reviewPrediction(p,resultFor(p.race.id));if(v.state!=='ready')continue;counted++
    v.resultGroups.forEach((g,i)=>{if(!tally.has(g))tally.set(g,[0,0,0]);tally.get(g)[i]++})}
  const confirmed=plan&&journal.remote.receipts[plan.id]
  const preRace=confirmed&&Date.parse(confirmed)>=Date.parse(plan.createdAt)&&Date.parse(confirmed)<Date.parse(raceTimestamp(plan.race,plan.race.postTime))
  return <div className="rca-stack">
    {journal.loading&&<p role="status" className="rca-notice">当日の予想・結果を読み込み中です。</p>}
    {journal.error&&<p role="alert" className="rca-error">{journal.error}</p>}{journal.message&&<p role="status" className="rca-notice">{journal.message}</p>}
    {!hasComposer&&<section className="rca-panel" aria-label="保存したグループ判断"><h2>私の予想・結果</h2>
      {!plan?<p>このレースの予想はまだ登録されていません。</p>:<>
        <label>保存記録<select className={control} value={plan.id} onChange={e=>setSelected(e.target.value)}>{current.map(p=><option key={p.id} value={p.id}>{formatRaceTime(p.createdAt)} · {p.type}</option>)}</select></label>
        <p>{plan.type} · {view.pointCount}点 · 対象 {view.uniqueHorses}頭</p>
        <p><strong>予想 {view.pattern}</strong><br/>結果 {view.resultGroups?.join(' → ')??(view.state==='held'?'照合保留':'結果待ち')} {view.state==='ready'?`／ ${view.hit?'買い目にあり':'買い目になし'}`:''}</p>
        <p className="rca-muted">{preRace?'発走前のクラウド受付あり':confirmed?'事後記録・過去検証':'発走前の受付未確認'} · 記録 {formatRaceTime(plan.createdAt)}</p>
        <div className="rca-journal-slots">{view.positions.map(p=><div key={p.position}><strong>{plan.type==='3連複'?`${p.position}頭目`:`${p.position}着`} {p.labels.join('・')}群 · {p.horses.length}頭</strong><p>{p.horses.map(h=>`${h.no} ${h.name}`).join(' ／ ')}</p></div>)}</div>
        <p>確定払戻（100円あたり）：{yen(view.payout)}</p><p className="rca-muted">結果の組み合わせに対して登録された確定払戻です。実際の受取額・回収率ではありません。</p>
        {plan.note&&<p className="whitespace-pre-wrap">{plan.note}</p>}
        <details><summary>保存した買い目・グループ・確率</summary><p>観測 {formatRaceTime(plan.snapshot.observedAt)} ／ 取得 {formatRaceTime(plan.snapshot.retrievedAt)}</p>
          {plan.grouping.groups.map(g=><p key={g.label}>{g.label}群（{g.horses.length}頭）：{g.horses.map(h=>`${h.no} ${h.name}`).join(' ／ ')}</p>)}
          {plan.probabilities?.groups.map(g=><GroupProbabilitySummary key={g.label} summary={g}/>)}
          <JournalHorseProbabilities rows={plan.probabilities?.horses} grouping={plan.grouping}/>
          <p className="rca-muted">確率は保存時点のモデル試算です。結果に合わせた再計算はしません。</p>
          <ul className="rca-journal-tickets">{plan.tickets.map(t=><li key={t.key}>{t.numbers.join(plan.type==='3連複'?'−':'→')}</li>)}</ul>
        </details>
      </>}
    </section>}
    <ResultEditor key={`${race.id}:${latestResult(journal.data.results,String(race.id))?.id??officialFor(String(race.id))?.id??'new'}`} race={race} field={field} previous={latestResult(journal.data.results,String(race.id))} official={officialFor(String(race.id))} busy={journal.busy||journal.loading} onSave={journal.save}/>
    {result?.conflict&&<p role="alert" className="rca-error">入力結果とJRDBの着順が一致しません。照合を保留しています。画像・開催日・レースを確認して訂正してください。</p>}
    <section className="rca-panel" aria-label="当日の予想・結果一覧"><h2>当日の予想・結果一覧</h2><p>{journalDate(race)} · 各レースの保存時のグループで照合</p>
      <div className="flex flex-wrap gap-3"><label>会場<select className={control} value={venue} onChange={e=>setVenue(e.target.value)}><option value="">すべて</option>{venues.map(v=><option key={v}>{v}</option>)}</select></label><button className="rca-secondary" disabled={journal.loading||journal.busy} onClick={journal.refresh}>結果一覧を再読込</button>{journal.connected&&<button className="rca-secondary" disabled={journal.loading||journal.busy} onClick={journal.resend}>未同期の記録を再送</button>}</div>
      {!visible.length?<p>保存した予想はまだありません。</p>:<div className="overflow-x-auto"><table className="rca-list-table rca-journal-table" aria-label="予想と結果の組み合わせ"><thead><tr><th>レース・券種</th><th>予想の群／頭数</th><th>買い目点数／対象頭数</th><th>結果の群／馬番</th><th>照合</th><th>確定払戻／100円</th></tr></thead><tbody>{visible.map(p=>{const v=reviewPrediction(p,resultFor(p.race.id));return <tr key={p.id}><th>{name(p)}<br/>{p.type}<small className="block">{formatRaceTime(p.createdAt)}<br/>{journal.remote.receipts[p.id]&&Date.parse(journal.remote.receipts[p.id])>=Date.parse(p.createdAt)&&Date.parse(journal.remote.receipts[p.id])<Date.parse(raceTimestamp(p.race,p.race.postTime))?'発走前受付':'事後・受付未確認'}</small></th><td data-label="予想の群・頭数">{v.pattern}<br/>{v.positions.map(pos=>`${pos.horses.length}頭`).join(' ／ ')}</td><td data-label="買い目点数・対象">{v.pointCount}点<br/>{v.uniqueHorses}頭</td><td data-label="結果の群・馬番">{v.resultGroups?.join(' → ')??'—'}<br/>{resultFor(p.race.id)?.numbers.join(' → ')??'結果待ち'}<small className="block">{({manual:'手入力','user-image':'ユーザー画像',jrdb:'JRDB'})[resultFor(p.race.id)?.source]??''}</small></td><td data-label="照合">{v.state==='pending'?'結果待ち':v.state==='held'?'照合保留':v.hit?'買い目にあり':'買い目になし'}</td><td data-label="確定払戻／100円">{yen(v.payout)}</td></tr>})}</tbody></table></div>}
      <h3 className="mt-5">グループ別の着順回数</h3><p className="rca-muted">照合できた{counted}レース。複数の予想があるレースは最後の保存時の分類で1回だけ数えます。事後・受付未確認の記録も含む参考集計です。少数レースの集計で、次のレースの確率は示しません。</p>
      <table className="rca-list-table rca-journal-tally" aria-label="グループ別の着順回数"><thead><tr><th>群</th><th>1着</th><th>2着</th><th>3着</th></tr></thead><tbody>{[...tally].sort(([a],[b])=>a.localeCompare(b)).map(([g,values])=><tr key={g}><th>{g}</th>{values.map((n,i)=><td key={i}>{n}回</td>)}</tr>)}</tbody></table>
    </section>
  </div>
}
function ResultEditor({race,field,previous,official,busy,onSave}){
  const initial=previous??official
  const [numbers,setNumbers]=useState(initial?.numbers.map(String)??['','','']),[payouts,setPayouts]=useState(Object.fromEntries((initial?.payouts??[]).map(p=>[p.type,String(p.per100)]))),[source,setSource]=useState(previous?.source??'user-image'),[evidence,setEvidence]=useState(previous?.evidence??''),[held,setHeld]=useState(previous?.status==='held'),[error,setError]=useState(''),[attempt,setAttempt]=useState(null)
  async function save(e){e.preventDefault();setError('');try{
    if(numbers.some(no=>!field.some(h=>h.no===Number(no))))throw new Error('出走馬から着順を選んでください。')
    const input={raceId:String(race.id),raceDate:journalDate(race),numbers:numbers.map(Number),payouts:held?[]:Object.entries(payouts).filter(([,v])=>v!=='').map(([type,v])=>({type,per100:Number(v)})),source,evidence,status:held?'held':'normal',replacesId:previous?.id??null}
    const signature=JSON.stringify(input),record=attempt?.signature===signature?attempt.record:createJournalResult(input)
    setAttempt({signature,record});await onSave(record)
  }catch(problem){setError(problem.message)}}
  return <details className="rca-panel"><summary>{previous?'結果を確認・訂正する':'画像・手入力で結果を登録する'}</summary><p className="rca-muted">このチャットに送った画像をもとに登録する場合も、着順と100円あたりの確定払戻を記録します。画像を自動取得する機能ではありません。</p><form onSubmit={save}><fieldset disabled={busy} className="rca-stack"><div className="rca-group-controls">{numbers.map((no,i)=><label key={i}>{i+1}着の馬番<select aria-label={`${i+1}着の馬番`} className={control} value={no} onChange={e=>setNumbers(old=>old.map((v,index)=>index===i?e.target.value:v))}><option value="">選択</option>{field.map(h=><option key={h.no} value={h.no}>{h.no} {h.name}</option>)}</select></label>)}</div><label><input type="checkbox" checked={held} onChange={e=>setHeld(e.target.checked)}/> 同着・異常結果などで照合を保留</label>
    {!held&&<div className="rca-group-controls">{['馬単','3連単','3連複'].map(type=><label key={type}>{type}の確定払戻（100円あたり）<input className={control} inputMode="numeric" type="number" min="1" step="1" value={payouts[type]??''} onChange={e=>setPayouts({...payouts,[type]:e.target.value})}/></label>)}</div>}
    <label>結果の出典<select className={control} value={source} onChange={e=>setSource(e.target.value)}><option value="user-image">ユーザー画像</option><option value="manual">手入力</option></select></label><label>画像名・確認メモ<input className={`${control} w-full`} maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <p className="rca-muted">開催日 {journalDate(race)} ／ {race.place??''} {race.raceNo??''}R。払戻が未確認なら空欄で保存できます。訂正前の記録も残ります。</p>{error&&<p role="alert" className="rca-error">{error}</p>}<button className="rca-primary self-start" type="submit">{busy?'保存中…':previous?'訂正した結果を保存':'結果を登録する'}</button>
    {previous&&<p className="rca-muted">前回登録 {formatRaceTime(previous.createdAt)} ／ {previous.numbers.join(' → ')}</p>}
    </fieldset></form></details>
}
