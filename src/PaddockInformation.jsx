import {paddockAvailability} from './horseAssessment.js'
import {formatRaceTime} from './raceTime.js'
const signed=value=>value>0?`+${value}`:value===0?'±0':String(value)

export default function PaddockInformation({race,cloud,no,beforeCutoff,asOf}){
  const info=paddockAvailability(race,cloud,no,{beforeCutoff,asOf}),{paddock,context}=info
  const source=context.source
  return <section className="mt-4 border-t border-slate-100 pt-4" aria-label={`${no}番のパドック・直前情報`}>
    <h3 className="font-semibold text-sm">パドック・直前情報</h3>
    {info.lateFields.length>0&&<p className="rca-notice mt-3">{info.lateFields.join('・')}は{info.reason}に取得済みです（{formatRaceTime(info.latestSource.retrievedAt)}）。事前評価の対象外です。上の「最新の参考情報を表示」から確認できます。</p>}
    <dl className="grid grid-cols-2 gap-2 mt-2 text-sm"><div><dt className="text-xs text-slate-500">馬体重・増減</dt><dd className="font-semibold mt-1">{paddock.weight===null?info.weightMissing:`${paddock.weight}kg${paddock.delta===null?'（増減未取得）':`（${signed(paddock.delta)}kg）`}`}</dd></div><div><dt className="text-xs text-slate-500">JRDBパドック点</dt><dd className="font-semibold mt-1">{paddock.index===null?info.indexMissing:paddock.index}</dd></div></dl>
    <div className="text-sm mt-3"><p className="text-xs text-slate-500">パドック・返し馬コメント</p>{paddock.comments.length?paddock.comments.map((text,i)=><p key={i} className="mt-1 whitespace-pre-wrap break-words">{text}</p>):<p className="mt-1 text-slate-600">{info.commentMissing}</p>}</div>
    {info.latestCommentStatus&&<p className="rca-muted mt-2">最新取得（{formatRaceTime(info.latestSource.retrievedAt)}）のコメント確認：{info.latestCommentStatus}</p>}
    {source?.paddockCapture?.checkedAt&&<p className="rca-muted mt-2">コメント欄の確認：{formatRaceTime(source.paddockCapture.checkedAt)}</p>}
    <p className="rca-muted mt-3">{source?`直前情報を ${formatRaceTime(source.retrievedAt)} に取得。`:'この表示条件で確認できる直前情報はありません。'} 原文や点数を推測で補いません。更新は上部の「JRDBへ最新取得を依頼」から行えます。</p>
  </section>
}
