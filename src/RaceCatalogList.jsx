import {useState} from 'react'
import {ChevronRight} from 'lucide-react'
import {raceProgressState,progressTime} from './raceProgress.js'
import {useRaceClock,useRaceProgress} from './useRaceProgress.js'
import {formatRaceTime} from './raceTime.js'

export default function RaceCatalogList({groups,date,onOpen}){
  const now=useRaceClock(),progress=useRaceProgress(date)
  const [opening,setOpening]=useState(null),[error,setError]=useState('')
  async function open(row){
    setOpening(row.race_key);setError('')
    try{await onOpen(row)}catch(problem){setError(problem.message)}finally{setOpening(null)}
  }
  return <div className="space-y-3">
    <p className="rca-muted">レースを押すと、時刻・結果と各分析への入口をまとめたレース情報を開きます。判断締切は発走10分前です。</p>
    {progress.loading&&<p role="status" className="rca-muted">結果の取込状況を確認しています…</p>}
    {progress.error&&<div role="alert" className="rca-error">結果の取込状況を確認できません。{progress.error}<button type="button" className="rca-secondary ml-2" onClick={progress.refresh}>結果の状態を再取得</button></div>}
    {error&&<p role="alert" className="rca-error">{error}</p>}
    <div className="grid gap-4 md:grid-cols-[repeat(auto-fit,minmax(260px,1fr))]">{groups.map(group=><section key={group.place_code} aria-label={`${group.place}のレース一覧`} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
      <header className="px-4 py-3 bg-[#0B2545] text-white flex items-center justify-between"><h2 className="font-bold tracking-wide">{group.place}</h2><span className="text-xs text-slate-300">{group.items.length}R</span></header>
      <div className="divide-y divide-slate-100">{group.items.map(row=>{
        const current=progress.rows.find(r=>r.id===row.race_key),result=current?.result
        const race={id:row.race_key,raceDate:date,postTime:current?.postTime??row.post_time},state=raceProgressState(race,result,now)
        return <button key={row.race_key} type="button" aria-label={`${group.place}${row.race_no}R ${row.race_name}のレース情報`} aria-busy={opening===row.race_key} disabled={Boolean(opening)} onClick={()=>open(row)} className="w-full text-left px-4 py-3 hover:bg-slate-50 focus-visible:outline-sky-600 disabled:opacity-60 flex items-start gap-3 min-h-24">
          <span className="shrink-0 w-9 text-center"><span className="block text-sm font-bold text-[#0B2545] tabular-nums">{row.race_no}R</span><span className="block text-[11px] text-slate-500 tabular-nums">{progressTime(state.postAt)}</span></span>
          <span className="flex-1 min-w-0"><span className="block text-sm font-semibold text-slate-800 break-words">{row.race_name}</span><span className="block text-xs text-slate-500 mt-1">{row.surface}{row.distance}m ・ {row.field_size}頭</span>
            <span className="flex flex-wrap gap-1.5 mt-2"><span className="rounded-md bg-slate-100 text-slate-700 px-2 py-1 text-[11px] font-semibold">{state.phase}</span><span className={`rounded-md px-2 py-1 text-[11px] font-semibold ${state.resultAvailable?'bg-emerald-50 text-emerald-800':'bg-amber-50 text-amber-900'}`}>{progress.error?'結果の状態を再確認':state.resultLabel}</span></span>
            <span className="block text-[11px] text-slate-600 tabular-nums mt-2">判断締切 {progressTime(state.cutoffAt)} ／ 発走 {progressTime(state.postAt)}</span>
            {result?.retrievedAt&&<span className="block text-[11px] text-slate-500 mt-1">結果確認 {formatRaceTime(result.retrievedAt)}</span>}
            <span className="block text-xs font-semibold text-sky-800 mt-2">{opening===row.race_key?'読み込み中…':'レース情報を見る'}</span>
          </span><ChevronRight aria-hidden="true" className="w-4 h-4 text-slate-400 self-center shrink-0" />
        </button>
      })}</div>
    </section>)}</div>
  </div>
}
