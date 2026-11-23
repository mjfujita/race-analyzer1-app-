import { useMemo, useState } from 'react'
import { createGroupPlan, formationTickets, groupBudget, groupOdds } from './groupAnalysis.js'
import { personalMethods, personalSelection } from './personalGroupPrediction.js'
import { formatRaceTime, snapshotTiming } from './raceTime.js'
import GroupSelectionNumbers from './GroupSelectionNumbers.jsx'

const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm max-w-full'
const yen = n => `${n.toLocaleString('ja-JP')}円`
const toggle = (list,value) => list.includes(value) ? list.filter(x => x !== value) : [...list,value]
const label = t => `${t.type} ${t.numbers.join(t.type === '3連複' ? '−' : '→')}`

export default function PersonalGroupComposer({ source, disabled, busy, onSave }) {
  const [type,setType] = useState('馬単'), [method,setMethod] = useState('formation')
  const [slots,setSlots] = useState([[],[],[]]), [box,setBox] = useState([])
  const [axis,setAxis] = useState(''), [opponents,setOpponents] = useState([]), [position,setPosition] = useState(0)
  const [budget,setBudget] = useState('10000'), [unit,setUnit] = useState('100'), [overrides,setOverrides] = useState({})
  const [memo,setMemo] = useState(''), [error,setError] = useState('')
  const grouping = useMemo(() => groupOdds(source.field,source.snapshot.odds,source.threshold,source.boundaries),[source])
  const analysis = useMemo(() => {
    const result={}
    try {
      const selection = personalSelection({grouping,type,method,slots,box,axis,opponents,position})
      const tickets = formationTickets(grouping,selection.slots,type,source.excluded)
      Object.assign(result,selection,{tickets})
      return { ...selection,tickets,totals:groupBudget(tickets,Number(budget),Number(unit),overrides) }
    } catch (problem) { return {...result,error:problem.message} }
  },[grouping,type,method,slots,box,axis,opponents,position,source.excluded,budget,unit,overrides])
  const timing = snapshotTiming(source.snapshot,source.race)
  const cutoffPassed = !timing.eligible || Date.now() > Date.parse(timing.cutoffAt ?? '')
  function groups(title,values,onChange) {
    return <fieldset className="rca-personal-choices"><legend>{title}</legend>{grouping.groups.map(g => <label key={g.label}><input type="checkbox" checked={values.includes(g.label)} onChange={() => {onChange(toggle(values,g.label));setOverrides({})}} /><b>{g.label}</b><span>{g.horses.filter(h => !source.excluded.includes(h.no)).map(h => `${h.no} ${h.name}`).join(' ／ ') || '候補なし'}</span></label>)}</fieldset>
  }
  async function save() {
    setError('')
    try {
      const plan = createGroupPlan({...source,slots:analysis.slots,variant:analysis.variant,budget:Number(budget),unit:Number(unit),overrides,
        note:`${analysis.note}${memo.trim() ? `\n${memo.trim()}` : ''}`,decision:'plan'})
      await onSave(plan)
    } catch (problem) { setError(problem.message) }
  }
  return <section className="rca-panel rca-personal" aria-label="私の予想を入力">
    <h2>グループから買い目を登録</h2>
    <p className="rca-muted">ご自身の選択を記録します。グループを選ぶと、その中の馬を全て組み合わせます。同じ馬を重ねた買い目や重複は除きます。</p>
    <p className="rca-notice">入力の基準：観測 {formatRaceTime(source.snapshot.observedAt)} ／ 取得 {formatRaceTime(source.snapshot.retrievedAt)}。入力中に同期しても、このグループとオッズは変わりません。{source.excluded.length > 0 && ` 候補から除外：${source.excluded.join('・')}番。`}</p>
    <fieldset disabled={disabled || busy} className="rca-stack min-w-0">
      <div className="rca-group-controls"><label>券種<select aria-label="券種" className={control} value={type} onChange={e=>{setType(e.target.value);setPosition(0);setOverrides({})}}>{['馬単','3連単','3連複'].map(t=><option key={t}>{t}</option>)}</select></label>
        <label>買い方<select aria-label="買い方" className={control} value={method} onChange={e=>{setMethod(e.target.value);setOverrides({})}}>{Object.entries(personalMethods).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
      {method==='formation' && <div className="rca-personal-slots">{slots.slice(0,type==='馬単'?2:3).map((s,i)=><div key={i}>{groups(type==='3連複'?`${i+1}頭目のグループ`:`${i+1}着のグループ`,s,next=>setSlots(slots.map((old,index)=>index===i?next:old)))}</div>)}</div>}
      {method==='box' && groups('BOXにするグループ',box,setBox)}
      {method==='flow' && <><div className="rca-group-controls"><label>軸グループ<select aria-label="軸グループ" className={control} value={axis} onChange={e=>{setAxis(e.target.value);setOverrides({})}}><option value="">選択してください</option>{grouping.groups.map(g=><option key={g.label}>{g.label}</option>)}</select></label>
        {type!=='3連複' && <label>軸の着順<select aria-label="軸の着順" className={control} value={position} onChange={e=>{setPosition(Number(e.target.value));setOverrides({})}}>{Array.from({length:type==='馬単'?2:3},(_,i)=><option key={i} value={i}>{i+1}着</option>)}</select></label>}</div>
        <p className="rca-muted">軸グループから少なくとも1頭を含む買い方です。軸グループに複数頭いる場合、その全頭が軸候補になります。</p>
        <p className="rca-muted">軸の馬：{grouping.groups.find(g=>g.label===axis)?.horses.filter(h=>!source.excluded.includes(h.no)).map(h=>`${h.no} ${h.name}`).join(' ／ ') || '未選択'}</p>
        {groups('相手のグループ',opponents,setOpponents)}</>}
      {type==='3連複' && <p className="rca-muted">3連複は着順不問です。1〜3頭目の組み合わせから、異なる3頭を選びます。</p>}
      <GroupSelectionNumbers grouping={grouping} slots={analysis.slots} type={type} excluded={source.excluded} box={method==='box'} />
      <div className="rca-group-controls"><label>予定予算の上限<input className={control} type="number" min="100" max="10000" step="100" value={budget} onChange={e=>setBudget(e.target.value)} /></label>
        <label>1点の予定金額<input className={control} type="number" min="100" max="10000" step="100" value={unit} onChange={e=>{setUnit(e.target.value);setOverrides({})}} /></label>
        <button type="button" className="rca-secondary" disabled={!analysis.tickets?.length || !Number.isInteger(Number(budget)) || Number(budget)%100!==0 || Number(budget)>10000 || Number(budget)<analysis.tickets.length*100} onClick={()=>{setUnit(String(Math.floor(Number(budget)/analysis.tickets.length/100)*100));setOverrides({})}}>予算内で均等配分</button></div>
      {analysis.error && <p role="alert" className="rca-error">{analysis.error}</p>}
      {analysis.totals && <div className="rca-notice" aria-live="polite"><strong>{analysis.totals.allocations.length}点 ／ 投入予定 {yen(analysis.totals.invested)}</strong><p>予算上限 {yen(Number(budget))} ／ 未使用 {yen(analysis.totals.unspent)}</p>{analysis.totals.overBudget && <p role="alert" className="rca-error">予算を超えています。グループか金額を調整してください。</p>}{!analysis.tickets.length && <p>グループを選んでください。異なる馬の組み合わせが必要です。</p>}</div>}
      <details open={Boolean(analysis.tickets?.length)}><summary>買い目と金額を確認・調整（{analysis.tickets?.length ?? 0}点）</summary><p className="rca-muted">100円単位で調整できます。0円の買い目は登録から除きます。表示は先頭100点までです。</p><div className="overflow-x-auto"><table className="rca-list-table" aria-label="私の予想の買い目"><thead><tr><th>買い目</th><th>予定金額</th></tr></thead><tbody>{analysis.tickets?.slice(0,100).map(t=><tr key={t.key}><th scope="row">{label(t)}</th><td><input className={`${control} w-28`} aria-label={`${label(t)}の予定金額`} type="number" min="0" max="10000" step="100" value={overrides[t.key]??unit} onChange={e=>setOverrides({...overrides,[t.key]:Number(e.target.value)})} /></td></tr>)}</tbody></table></div></details>
      <label>予想メモ<textarea className={`${control} block w-full mt-2`} rows={3} maxLength={3500} placeholder="例：Bを勝ち候補、Aは2着。人気上位でも勝ち切れないと判断。" value={memo} onChange={e=>setMemo(e.target.value)} /></label>
      {error && <p role="alert" className="rca-error">{error}</p>}
      <button type="button" className="rca-primary self-start" disabled={!!analysis.error || !analysis.totals?.allocations.length || analysis.totals.overBudget} onClick={save}>{busy?'登録中…':'私の予想を登録する'}</button>
    </fieldset>
    <p className="rca-muted mt-3">{cutoffPassed?'過去検証として登録します。':'保存時にも発走10分前の締切と取得時刻を確認します。'} 登録は予定の記録です。購入した場合は下の「実購入・払戻」で記録できます。</p>
  </section>
}
