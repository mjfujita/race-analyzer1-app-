import { useMemo, useState } from 'react'
import { formationTickets, groupOdds } from './groupAnalysis.js'
import { personalMethods, personalSelection } from './personalGroupPrediction.js'
import { formatRaceTime, raceTimestamp } from './raceTime.js'
import {createPrediction} from './predictionJournal.js'
import GroupSelectionNumbers from './GroupSelectionNumbers.jsx'
import JournalHorseProbabilities from './JournalHorseProbabilities.jsx'
import GroupProbabilitySummary from './GroupProbabilitySummary.jsx'

const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm max-w-full'
const toggle = (list,value) => list.includes(value) ? list.filter(x => x !== value) : [...list,value]
const label = t => `${t.type} ${t.numbers.join(t.type === '3連複' ? '−' : '→')}`

export default function PersonalGroupComposer({ source, disabled, busy, onSave }) {
  const [type,setType] = useState(source.initialType??'馬単'), [method,setMethod] = useState('formation')
  const [slots,setSlots] = useState(()=>source.initialSlots?.map(s=>[...s])??[[],[],[]]), [box,setBox] = useState([])
  const [axis,setAxis] = useState(''), [opponents,setOpponents] = useState([]), [position,setPosition] = useState(0)
  const [memo,setMemo] = useState(''), [error,setError] = useState('')
  const grouping = useMemo(() => groupOdds(source.field,source.snapshot.odds,source.threshold,source.boundaries),[source])
  const analysis = useMemo(() => {
    const result={}
    try {
      const selection = personalSelection({grouping,type,method,slots,box,axis,opponents,position})
      const tickets = formationTickets(grouping,selection.slots,type,source.excluded)
      Object.assign(result,selection,{tickets})
      return {...selection,tickets}
    } catch (problem) { return {...result,error:problem.message} }
  },[grouping,type,method,slots,box,axis,opponents,position,source.excluded])
  const afterPost=Date.now()>=Date.parse(raceTimestamp(source.race,source.race.postTime))
  function groups(title,values,onChange) {
    return <fieldset className="rca-personal-choices"><legend>{title}</legend>{grouping.groups.map(g => <label key={g.label}><input type="checkbox" checked={values.includes(g.label)} onChange={() => {onChange(toggle(values,g.label))}} /><b>{g.label}</b><span>{g.horses.filter(h => !source.excluded.includes(h.no)).map(h => `${h.no} ${h.name}`).join(' ／ ') || '候補なし'}</span></label>)}</fieldset>
  }
  async function save() {
    setError('')
    try {
      const plan = createPrediction({...source,slots:analysis.slots,type,method,probabilities:source.probabilities,
        note:`${analysis.note}${memo.trim() ? `\n${memo.trim()}` : ''}`})
      await onSave(plan)
    } catch (problem) { setError(problem.message) }
  }
  return <section className="rca-panel rca-personal" aria-label="私の予想を入力">
    <h2>グループから買い目を登録</h2>
    <p className="rca-muted">ご自身の選択を記録します。グループを選ぶと、その中の馬を全て組み合わせます。同じ馬を重ねた買い目や重複は除きます。</p>
    <p className="rca-notice">入力の基準：観測 {formatRaceTime(source.snapshot.observedAt)} ／ 取得 {formatRaceTime(source.snapshot.retrievedAt)}。入力中に同期しても、このグループとオッズは変わりません。{source.excluded.length > 0 && ` 候補から除外：${source.excluded.join('・')}番。`}</p>
    {source.groupProbabilities?.length>0&&<details className="rca-personal-group-probabilities"><summary>グループの確率・中心馬を確認</summary><p className="rca-muted">入力開始時点の試算を表示しています。確率の参照上限：{formatRaceTime(source.probabilityBoundary)}。同期しても入力中は変わりません。</p>{source.groupProbabilities.map(summary=><div key={summary.label}><h3>{summary.label}群</h3><GroupProbabilitySummary summary={summary} /></div>)}<h3>各馬の着順確率</h3><JournalHorseProbabilities rows={source.probabilities?.horses} grouping={grouping}/></details>}
    <fieldset disabled={disabled || busy} className="rca-stack min-w-0">
      <div className="rca-group-controls"><label>券種<select aria-label="券種" className={control} value={type} onChange={e=>{setType(e.target.value);setPosition(0)}}>{['馬単','3連単','3連複'].map(t=><option key={t}>{t}</option>)}</select></label>
        <label>買い方<select aria-label="買い方" className={control} value={method} onChange={e=>{setMethod(e.target.value)}}>{Object.entries(personalMethods).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label></div>
      {method==='formation' && <div className="rca-personal-slots">{slots.slice(0,type==='馬単'?2:3).map((s,i)=><div key={i}>{groups(type==='3連複'?`${i+1}頭目のグループ`:`${i+1}着のグループ`,s,next=>setSlots(slots.map((old,index)=>index===i?next:old)))}</div>)}</div>}
      {method==='box' && groups('BOXにするグループ',box,setBox)}
      {method==='flow' && <><div className="rca-group-controls"><label>軸グループ<select aria-label="軸グループ" className={control} value={axis} onChange={e=>{setAxis(e.target.value)}}><option value="">選択してください</option>{grouping.groups.map(g=><option key={g.label}>{g.label}</option>)}</select></label>
        {type!=='3連複' && <label>軸の着順<select aria-label="軸の着順" className={control} value={position} onChange={e=>{setPosition(Number(e.target.value))}}>{Array.from({length:type==='馬単'?2:3},(_,i)=><option key={i} value={i}>{i+1}着</option>)}</select></label>}</div>
        <p className="rca-muted">軸グループから少なくとも1頭を含む買い方です。軸グループに複数頭いる場合、その全頭が軸候補になります。</p>
        <p className="rca-muted">軸の馬：{grouping.groups.find(g=>g.label===axis)?.horses.filter(h=>!source.excluded.includes(h.no)).map(h=>`${h.no} ${h.name}`).join(' ／ ') || '未選択'}</p>
        {groups('相手のグループ',opponents,setOpponents)}</>}
      {type==='3連複' && <p className="rca-muted">3連複は着順不問です。1〜3頭目の組み合わせから、異なる3頭を選びます。</p>}
      <GroupSelectionNumbers grouping={grouping} slots={analysis.slots} type={type} excluded={source.excluded} box={method==='box'} />
      {analysis.error && <p role="alert" className="rca-error">{analysis.error}</p>}
      <p className="rca-notice" aria-live="polite"><strong>{analysis.tickets?.length??0}点</strong> · 重複する馬・買い目は除外</p>
      <details open={Boolean(analysis.tickets?.length)}><summary>買い目を確認（{analysis.tickets?.length??0}点）</summary><div className="overflow-x-auto"><table className="rca-list-table" aria-label="私の予想の買い目"><thead><tr><th>買い目</th></tr></thead><tbody>{analysis.tickets?.map(t=><tr key={t.key}><th scope="row">{label(t)}</th></tr>)}</tbody></table></div></details>
      <label>予想メモ<textarea className={`${control} block w-full mt-2`} rows={3} maxLength={3500} placeholder="例：Bを勝ち候補、Aは2着。人気上位でも勝ち切れないと判断。" value={memo} onChange={e=>setMemo(e.target.value)} /></label>
      {error && <p role="alert" className="rca-error">{error}</p>}
      <button type="button" className="rca-primary self-start" disabled={!!analysis.error || !analysis.tickets?.length} onClick={save}>{busy?'登録中…':'私の予想を登録する'}</button>
    </fieldset>
    <p className="rca-muted mt-3">{afterPost?'発走後のため事後記録として残します。':'発走前の保存は、クラウドの受付時刻で確認します。'} グループ・馬番・買い目だけを記録します。購入額や配分は入力しません。</p>
  </section>
}
