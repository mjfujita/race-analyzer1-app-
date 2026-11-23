import {useMemo,useState} from 'react'
import {readCloudRace} from './cloudStore.js'
import {useAceAssessment} from './useAceAssessment.js'
import AceHorseAssessment from './AceHorseAssessment.jsx'
import PaddockInformation from './PaddockInformation.jsx'
import {assessHorses,assessmentContext,paddockAvailability,venueNames} from './horseAssessment.js'
import {formatRaceTime,validTimestamp} from './raceTime.js'

const recordText=record=>record.runs===null?'比較材料未取得':record.runs?`${record.topThree}/${record.runs}走が3着内`:'該当走なし'
const runDate=date=>date.length===8?`${date.slice(0,4)}/${date.slice(4,6)}/${date.slice(6)}`:`${date.slice(0,4)}/${date.slice(4,6)}（日付未取得）`

export default function HorseAssessments({race,horses=[],statistics=[],userId,asOf=null,initialHorseNo='all',detail=false,cloudRevision=0,review=null}){
  const [selected,setSelected]=useState(String(initialHorseNo)),[beforeCutoff,setBeforeCutoff]=useState(true)
  const assessments=useMemo(()=>assessHorses(race,horses,statistics),[race,horses,statistics])
  // Read-only owner cache; the ACE analysis never adopts models or writes forecasts.
  const cloud=readCloudRace(userId,race)
  const context=assessmentContext(race,cloud,{beforeCutoff,asOf})
  const ace=useAceAssessment({race,horses,statistics,userId,cloudRevision,review,asOf})
  const source=context.source
  const sourceLabel=/^https?:\/\/(?:www\.)?jrdb\.com(?:\/|$)/i.test(source?.source??'')?'JRDB直前情報':'取得済み直前情報'
  const rows=assessments.filter(h=>selected==='all'||String(h.no)===selected).sort((a,b)=>a.no-b.no)
  return <section className="rca-stack" aria-label="各馬の評価">
    <div className="rca-panel"><h1 className="text-xl font-bold text-[#0B2545]">{detail&&rows.length===1?`${rows[0].no} ${rows[0].name}の詳細`:'各馬の能力・今回の評価'}</h1><p className="rca-muted mt-2">過去の実績、今回の条件、パドック・馬体重を1頭ずつ確認します。</p>
      <div className="flex flex-wrap items-center gap-4 mt-4"><label className="text-sm font-semibold flex flex-wrap items-center gap-2 min-w-0 max-w-full">表示する馬<select className="max-w-full min-w-0 rounded-lg border border-slate-300 p-2" value={selected} onChange={e=>setSelected(e.target.value)}><option value="all">全頭</option>{assessments.map(h=><option key={h.no} value={h.no}>{h.no} {h.name}</option>)}</select></label>
        <label className="text-sm flex gap-2 items-start"><input type="checkbox" className="mt-1" checked={beforeCutoff} onChange={e=>setBeforeCutoff(e.target.checked)} />発走10分前までに取得した直前情報のみ</label></div>
      <p className="rca-muted mt-3">直前情報の取得：{source?formatRaceTime(source.retrievedAt):'該当する記録なし'} ／ 判断締切：{formatRaceTime(context.cutoffAt)}</p>
      {beforeCutoff&&validTimestamp(asOf)&&<p className="rca-muted mt-1">選択オッズの取得時点 {formatRaceTime(asOf)} までの情報に限定しています。</p>}
      {source&&<p className="rca-muted mt-1">取得元：{sourceLabel} ／ 公開時刻：{formatRaceTime(source.sourcePublishedAt)}{source.weather?` ／ 天候 ${source.weather}`:''}{source.going?` ／ 馬場 ${source.going}`:''}</p>}
      {context.referenceOnly&&<p className="rca-notice mt-3">{context.afterCutoff?'締切後':'参照時点より後'}の参考情報を表示中です。事前評価・勝率の補正には使用しません。</p>}
      {beforeCutoff&&context.hasLater&&<p className="rca-muted mt-2">表示上限より後に取得した情報もあります。チェックを外すと参考情報として確認できます。<button type="button" className="rca-secondary ml-2" onClick={()=>setBeforeCutoff(false)}>最新の参考情報を表示</button></p>}
      <details className="mt-3 text-sm"><summary className="font-semibold text-sky-800 cursor-pointer">評価の読み方・対象範囲</summary><p className="rca-muted mt-2">今回の評価は、出走時IDMの相対順位と取得した近走の事実から作った説明です。IDMは高い値ほど上位、同値は同順位。実績はレース当日より前の直近最大5走で、同じ芝・ダート等の区分を比較します。近い距離は±200m、同場同距離は競馬場と距離が一致する走です。日付不明・同日以降の走は評価に使いません。距離実績やパドック点を機械的に加点せず、勝率・買い目は変更しません。</p></details>
    </div>
    <section className="rca-panel" aria-label="ACEのレース全体の見立て"><h2>ACEのレース全体の見立て</h2><p className="text-sm leading-relaxed mt-3">{ace.summary}</p>
      <p className="rca-muted mt-2">評価の参照上限：{formatRaceTime(ace.boundary)}。取得データと既存モデルによる自動分析です。文章は下記のルールで生成し、別の生成AIが原文を読んで採点したものではありません。</p>
      {ace.error&&<p role="alert" className="rca-error mt-2">{ace.error}</p>}
      <details className="mt-3"><summary className="text-sm font-semibold text-sky-800 cursor-pointer">ACE評価の方法と使用モデル</summary><p className="rca-muted mt-2">出走時IDMと日付を確認できる過去走を比較し、検証済みの補正だけを確率へ反映します。勝率モデル上位2頭を勝ち候補、3〜5位を上位の相手候補とする表示ルールです。同順位は同じ扱い。新馬戦・過去走なし・全頭の能力不足では軸判断を保留します。これは着順の統計的な判定基準ではありません。能力ページでは日付を確認できる過去走から条件実績を再集計するため、元の集計値や参照時点が異なる画面とは確率が変わる場合があります。パドックのチェックを外しても、締切後の参考情報はACE予想へ入りません。</p>
      <p className="rca-muted mt-2">モデル：{ace.model?.label??'未取得'} ／ {ace.model?.id??'—'}。当日補正：{ace.appliedFeatures?.length?ace.appliedFeatures.join('・'):'未適用'}。校正：{ace.calibrationId??'未適用'}。</p>
      <ul className="rca-muted mt-2 list-disc pl-5">{ace.issues?.map((issue,i)=><li key={i}>{issue}</li>)}</ul></details>
    </section>
    {!rows.length&&<p className="rca-panel rca-muted">出走馬の評価材料は未取得です。</p>}
    <div className="grid gap-4 xl:grid-cols-2">{rows.map(h=>{
      const acePaddock=paddockAvailability(race,cloud,h.no,{beforeCutoff:true,asOf:ace.boundary})
      return <article key={h.no} className="rca-panel min-w-0" aria-label={`${h.no}番 ${h.name}の評価`}>
        <header className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-bold text-[#0B2545]">{h.no} {h.name}</h2><p className="rca-muted mt-1">{h.cancelled?'出走取消':h.rank?`IDM ${h.idm} ／ ${h.rank}位（取得${h.knownIdms}/${h.activeCount}頭）`:'IDM未取得'}{h.style?` ／ 脚質 ${h.style}`:''}</p></div></header>
        <AceHorseAssessment assessment={ace.rows.find(a=>a.no===h.no)} paddockInfo={acePaddock} />
        <section className="mt-4 rounded-xl border border-blue-100 bg-blue-50/60 p-3"><h3 className="font-semibold text-sm text-[#0B2545]">今回の評価</h3><p className="text-sm leading-relaxed mt-2">{h.summary}</p><ul className="mt-2 text-xs text-slate-600 space-y-1">{h.warnings.map(text=><li key={text}>{text}</li>)}</ul></section>
        <section className="mt-4"><h3 className="font-semibold text-sm">過去の実績</h3><p className="text-sm mt-2">{h.history.runs?`取得した近走${h.history.runs}走：${h.history.first}勝・2着${h.history.second}回・3着${h.history.third}回`:'比較できる着順は未取得です。'}</p>
          <dl className="grid grid-cols-3 gap-2 mt-3 text-xs">{[['近い距離',h.records.distance],['同じ競馬場',h.records.venue],['同場同距離',h.records.course]].map(([label,value])=><div key={label} className="rounded-lg bg-slate-50 p-2"><dt className="text-slate-500">{label}</dt><dd className="font-semibold mt-1 break-words">{recordText(value)}</dd></div>)}</dl>
          <details className="mt-3 text-sm"><summary className="font-semibold text-sky-800 cursor-pointer">過去走の内訳（{h.pastRuns.length}走）</summary>{h.pastRuns.length?<div className="overflow-x-auto mt-2" role="region" aria-label={`${h.no}番の過去走`}><table className="rca-list-table text-xs whitespace-nowrap"><thead><tr>{['日付','競馬場・条件','馬場','着順','上がり3F'].map(label=><th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{h.pastRuns.map((run,i)=><tr key={`${run.date}:${i}`}><td>{runDate(run.date)}</td><td>{venueNames[run.placeCode]??'競馬場未取得'} {run.surface??'区分未取得'}{run.distance?`${run.distance}m`:''}</td><td>{run.going??'未取得'}</td><td>{run.rank??'未取得'}{run.fieldSize?`/${run.fieldSize}頭`:''}</td><td>{run.last3f===null?'未取得':`${run.last3f.toFixed(1)}秒`}</td></tr>)}</tbody></table></div>:<p className="rca-muted mt-2">当日より前の日付を確認できる過去走がありません。</p>}</details>
        </section>
        <PaddockInformation {...{race,cloud,beforeCutoff,asOf}} no={h.no} />
      </article>
    })}</div>
  </section>
}
