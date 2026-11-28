import {useState} from 'react'
import {createJournalResult,journalDate,latestResult,reviewPrediction,resolvedResult,officialJournalResult} from './predictionJournal.js'
import {formatRaceTime,raceTimestamp} from './raceTime.js'
import RacePredictionResultsList from './RacePredictionResultsList.jsx'
import {journalPlans} from './racePredictionResults.js'
import JournalHorseProbabilities from './JournalHorseProbabilities.jsx'
import GroupProbabilitySummary from './GroupProbabilitySummary.jsx'
const yen=p=>p===null?'未登録':`${p.toLocaleString('ja-JP')}円`
const control='rounded-lg border border-slate-300 bg-white px-3 py-2 max-w-full'

export default function PredictionJournalPanel({journal,race,field,legacy=[],cloud,hasComposer=false,availableRaces=[],onOpenRace}){
  const [selected,setSelected]=useState('')
  const plans=journalPlans(journal,legacy)
  const current=plans.filter(p=>p.race.id===String(race.id)),plan=current.find(p=>p.id===selected)??current.at(-1)
  const officialFor=id=>id===String(race.id)?officialJournalResult(race,cloud?.observations)??journal.remote.official?.find(r=>r.raceId===id):journal.remote.official?.find(r=>r.raceId===id)
  const resultFor=id=>resolvedResult(latestResult(journal.data.results,id),officialFor(id))
  const result=resultFor(String(race.id)),view=plan?reviewPrediction(plan,result):null
  const confirmed=plan&&journal.remote.receipts[plan.id]
  const preRace=confirmed&&Date.parse(confirmed)>=Date.parse(plan.createdAt)&&Date.parse(confirmed)<Date.parse(raceTimestamp(plan.race,plan.race.postTime))
  return <div className="rca-stack">
    {journal.loading&&<p role="status" className="rca-notice">当日の予想・結果を読み込み中です。</p>}
    {journal.error&&<p role="alert" className="rca-error">{journal.error}</p>}{journal.message&&<p role="status" className="rca-notice">{journal.message}</p>}
    {!hasComposer&&<section className="rca-panel" aria-label="保存したグループ判断"><h2>私の予想・結果</h2>
      {!plan?<div className="rca-result-comparison" role="group" aria-label="このレースの予想と結果"><section aria-label="保存した予想"><h3>予想</h3><p>このレースの予想はまだ登録されていません。</p></section><section aria-label="このレースの結果"><h3>結果</h3><strong>{result?.numbers.join(' → ')??'結果待ち'}</strong>{result?.status==='held'&&<p>照合保留</p>}</section></div>:<>
        <label>保存記録<select className={control} value={plan.id} onChange={e=>setSelected(e.target.value)}>{current.map(p=><option key={p.id} value={p.id}>{formatRaceTime(p.createdAt)} · {p.type}</option>)}</select></label>
        <p>{plan.type} · {view.pointCount}点 · 対象 {view.uniqueHorses}頭</p>
        <div className="rca-result-comparison" role="group" aria-label="このレースの予想と結果"><section aria-label="保存した予想"><h3>予想</h3><strong>予想 {view.pattern}</strong><p>{view.positions.map(p=>p.horses.map(h=>h.no).join('・')).join(plan.type==='3連複'?' − ':' → ')}</p></section><section aria-label="このレースの結果"><h3>結果</h3><strong>結果 {view.resultGroups?.join(' → ')??(view.state==='held'?'照合保留':'結果待ち')}</strong><p>{result?.numbers.join(' → ')??'着順未取得'}</p>{view.state==='ready'&&<p>{view.hit?'買い目にあり':'買い目になし'}</p>}</section></div>

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
    <div className="flex flex-wrap gap-3"><button className="rca-secondary" disabled={journal.loading||journal.busy} onClick={journal.refresh}>結果一覧を再読込</button>{journal.connected&&<button className="rca-secondary" disabled={journal.loading||journal.busy} onClick={journal.resend}>未同期の記録を再送</button>}</div>
    <RacePredictionResultsList raceDate={journalDate(race)} races={[race,...availableRaces,...(journal.remote.races??[])]} plans={plans} results={journal.data.results} official={[...(journal.remote.official??[]).filter(r=>r.raceId!==String(race.id)),...(officialFor(String(race.id))?[officialFor(String(race.id))]:[])]} onOpenRace={onOpenRace} loading={journal.loading}/>

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
  return <details className="rca-panel"><summary>{previous?'結果を確認・訂正する':'画像・手入力で結果を登録する'}</summary><p className="rca-muted">{field.length<3&&'出走馬の取得後に結果を登録できます。'}このチャットに送った画像をもとに登録する場合も、着順と100円あたりの確定払戻を記録します。画像を自動取得する機能ではありません。</p><form onSubmit={save}><fieldset disabled={busy||field.length<3} className="rca-stack"><div className="rca-group-controls">{numbers.map((no,i)=><label key={i}>{i+1}着の馬番<select aria-label={`${i+1}着の馬番`} className={control} value={no} onChange={e=>setNumbers(old=>old.map((v,index)=>index===i?e.target.value:v))}><option value="">選択</option>{field.map(h=><option key={h.no} value={h.no}>{h.no} {h.name}</option>)}</select></label>)}</div><label><input type="checkbox" checked={held} onChange={e=>setHeld(e.target.checked)}/> 同着・異常結果などで照合を保留</label>
    {!held&&<div className="rca-group-controls">{['馬単','3連単','3連複'].map(type=><label key={type}>{type}の確定払戻（100円あたり）<input className={control} inputMode="numeric" type="number" min="1" step="1" value={payouts[type]??''} onChange={e=>setPayouts({...payouts,[type]:e.target.value})}/></label>)}</div>}
    <label>結果の出典<select className={control} value={source} onChange={e=>setSource(e.target.value)}><option value="user-image">ユーザー画像</option><option value="manual">手入力</option></select></label><label>画像名・確認メモ<input className={`${control} w-full`} maxLength={500} value={evidence} onChange={e=>setEvidence(e.target.value)}/></label>
    <p className="rca-muted">開催日 {journalDate(race)} ／ {race.place??''} {race.raceNo??''}R。払戻が未確認なら空欄で保存できます。訂正前の記録も残ります。</p>{error&&<p role="alert" className="rca-error">{error}</p>}<button className="rca-primary self-start" type="submit">{busy?'保存中…':previous?'訂正した結果を保存':'結果を登録する'}</button>
    {previous&&<p className="rca-muted">前回登録 {formatRaceTime(previous.createdAt)} ／ {previous.numbers.join(' → ')}</p>}
    </fieldset></form></details>
}
