import {useEffect,useRef} from 'react'
import {raceProgressState,summarizeRaceResult,progressTime} from './raceProgress.js'
import {useRaceClock} from './useRaceProgress.js'
import {formatRaceTime} from './raceTime.js'

export default function RaceOverview({race,horses=[],data,loading,error,onNavigate}){
  const title=useRef(null)
  useEffect(()=>{window.scrollTo({top:0,behavior:'instant'});title.current?.focus({preventScroll:true})},[race.id,race.raceDate])
  const now=useRaceClock(),result=summarizeRaceResult(data?.context,race,now),state=raceProgressState(race,result,now)
  return <div className="rca-stack">
    <section className="rca-panel" aria-label="レースの進行状況"><h2 ref={title} tabIndex={-1}>レース情報</h2><div className="flex flex-wrap gap-2 mt-3"><span className="rca-pill">{state.phase}</span><span className="rca-pill">{loading?'結果を確認中':error?'結果の状態を再確認':state.resultLabel}</span></div>
      <dl className="grid grid-cols-2 gap-3 mt-4"><div className="rounded-xl bg-slate-50 p-3"><dt className="rca-muted">判断締切（発走10分前）</dt><dd className="text-xl font-bold mt-2 tabular-nums">{progressTime(state.cutoffAt)}</dd></div><div className="rounded-xl bg-slate-50 p-3"><dt className="rca-muted">発走予定</dt><dd className="text-xl font-bold mt-2 tabular-nums">{progressTime(state.postAt)}</dd></div></dl>
      <p className="rca-muted mt-3">{state.phase==='発走時刻経過'?'発走予定時刻を経過しています。実際の発走・終了は時刻だけでは判定しません。':state.phase==='発走時刻未取得'?'発走時刻がないため判断締切も確認できません。':state.phase==='判断締切'?'事前予想の判断締切を過ぎています。以降の情報は参考・過去検証として確認できます。':'判断締切までは、取得した情報を確認して予想を保存できます。'}</p>
      {error&&<p role="alert" className="rca-error mt-3">{error} 上の「保存済みデータと同期」から再試行できます。</p>}
    </section>
    <section className="rca-panel" aria-label="取り込んだレース結果"><h2>レース結果</h2>{state.resultAvailable?<><ul className="mt-3 divide-y divide-slate-100">{result.places.map(p=><li key={p.horseNo} className="flex gap-3 py-3 text-sm"><strong>{p.rank}着</strong><span>{p.horseNo}番 {horses.find(h=>Number(h.no??h.horseNo)===p.horseNo)?.name??''}</span></li>)}</ul><p className="rca-muted mt-3">着順の取得 {formatRaceTime(result.retrievedAt)}。払戻・購入収支の反映は振り返りで確認します。</p></>:<p className="rca-muted mt-3">{loading?'取得済みの着順を確認しています。':error?'結果の取込状況は再確認が必要です。':result.state==='partial'?'着順の一部を取得しています。上位の着順が揃うまで反映待ちです。':result.state==='check-required'?'取得した着順に確認が必要です。':`確認できる上位着順はまだ取り込まれていません。上の「JRDBへ最新取得を依頼」で更新できます。`}</p>}</section>
    <section className="rca-panel" aria-label="このレースの分析を開く"><h2>このレースを確認する</h2><div className="grid grid-cols-2 gap-3 mt-4">{[['groups','グループ・買い目'],['ability','各馬の能力・パドック'],['anchors','軸候補'],['winOdds','オッズ推移'],['pace','展開・馬場'],['personal','私の予想']].map(([tab,label])=><button type="button" key={tab} className="rca-secondary text-left" onClick={()=>onNavigate(tab)}>{label} →</button>)}</div></section>
  </div>
}
