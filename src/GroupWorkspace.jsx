import {createGroupRegistration,latestGroupRegistration,readGroupRegistrations,registrationMatches} from './groupRegistration.js'
import {journalDate} from './predictionJournal.js'
import RegisteredGroupSummary from './RegisteredGroupSummary.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import { groupOdds, formationTickets, compareGroupPlans, groupBudget, createGroupPlan, reviewGroupPlan, groupOutcome, groupReceiptVerified } from './groupAnalysis.js'
import { ledgerScope, emptyLedger, readLedger, appendGroupPlan, writeLedgerExclusive, importLedger, exportLedger,
  appendPurchase, appendSettlement, activePurchases, latestSettlement, summarizeLedger } from './forecastLedger.js'
import { readOddsHistory, readOddsEvents, oddsStorageKey } from './oddsHistory.js'
import { readCloudRace } from './cloudStore.js'
import { formatRaceTime, snapshotTiming, raceDateISO } from './raceTime.js'
import { parseQuotes, ticketKey } from './portfolio.js'
import { PurchaseEditor, SettlementEditor } from './FinalForecastPage.jsx'
import { downloadJson } from './fileIO.js'
import HorseAssessments from './HorseAssessments.jsx'
import GroupPredictionCard from './GroupPredictionCard.jsx'
import {useAceAssessment} from './useAceAssessment.js'
import PersonalGroupComposer from './PersonalGroupComposer.jsx'
import PredictionJournalPanel from './PredictionJournalPanel.jsx'
import {usePredictionJournal} from './usePredictionJournal.js'
import PersonalPredictionReview from './PersonalPredictionReview.jsx'
import GroupSelectionNumbers from './GroupSelectionNumbers.jsx'
import GroupProbabilitySummary from './GroupProbabilitySummary.jsx'
import {summarizeGroupProbabilities} from './groupProbabilities.js'
import {displayGroups,matchingGroupPreference} from './groupDisplay.js'

const yen = n => `${n.toLocaleString('ja-JP')}円`
const betLabel = t => `${t.type} ${t.numbers.join(t.type === '3連複' ? '−' : '→')}`
const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm max-w-full'
const toggle = (values,value) => values.includes(value) ? values.filter(x => x !== value) : [...values,value]

function load(userId,race) {
  const scope = ledgerScope(userId,race)
  try {
    const ledger = readLedger(localStorage,scope)
    readOddsEvents(oddsStorageKey(userId,race)) // Report corrupt history instead of silently rendering an empty success.
    return { ...ledger, history:readOddsHistory(oddsStorageKey(userId,race)), cloud:readCloudRace(userId,race) }
  } catch (error) { return { ledger:emptyLedger(scope), history:[], cloud:null, error:error.message } }
}

function evidence(h,stats,race) {
  const ratio = (n,d) => Number.isInteger(n) && Number.isInteger(d) && d >= n && n >= 0 ? `${n}/${d}走` : '未取得'
  const date = raceDateISO(race)?.replaceAll('-','')
  const runs = (h.pastRuns ?? []).filter(r => String(r.date ?? r.race_date ?? '').replaceAll('-','') < date && /^\d{8}$/.test(String(r.date ?? r.race_date ?? '').replaceAll('-','')))
  const prior = runs[0]
  const carried = h.weightCarried ?? h.carriedWeight
  const priorWeight = prior?.weightCarried ?? prior?.carriedWeight
  const validWeight = value => Number.isFinite(value) && value >= 40 && value <= 80
  const rest = prior ? Math.round((Date.parse(raceDateISO(race))-Date.parse(raceDateISO({ raceDate:prior.date ?? prior.race_date })))/86400000) : null
  return [Number.isFinite(stats?.idm ?? h.idm) ? `IDM ${stats?.idm ?? h.idm}` : 'IDM 未取得',
    `近い距離３着内 ${ratio(stats?.distance_top3,stats?.distance_runs)}`, `同場同距離 ${ratio(stats?.course_top3,stats?.course_runs)}`,
    validWeight(carried) ? `斤量${carried}kg${validWeight(priorWeight) ? `（前走比${carried-priorWeight}kg）` : ''}` : '斤量比較 未取得',
    Number.isFinite(stats?.training_idx) ? `調教指数${stats.training_idx}` : '調教指数 未取得',
    prior ? `取得過去走 ${prior.date ?? prior.race_date} ${prior.dist ?? prior.distance ?? ''} ${prior.rank ?? '不明'}着${prior.margin != null ? ` 着差${prior.margin}` : ''}${rest > 0 ? `（${rest}日前）` : ''}` : '日付を確認できる過去走なし'].join(' ／ ')
}

export default function GroupWorkspace(props) {
  if (!props.race || !props.userId) return <section className="rca-panel"><p>ログインしてレースを選択してください。</p></section>
  return <Groups key={`${props.userId}:${props.race.raceDate}:${props.race.id}`} {...props} />
}

function Groups({ userId, race, horses, statistics = [], cloudRevision = 0, onSyncLedger, onOpenAbility, review, syncedGroupReceipts, loading = false,groupDisplay,onGroupDisplayChange,personalOnly=false,onOpenPersonal,onOpenGroups,onOpenResults }) {
  const journal=usePredictionJournal({userId,race,connected:Boolean(onSyncLedger),revision:cloudRevision})
  const [data,setData] = useState(() => load(userId,race))
  const [initialGroup]=useState(()=>{
    const config=matchingGroupPreference(race,groupDisplay)
    let registration=null
    try{registration=latestGroupRegistration(readGroupRegistrations(localStorage,userId,journalDate(race)),race.id)}catch{/* The journal hook reports corrupt registration storage. */}
    if(!config&&registration)return {snapshotId:registration.snapshot.id,threshold:registration.grouping.threshold,boundaries:registration.grouping.manual?registration.grouping.boundaries:null,excluded:[],registration,hasPreference:false}
    const snapshot=(!config?.followLatest&&data.history.find(s=>s.id===config?.snapshotId))||data.history[0]
    const grouping=displayGroups({race,field:horses,snapshot,preference:config})
    return {hasPreference:Boolean(config),registration,snapshotId:config&&!config.followLatest&&snapshot?.id===config.snapshotId?config.snapshotId:'',threshold:grouping.threshold,
      boundaries:grouping.manual?grouping.boundaries:null,excluded:Array.isArray(config?.excluded)?config.excluded.filter(no=>horses.some(h=>Number(h.no)===no)):[]}
  })
  const [ledger,setLedger] = useState(data.ledger)
  const [receipts,setReceipts] = useState(data.cloud?.groupReceipts ?? {})
  const [error,setError] = useState(''), [message,setMessage] = useState(''), [busy,setBusy] = useState(false)
  const saving = useRef(false)
  const [horseDetail,setHorseDetail]=useState(null)
  const returnTarget=useRef(null),returnPosition=useRef(0),detailBack=useRef(null)
  useEffect(()=>{
    if(horseDetail){detailBack.current?.focus({preventScroll:true});detailBack.current?.scrollIntoView({block:'start'})}
    else if(returnTarget.current?.isConnected){returnTarget.current.focus({preventScroll:true});window.scrollTo(0,returnPosition.current)}
  },[horseDetail])
  useEffect(() => {
    const next = load(userId,race)
    setData(next)
    if (!next.error) setLedger(next.ledger)
    setReceipts(old => ({ ...old,...next.cloud?.groupReceipts,...syncedGroupReceipts }))
  },[userId,race,cloudRevision,syncedGroupReceipts])
  const [snapshotId,setSnapshotId] = useState(initialGroup.snapshotId)
  const [threshold,setThreshold] = useState(String(initialGroup.threshold)), [boundaries,setBoundaries] = useState(initialGroup.boundaries)
  const [slotChoice,setSlotChoice] = useState(null), [excluded,setExcluded] = useState(initialGroup.excluded)
  const [variant,setVariant] = useState('ordered'), [budget,setBudget] = useState('10000'), [unit,setUnit] = useState('100')
  const [overrides,setOverrides] = useState({}), [quoteText,setQuoteText] = useState('')
  const [quoteObservedAt,setQuoteObservedAt] = useState(''), [quoteRetrievedAt,setQuoteRetrievedAt] = useState(null)
  const [note,setNote] = useState(''), [selectedId,setSelectedId] = useState('')
  const [composerSource,setComposerSource] = useState(null)
  const [quickType,setQuickType]=useState('3連単'),[quickChoice,setQuickChoice]=useState(null)
  const composerHeading=useRef(null)
  useEffect(()=>{if(composerSource){composerHeading.current?.focus({preventScroll:true});window.scrollTo({top:0,behavior:'instant'})}},[composerSource])
  const recordsHeading = useRef(null)
  const registered=latestGroupRegistration(journal.registrations,race.id)
  const [restoredRegistration,setRestoredRegistration]=useState(initialGroup.registration??null)
  const classificationTouched=useRef(false),registrationAttempt=useRef(null)
  // Restore cloud registrations only before the user starts editing this race.
  useEffect(()=>{
    if(registered&&!initialGroup.hasPreference&&!classificationTouched.current){
      setSnapshotId(registered.snapshot.id);setThreshold(String(registered.grouping.threshold));setBoundaries(registered.grouping.manual?registered.grouping.boundaries:null);setRestoredRegistration(registered)
    }
  },[registered,initialGroup.hasPreference])
  const savedObservation=registered?.snapshot.id===snapshotId?registered.snapshot:restoredRegistration?.snapshot.id===snapshotId?restoredRegistration.snapshot:null
  const observations=savedObservation&&!data.history.some(s=>s.id===savedObservation.id)?[savedObservation,...data.history]:data.history
  const current = observations.find(s => s.id === snapshotId) ?? data.history[0]
  const field = useMemo(() => horses.map(h => ({ no:Number(h.no), name:h.name ?? '', ...(h.frameNo ? { frameNo:h.frameNo } : {}),
    ...(h.cancelled ? { cancelled:true } : {}), evidence:evidence(h,statistics.find(s => Number(s.horse_no) === Number(h.no)),race) })),[horses,statistics,race])
  const analysis = useMemo(() => {
    const result = { quotes:[] }
    try {
      const grouping = groupOdds(field,current?.odds,Number(threshold),boundaries)
      const labels = grouping.groups.map(g => g.label)
      const slots = (slotChoice ?? [[labels[1] ?? labels[0]].filter(Boolean),[labels[0]].filter(Boolean),labels])
        .map(slot => slot.filter(label => labels.includes(label)))
      const alternatives = compareGroupPlans(grouping,slots,excluded)
      const selected = alternatives.find(a => a.id === variant)
      Object.assign(result,{ grouping,slots,alternatives,selected })
      const parsed = parseQuotes(quoteText,field)
      if (parsed.errors.length) throw new Error(parsed.errors.join(' '))
      if (parsed.quotes.some(q => !['馬単','3連複','3連単'].includes(q.type))) throw new Error('この比較では馬単・3連複・3連単の実オッズを入力してください。')
      const quotes = parsed.quotes
      const totals = groupBudget(selected.tickets,Number(budget),Number(unit),overrides,quotes)
      return { grouping,slots,alternatives,quotes,selected,totals }
    } catch (problem) { return { ...result,error:problem.message } }
  },[field,current,threshold,boundaries,slotChoice,excluded,quoteText,variant,budget,unit,overrides])
  const grouping = analysis.grouping
  const ace=useAceAssessment({race,horses,statistics,userId,cloudRevision,review,asOf:current?.retrievedAt??null,enabled:Boolean(current)})
  const quickBasis=JSON.stringify([current?.id,current?.odds,grouping?.boundaries,excluded])
  const quickSlots=quickChoice?.basis===quickBasis?quickChoice.slots:[[],[],[]]
  const quickTickets=grouping?formationTickets(grouping,quickSlots,quickType,excluded):[]
  const groupProbabilities=useMemo(()=>summarizeGroupProbabilities(grouping,ace,excluded),[grouping,ace,excluded])
  useEffect(()=>{
    if(current&&grouping)onGroupDisplayChange?.({raceId:String(race.id),raceDate:race.raceDate,snapshotId:current.id,
      threshold:grouping.threshold,boundaries:grouping.manual?grouping.boundaries:null,followLatest:snapshotId==='',excluded})
  },[current,grouping,race,onGroupDisplayChange,snapshotId,excluded])
  const previous = data.history.filter(s => s.id !== current?.id && Date.parse(s.retrievedAt) < Date.parse(current?.retrievedAt) && Date.parse(s.observedAt) < Date.parse(current?.observedAt)
    && field.every(h => Number.isFinite(s.odds?.[h.no]) && s.odds[h.no] >= 1))
    .sort((a,b) => Date.parse(a.observedAt)-Date.parse(b.observedAt))[0]
  const frozen = ledger.groupPlans?.find(p => p.id === selectedId) ?? ledger.groupPlans?.at(-1)
  const personalSaved=Boolean(frozen)||journal.data.predictions.some(p=>p.race.id===String(race.id))
  const outcome = frozen ? groupOutcome(frozen,review,data.cloud) : null
  const purchase = frozen ? activePurchases(ledger).find(p => p.forecastId === frozen.id) : null
  const settlement = purchase ? latestSettlement(ledger,purchase.id) : null
  const payouts = (data.cloud?.observations ?? []).filter(e => e.kind === 'HJC' && e.payload?.status === 'published').sort((a,b) => Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))[0]
  const timing = snapshotTiming(current,race)

  async function persist(next,success) {
    if (saving.current) return false
    saving.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const saved = await writeLedgerExclusive(localStorage,next)
      setLedger(saved); setMessage(`${success} このブラウザに保存しました。`)
      if (onSyncLedger) {
        try {
          const response = await onSyncLedger(saved)
          const merged = await writeLedgerExclusive(localStorage,importLedger(saved,JSON.stringify(response.ledger)))
          setLedger(merged); setReceipts(old => ({ ...old,...response.groupReceipts }))
          setMessage(`${success} クラウドにも保存しました。`)
        } catch (problem) { setError(`クラウド同期は未完了です。ブラウザの記録は保持しています。${problem.message}`) }
      }
      return true
    } catch (problem) { setError(`保存できませんでした。${problem.message}`); return false }
    finally { saving.current = false; setBusy(false) }
  }
  async function freeze(decision) {
    if (analysis.error) return
    try {
      const plan = createGroupPlan({ race,field,snapshot:current,referenceSnapshot:previous ?? null,threshold:Number(threshold),boundaries, slots:analysis.slots,excluded,variant,
        budget:Number(budget),unit:Number(unit),overrides,quotes:analysis.quotes,quoteObservedAt:quoteObservedAt || null,quoteRetrievedAt,note,decision })
      if (await persist(appendGroupPlan(ledger,plan),decision === 'skip' ? '見送り判断を固定しました。' : 'グループと比較案を固定しました。')) setSelectedId(plan.id)
    } catch (problem) { setError(problem.message) }
  }
  function startPersonal(initial=null) {
    if (disabled || loading) return
    setComposerSource(JSON.parse(JSON.stringify({race,field,snapshot:current,referenceSnapshot:previous ?? null,
      threshold:Number(threshold),boundaries,excluded,groupProbabilities,probabilityBoundary:ace.boundary,
      probabilities:{groups:groupProbabilities,asOf:ace.boundary??null,horses:ace.rows.map(h=>({no:h.no,name:h.name,...Object.fromEntries(['win','second','third','top3'].map(k=>[k,h.probabilities?.[k]??null]))}))},...(initial?.type?{initialType:initial.type,initialSlots:initial.slots}:{})})))
    setError(''); setMessage('')
  }
  async function savePersonal(plan) {
    await journal.save(plan)
    setComposerSource(null);setQuickChoice(null)
    if(!personalOnly&&onOpenPersonal)onOpenPersonal()
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}))
  }
  async function registerClassification(){
    setError('')
    try{
      const input={race,field,snapshot:current,threshold:Number(threshold),boundaries,replacesId:registered?.id??null,
        probabilities:{groups:summarizeGroupProbabilities(grouping,ace),asOf:ace.boundary??null,horses:ace.rows.map(h=>({no:h.no,name:h.name,...Object.fromEntries(['win','second','third','top3'].map(k=>[k,h.probabilities?.[k]??null]))}))}}
      const signature=JSON.stringify(input),attempt=registrationAttempt.current
      const record=attempt?.signature===signature?attempt.record:createGroupRegistration(input)
      registrationAttempt.current={signature,record}
      await journal.registerGroups(record);setRestoredRegistration(record);classificationTouched.current=true;registrationAttempt.current=null
    }catch(problem){setError(problem.message)}
  }
  function changeObservation(id) {
    classificationTouched.current=true
    setSnapshotId(id===data.history[0]?.id?'':id); setBoundaries(null); setSlotChoice(null); setOverrides({}); setQuoteText(''); setQuoteObservedAt(''); setQuoteRetrievedAt(null)
  }
  function openHorse(no,event){
    returnTarget.current=event.currentTarget;returnPosition.current=window.scrollY
    setHorseDetail({no,asOf:current?.retrievedAt??null})
  }
  const disabled = busy || Boolean(data.error) || Boolean(analysis.error) || !grouping?.complete || field.some(h => h.cancelled)
  const records = (
    <section className="rca-panel" aria-label="保存したグループ判断"><h2 tabIndex={-1} ref={recordsHeading}>{personalOnly?'私の予想・結果':'私の予想・購入記録'}</h2>{!frozen ? <p className="rca-muted">保存したグループ判断はまだありません。</p> : <>
      <label>保存記録<select className={control} value={frozen.id} onChange={e => setSelectedId(e.target.value)}>{[...(ledger.groupPlans ?? [])].reverse().map(p => <option key={p.id} value={p.id}>{formatRaceTime(p.createdAt)} · {p.decision === 'skip' ? '見送り' : ({ordered:'3連単',swapped:'3連単・入替',trio:'3連複',exacta:'馬単'})[p.variant]} · {p.mode === 'live' ? '締切前記録' : '過去検証'}</option>)}</select></label>
      {personalOnly?<PersonalPredictionReview plan={frozen} outcome={outcome} receipt={receipts[frozen.id]} ownerId={userId} loading={loading} />:<GroupPlanResult plan={frozen} outcome={outcome} receipt={receipts[frozen.id]} ownerId={userId} />}
      <p className="rca-muted">保存時の根拠：{frozen.note || '記載なし'} ／ {frozen.grouping.manual ? '手動調整' : '自動分類'} ／ 境界倍率 {frozen.grouping.threshold}</p>
      {frozen.referenceSnapshot && <p className="rca-muted">比較元も固定：{formatRaceTime(frozen.referenceSnapshot.observedAt)} ／ {frozen.referenceGrouping.groups.map(g => `${g.label}：${g.horses.map(h => h.no).join('・')}`).join(' ／ ')}</p>}
      {!personalOnly&&<div className="rca-group-cards">{frozen.grouping.groups.map(g => <div key={g.label} className="rca-group-card"><strong>{g.label}</strong><p>{g.horses.map(h => `${h.no}番 ${h.odds}倍`).join(' ／ ')}</p></div>)}</div>}
      {frozen.decision === 'plan' && <details className="my-4"><summary>この案の実購入・払戻を記録する</summary><p className="rca-muted">案から購入を自動作成しません。実際の購入額と正式払戻だけを収支に計上します。</p>
        <PurchaseEditor key={`${frozen.id}:${purchase?.id ?? 'new'}`} forecast={frozen} purchase={purchase} disabled={busy || Boolean(data.error)} onSave={(tickets,note) => persist(appendPurchase(ledger,{ forecastId:frozen.id,tickets,note,replacesId:purchase?.id ?? null }).ledger,'実購入を記録しました。')} />
        {purchase && <SettlementEditor key={`${purchase.id}:${settlement?.id ?? 'new'}`} purchase={purchase} settlement={settlement} payoutEvent={payouts} disabled={busy || Boolean(data.error)} onSave={(payouts,note,source) => persist(appendSettlement(ledger,{ purchaseId:purchase.id,payouts,note,source,replacesId:settlement?.id ?? null }).ledger,'正式払戻を記録しました。')} />}
      </details>}
    </>}
      <p className="rca-muted">このレースの実購入の精算済み損益：{yen(summarizeLedger(ledger).profit)}。予想だけの試算は含みません。</p>
      <div className="flex flex-wrap gap-3 mt-4"><button className="rca-secondary" onClick={() => downloadJson(`race-records-${race.id}.json`,JSON.parse(exportLedger(ledger)))}>記録をJSONで書き出す</button><button className="rca-secondary" disabled={busy || Boolean(data.error)} onClick={() => persist(ledger,'保存済み記録を再送しました。')}>保存済み記録を再同期</button></div>
    </section>
  )
  return <>
    {horseDetail&&<div className="rca-stack" aria-label="グループから開いた馬の詳細">
      <div><button type="button" className="rca-secondary" ref={detailBack} onClick={()=>setHorseDetail(null)}>← グループ・買い目へ戻る</button><p className="rca-muted mt-2">グループ・買い目の入力内容を保持しています。</p></div>
      <HorseAssessments key={horseDetail.no} {...{race,horses,statistics,userId,cloudRevision,review}} initialHorseNo={horseDetail.no} detail asOf={horseDetail.asOf} />
    </div>}
    <div hidden={Boolean(horseDetail)} inert={Boolean(horseDetail)}><div className="rca-stack rca-groups">
    <div className="rca-page-title"><div><h1>{personalOnly||composerSource?'私の予想':'グループ・買い目比較'}</h1><p>{personalOnly||composerSource?'選んだグループと買い目を残し、着順・確定払戻と照合します。':'人気のまとまりと能力を確認し、着順を変えた案を比較します。'}</p></div>{onOpenAbility && <button className="rca-secondary" onClick={onOpenAbility}>能力・適性を詳しく見る</button>}</div>
    {loading && <p role="status" className="rca-notice">保存済みデータを読み込み中です。</p>}
    {(error || data.error) && <p role="alert" className="rca-error">{error || data.error}</p>}{message && <p role="status" className="rca-notice">{message}</p>}
    {!personalOnly&&journal.error&&<p role="alert" className="rca-error">{journal.error}</p>}{!personalOnly&&journal.message&&<p role="status" className="rca-notice">{journal.message}</p>}
    {!personalOnly&&!composerSource&&onOpenPersonal&&<div><button className="rca-secondary" onClick={onOpenPersonal}>私の予想を開く</button></div>}
    {personalOnly&&!composerSource&&<PredictionJournalPanel journal={journal} race={race} field={field} legacy={ledger.groupPlans??[]} cloud={data.cloud} hasComposer={Boolean(composerSource)} onOpenGroups={onOpenGroups} />}
    {personalOnly && !composerSource && <section className="rca-panel"><h2>{personalSaved?'新しい予想を追加':'自分で選んだ買い目を残す'}</h2><p className="rca-muted">まずグループを確認し、券種と買い方を選びます。選択は空欄から始まります。</p>
      {!personalSaved&&<div className="rca-group-cards my-4">{grouping?.groups.map(g=><div className="rca-group-card" key={g.label}><strong>{g.label}</strong><p>{g.horses.filter(h=>!excluded.includes(h.no)).map(h=>`${h.no} ${h.name}`).join(' ／ ') || '候補なし'}</p><GroupProbabilitySummary summary={groupProbabilities.find(s=>s.label===g.label)} /></div>)}</div>}
      {!current || !grouping?.complete ? <p className="rca-notice">全頭の単勝オッズの取得待ちです。データの同期後に登録できます。</p> : <p className="rca-muted">観測 {formatRaceTime(current.observedAt)} ／ 取得 {formatRaceTime(current.retrievedAt)}。この観測とグループを基準に入力します。</p>}
      {analysis.error && <p role="alert" className="rca-error">{analysis.error}</p>}
      {field.some(h=>h.cancelled) && <p className="rca-error">取消を含むレースは新しい予想の登録を保留します。保存済み記録は確認できます。</p>}
      <div className="flex flex-wrap gap-3 mt-4"><button className="rca-primary" disabled={disabled || loading} onClick={()=>startPersonal()}>新しい予想を入力する</button>{onOpenGroups && <button className="rca-secondary" onClick={onOpenGroups}>グループを確認・調整する</button>}</div>
    </section>}
    {composerSource&&<><div ref={composerHeading} tabIndex={-1}><PersonalGroupComposer source={composerSource} disabled={Boolean(data.error) || field.some(h=>h.cancelled)} busy={journal.busy} onSave={savePersonal} /></div><div><button className="rca-secondary" disabled={busy} onClick={()=>setComposerSource(null)}>入力をやめて戻る</button></div></>}
    {!personalOnly && !composerSource && <><section className="rca-panel"><h2>１ · 単勝オッズでグループを作る</h2><div className="rca-group-controls">
      <label>観測時点<select className={control} value={current?.id ?? ''} onChange={e => changeObservation(e.target.value)}>{observations.map(s => <option key={s.id} value={s.id}>{formatRaceTime(s.observedAt)} · 取得 {formatRaceTime(s.retrievedAt)}</option>)}</select></label>
      <label>自動で区切る倍率<input className={control} type="number" min="1.1" max="5" step="0.1" value={threshold} onChange={e => { classificationTouched.current=true;setThreshold(e.target.value); setBoundaries(null); setSlotChoice(null); setOverrides({}) }} /></label>
      <button className="rca-secondary" onClick={() => { classificationTouched.current=true;setBoundaries(null); setSlotChoice(null); setOverrides({}) }}>自動案に戻す</button>
    </div>
    {current&&current.id!==data.history[0]?.id&&<div role="status" className="rca-notice">新しい観測があります。<button className="rca-secondary ml-2" onClick={()=>changeObservation(data.history[0].id)}>最新の観測を表示</button></div>}
    {current&&!timing.eligible&&<span className="rca-pill">過去検証</span>}
    {!current&&<p className="rca-notice">実オッズの取得待ちです。</p>}
      {analysis.error && <p role="alert" className="rca-error">{analysis.error}</p>}
      {grouping&&<>{ace.error&&<p role="alert" className="rca-error">予想指標を表示できません。{ace.error}</p>}
      <div className="rca-group-controls"><label>カードから追加する券種<select className={control} value={quickType} onChange={e=>{setQuickType(e.target.value);setQuickChoice(null)}}>{['馬単','3連単','3連複'].map(type=><option key={type}>{type}</option>)}</select></label></div>
      <div className="rca-group-cards rca-group-prediction-cards">{grouping.groups.map(g=><GroupPredictionCard key={g.label} group={g} summary={groupProbabilities.find(s=>s.label===g.label)} assessments={ace.rows} returnUsable={ace.current?.id===current?.id} onOpen={openHorse} type={quickType} slots={quickSlots} ticketCount={quickTickets.length} onReview={()=>startPersonal({type:quickType,slots:quickSlots})} disabled={disabled||loading} onToggle={(position,label)=>setQuickChoice({basis:quickBasis,slots:quickSlots.map((slot,i)=>i===position?toggle(slot,label):slot)})} />)}</div>
      <section className="rca-card-prediction" aria-label="カードから選択した予想"><h3>予想に追加したグループ</h3><GroupSelectionNumbers grouping={grouping} slots={quickSlots} type={quickType} excluded={excluded} /><p aria-live="polite">{quickTickets.length}点</p><div className="flex flex-wrap gap-3"><button type="button" className="rca-primary" disabled={disabled||loading||!quickTickets.length} onClick={()=>startPersonal({type:quickType,slots:quickSlots})}>選択した内容で予想を入力</button><button type="button" className="rca-secondary" onClick={()=>setQuickChoice(null)}>選択を解除</button></div></section>
      {!grouping.complete && <p role="alert" className="rca-error">オッズ未取得：{grouping.missing.join('・')}番。全頭が揃うまで保存を保留します。</p>}
      <section className="rca-registration-panel" aria-label="グループの独立登録"><h3>結果に使うグループを登録</h3><p>全出走馬の所属を保存します。1〜3着の予想・買い目の登録とは別です。</p>
        <p aria-live="polite">{journal.loading?'登録グループを読み込み中…':registrationMatches(registered,current,grouping)?'表示中のグループは登録済みです。':registered?'変更は未登録です。結果には前回の登録を使っています。':'グループはまだ登録されていません。'}</p>
        <div className="flex flex-wrap gap-3"><button type="button" className="rca-primary" disabled={journal.loading||journal.busy||loading||Boolean(data.error)||Boolean(journal.error)||!grouping.complete||field.some(h=>h.cancelled)||registrationMatches(registered,current,grouping)} onClick={registerClassification}>{journal.busy?'登録中…':registered?'グループ登録を更新':'グループを登録'}</button>{onOpenResults&&<button type="button" className="rca-secondary" onClick={onOpenResults}>登録グループの結果を見る</button>}{journal.error&&<button type="button" className="rca-secondary" disabled={journal.loading||journal.busy} onClick={()=>{setError('');journal.refresh()}}>登録状態を再読込</button>}</div>
        {registered&&<RegisteredGroupSummary registration={registered} history={journal.registrations.filter(r=>r.race.id===String(race.id))}/>}
      </section>
      <h3 className="mt-6">グループをカスタマイズ</h3><div className="overflow-x-auto"><table className="rca-list-table rca-group-customize" aria-label="グループのカスタマイズ"><colgroup><col className="rca-cut-column"/><col/><col className="rca-odds-column"/><col className="rca-include-column"/></colgroup><thead><tr>{['区切り','群・馬番・馬名','単勝','候補'].map(t => <th key={t}>{t}</th>)}</tr></thead><tbody>{grouping.groups.flatMap(g => g.horses).map((h,i,rows) => <tr key={h.no}>
        <td><input type="checkbox" aria-label={`${h.no}番の前で区切る`} disabled={i === 0 || h.odds === rows[i-1]?.odds} checked={grouping.boundaries.includes(h.no)} onChange={() => { classificationTouched.current=true;setBoundaries(toggle(grouping.boundaries,h.no)); setSlotChoice(null); setOverrides({}) }} /></td>
        <th scope="row"><span className="rca-pill">{grouping.membership[h.no]}</span> <button type="button" className="rca-horse-name" aria-label={`${h.no}番 ${h.name}の詳細`} onClick={event=>openHorse(h.no,event)}>{h.no} {h.name}</button></th>
        <td>{h.odds.toFixed(1)}倍</td>
        <td><input type="checkbox" aria-label={`${h.no}番を候補に含める`} checked={!excluded.includes(h.no)} onChange={() => { setExcluded(toggle(excluded,h.no)); setOverrides({}) }} /></td>
      </tr>)}</tbody></table></div></>}
    </section>
    {grouping && <details className="rca-panel"><summary>以前の配分・購入記録機能</summary><h2>２ · 着順パターンと券種を比較する</h2><p className="rca-muted">初期選択は比較用です。システムが有利な着順を推奨したものではありません。</p>
      <div className="rca-group-slots">{analysis.slots.map((slot,i) => <fieldset key={i}><legend>{i+1}着のグループ</legend>{grouping.groups.map(g => <label key={g.label}><input type="checkbox" checked={slot.includes(g.label)} onChange={() => { setSlotChoice(analysis.slots.map((s,index) => index === i ? toggle(s,g.label) : s)); setOverrides({}) }} />{g.label}</label>)}</fieldset>)}</div>
      <div className="rca-group-controls"><label>１レースの予算上限<input className={control} type="number" min="0" max="10000" step="100" value={budget} onChange={e => setBudget(e.target.value)} /></label><label>１点の基本金額<input className={control} type="number" min="100" max="10000" step="100" value={unit} onChange={e => { setUnit(e.target.value); setOverrides({}) }} /></label></div>
      <div className="rca-group-cards">{analysis.alternatives.map(a => <label key={a.id} className={`rca-group-card ${variant === a.id ? 'rca-group-selected' : ''}`}><span><input type="radio" name="group-variant" checked={variant === a.id} onChange={() => { setVariant(a.id); setOverrides({}) }} /> {a.label}</span><strong>{a.tickets.length}点</strong><p>{a.type} · {yen(a.tickets.length*Number(unit))}</p><small>{a.slots.slice(0,a.type === '馬単' ? 2 : 3).map(s => s.join('・') || '未選択').join(a.type === '3連複' ? ' − ' : ' → ')}</small></label>)}</div>
      {analysis.selected&&<GroupSelectionNumbers grouping={grouping} slots={analysis.selected.slots} type={analysis.selected.type} excluded={excluded} />}
      <details><summary>組合せの実オッズを入力する</summary><p className="rca-muted">１行に「3連単 14-9-6 1085.8」などを入力。入力済みの実価格だけで払戻を試算します。</p>
        <label>価格の観測日時（日本時間）<input className={control} type="datetime-local" value={quoteObservedAt ? quoteObservedAt.slice(0,16) : ''} onChange={e => setQuoteObservedAt(e.target.value ? `${e.target.value}:00+09:00` : '')} /></label>
        <textarea className={`${control} mt-3 w-full`} aria-label="組合せの実オッズ" rows={4} value={quoteText} onChange={e => { setQuoteText(e.target.value); setQuoteRetrievedAt(new Date().toISOString()) }} />
      </details>
      <p className="rca-notice">期待回収率・的中確率は未算出です。以下は入力オッズで的中した場合の払戻で、期待値ではありません。</p>
      {analysis.totals && <><p className={analysis.totals.overBudget ? 'rca-error' : 'font-semibold'}>投入予定 {yen(analysis.totals.invested)} ／ 未使用 {yen(analysis.totals.unspent)}{analysis.totals.overBudget && ' · 予算超過のため保存できません'}</p><p className="rca-muted">価格取得 {analysis.totals.pricedCount}/{analysis.totals.allocations.length}点 · 的中時の最低払戻 {analysis.totals.minimumConditionalPayout == null ? '全買い目の価格待ち' : yen(analysis.totals.minimumConditionalPayout)}</p></>}
      <button className="rca-secondary my-3" disabled={!analysis.selected?.tickets.length || Number(budget) < analysis.selected.tickets.length*100} onClick={() => { setUnit(String(Math.floor(Number(budget)/analysis.selected.tickets.length/100)*100)); setOverrides({}) }}>予算内で均等に配分する</button>
      <details><summary>買い目ごとの金額を調整（{analysis.selected?.tickets.length ?? 0}点）</summary><div className="overflow-x-auto"><table className="rca-list-table" aria-label="グループ案の買い目"><thead><tr><th>買い目</th><th>金額</th><th>入力オッズ</th><th>的中時払戻</th></tr></thead><tbody>{analysis.selected?.tickets.map(t => {
        const amount = overrides[t.key] ?? Number(unit), q = analysis.quotes.find(q => ticketKey(q.type,q.numbers) === t.key)
        return <tr key={t.key}><th scope="row">{betLabel(t)}</th><td><input className={`${control} w-28`} type="number" aria-label={`${betLabel(t)}の金額`} min="0" max="10000" step="100" value={amount} onChange={e => setOverrides({ ...overrides,[t.key]:Number(e.target.value) })} /></td><td>{q ? `${q.odds}倍` : '未取得'}</td><td>{q ? yen(Math.floor(amount*q.odds)) : '未算出'}</td></tr>
      })}</tbody></table></div></details>
      <label className="block my-4">判断の根拠・不確かな点<textarea className={`${control} block w-full mt-2`} maxLength={4000} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap gap-3"><button className="rca-primary" disabled={disabled || analysis.totals?.overBudget || !analysis.totals?.allocations.length} onClick={() => freeze('plan')}>{busy ? '保存中…' : 'グループと比較案を固定保存'}</button><button className="rca-secondary" disabled={disabled} onClick={() => freeze('skip')}>見送りを固定保存</button></div>
      <p className="rca-muted mt-3">保存時刻が発走10分前を過ぎた場合や、価格の時刻証跡が不足する場合は過去検証です。保存は購入になりません。</p>
    </details>}
    </>}
    {!personalOnly&&<details><summary>以前の予想・購入記録を見る</summary>{records}</details>}
  </div></div></>
}

export function GroupPlanResult({ plan, outcome, receipt, ownerId }) {
  const result = reviewGroupPlan(plan,outcome)
  const verified = groupReceiptVerified(plan,receipt,{ userId:ownerId,raceId:plan.race.id,raceDate:plan.race.raceDate })
  return <div className="rca-notice"><p>{plan.mode === 'replay' ? '過去検証' : verified ? '締切前の受領確認済み' : '締切前記録・受領未確認'} · {plan.decision === 'skip' ? '見送り・購入案０円' : `${plan.allocations.length}点・投入予定 ${yen(plan.invested)}`}</p>
    <p>保存した着順：{plan.slots.slice(0,plan.variant==='exacta'?2:3).map(s => s.join('・') || '未選択').join(plan.variant==='trio'?' − ':' → ')} ／ 採用案：{({ ordered:'指定順の３連単',swapped:'２・３着入替の３連単',trio:'３連複',exacta:'馬単' })[plan.variant]}</p>
    {result ? <p>結果 {result.numbers.join('→')}（{result.groups}） ／ 候補に{plan.variant === 'exacta' ? '上位２頭' : '上位３頭'}：{result.candidatesCovered ? '含む' : '不足'} ／ 着順・券種：{result.formationCovered ? '範囲内' : '不一致'} ／ {plan.decision === 'skip' ? '見送り・的中集計の対象外' : `配分した買い目：${result.hit ? '的中' : '不的中'}`}</p> : <p>結果待ち・未照合。同着や異常着順は正式払戻で確認します。</p>}
  </div>
}
