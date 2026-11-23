import {assessHorses,assessmentContext,horsePaddock,assessmentNumber} from './horseAssessment.js'
import {buildAbilityField} from './marketModel.js'
import {applyPredictionModels,buildRaceContext,availableAt} from './predictionModel.js'
import {createOutcomeModel} from './portfolio.js'
import {oddsMomentum} from './oddsMomentum.js'
import {readOddsHistory} from './oddsHistory.js'
import {decisionCutoff,raceDateISO,validTimestamp,snapshotTiming,formatRaceTime} from './raceTime.js'
import {calibrateForecast,reviewStack} from './forecastReview.js'

const pct=n=>`${(100*n).toFixed(1)}%`
const signed=n=>n>0?`+${n}`:String(n)
const styleCode=value=>({逃げ:1,先行:2,差し:3,追込:4})[value]??Number(value)
const normalizeGoing=value=>({1:'良',2:'稍重',3:'重',4:'不良',稍:'稍重'})[String(value??'').trim()]??String(value??'').trim()
const plain=value=>typeof value==='string'&&value.trim()?value.trim().slice(0,1000):null
const conditionText=(label,record)=>record.runs===null?`${label}：比較材料未取得。`:record.runs===0?`${label}：取得近走に該当走なし。`:`${label}：${record.runs}走中${record.topThree}回が3着内。`
const knownModel=(model,boundary)=>model&&validTimestamp(boundary)&&[model.generatedAt,model.adoptedAt??model.importedAt]
  .every(time=>validTimestamp(time)&&Date.parse(time)<=Date.parse(boundary))?model:null

/** Read-only ACE commentary. Uses protected inputs, existing model stack and explicit inference rules. */
export function buildAceAssessment({race,horses=[],statistics=[],cloud=null,events=[],model=null,runtimeModels=null,review=null,asOf=null,now=Date.now()}={}){
  const cutoffAt=decisionCutoff(race)
  const boundary=validTimestamp(cutoffAt)?new Date(Math.min(now,Date.parse(cutoffAt),validTimestamp(asOf)?Date.parse(asOf):now)).toISOString():null
  const assessments=assessHorses(race,horses.map(h=>({...h,cancelled:Boolean(h.cancelled||h.scratched)})),statistics,now)
  const byNo=new Map(assessments.map(h=>[h.no,h]))
  const stats=new Map(statistics.filter(s=>!s.race_key||String(s.race_key)===String(race?.id)).map(s=>[Number(s.horse_no),s]))
  // Recalculate conditions from dated earlier starts; do not trust undated aggregate records.
  const safeHorses=horses.map(h=>({...h,running_style:styleCode(byNo.get(Number(h.no))?.style)||Number(stats.get(Number(h.no))?.running_style)||null,
    pastRuns:(byNo.get(Number(h.no))?.pastRuns??[]).map(r=>({...r,weather:plain((h.pastRuns??[]).find(raw=>String(raw.raceDate??raw.race_date??raw.date??'').replace(/[^0-9]/g,'')===r.date)?.weather),field_size:r.fieldSize,dist:`${r.surface??''}${r.distance??''}m`}))}))
  const safeStatistics=assessments.map(h=>({...stats.get(h.no),horse_no:h.no,idm:h.idm,running_style:safeHorses.find(row=>Number(row.no)===h.no)?.running_style,
    distance_runs:h.records.distance.runs,distance_top3:h.records.distance.topThree,venue_runs:h.records.venue.runs,
    venue_top3:h.records.venue.topThree,course_runs:h.records.course.runs,course_top3:h.records.course.topThree}))
  const ability=buildAbilityField({race,horses:safeHorses,statistics:safeStatistics,model:knownModel(model,boundary)})
  const protectedContext=assessmentContext(race,cloud,{beforeCutoff:true,asOf,now})
  const source=protectedContext.source
  const tybs=(cloud?.observations??[]).filter(e=>e.kind==='TYB').map(e=>({...e.payload,retrievedAt:e.payload?.retrievedAt??e.retrievedAt}))
    .filter(row=>String(row.raceId)===String(race?.id)&&raceDateISO(row)===raceDateISO(race)&&availableAt(row,boundary))
    .sort((a,b)=>Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))
  const history=boundary?readOddsHistory('ace-protected',{storage:{getItem:()=>JSON.stringify(events)},asOf:boundary})
    .filter(s=>String(s.raceId)===String(race?.id)&&raceDateISO(s)===raceDateISO(race)):[]
  const current=history[0]??null
  const currentField=horses.filter(h=>!h.cancelled&&!h.scratched)
  const fullOdds=currentField.length>1&&currentField.every(h=>typeof current?.odds?.[h.no]==='number'&&current.odds[h.no]>=1)
  const pricesUsable=fullOdds&&snapshotTiming(current,race,{cutoffAt:boundary}).eligible
  const context=buildRaceContext({race,horses:safeHorses,statistics:safeStatistics,field:ability.field,
    observations:source?[{kind:'LIVE_RACE',payload:source}]:[],cutoffAt:boundary,
    earlierResults:(cloud?.race?.earlierResults??[]).filter(row=>availableAt(row,boundary))})
  const initial=applyPredictionModels({field:ability.field,race,odds:pricesUsable&&snapshotTiming(current,race).eligible?current.odds:{},history,context,
    models:knownModel(runtimeModels,boundary),cutoffAt:boundary,abilityModelId:ability.model.id})
  const features=initial.appliedFeatures?.filter(key=>runtimeModels?.contextModel?.coefficients[key]!==0)??[]
  const market=initial.field.some(h=>h.pM!=null)&&runtimeModels?.marketModel
  const stack=reviewStack({ability:ability.model.id,context:features.length?features.map(key=>runtimeModels.contextModel.coefficients[key]):null,
    features,market:market&&market.abilityWeight<1?[market.gamma,market.abilityWeight]:null})
  const prediction=calibrateForecast(initial,{review,stack,race,current,cutoffAt:boundary,now:boundary?Date.parse(boundary):now})
  const outcome=createOutcomeModel(prediction.field)
  const positions=new Map(prediction.field.map(h=>[h.no,[0,0,0]]))
  for(const o of outcome.outcomes)for(let i=0;i<o.order.length;i++)positions.get(o.order[i])[i]+=o.probability
  const predicted=new Map(prediction.field.map(h=>[h.no,h]))
  const momentum=oddsMomentum({race,field:ability.field,current,events,cutoffAt:boundary})
  const active=safeHorses.filter(h=>!h.cancelled&&!h.scratched)
  const styleCounts=[1,2,3,4].map(code=>active.filter(h=>h.running_style===code).length)
  const knownStyles=styleCounts.reduce((a,b)=>a+b,0)
  const isDebut=/新馬/.test(race?.name??'')
  const rows=assessments.map(h=>{
    const horse=horses.find(row=>Number(row.no)===h.no)??{},stat=stats.get(h.no)??{}
    const p=predicted.get(h.no),pos=positions.get(h.no),rank=p?1+prediction.field.filter(x=>x.probability>p.probability+1e-12).length:null
    const tyb=tybs.find(row=>Number(row.horseNo)===h.no)
    const padSources=[...(source?[{...horsePaddock(source,h.no),at:source.retrievedAt,label:'直前画面'}]:[]),
      ...(tyb?[{...horsePaddock({horses:[tyb]},h.no),at:tyb.retrievedAt,label:'TYB'}]:[])].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))
    const weightSource=padSources.find(p=>p.weight!==null),indexSource=padSources.find(p=>p.index!==null),commentSource=padSources.find(p=>p.comments.length)
    const pad={weight:weightSource?.weight??null,delta:weightSource?.delta??null,index:indexSource?.index??null,comments:commentSource?.comments??[]}
    const padOrigins=[...new Set([weightSource,indexSource,commentSource].filter(Boolean).map(p=>`${p.label} ${formatRaceTime(p.at)}`))].join(' ／ ')
    const move=momentum.rows.get(h.no),odds=pricesUsable?current.odds[h.no]:null
    const ownStyle=h.style??({1:'逃げ',2:'先行',3:'差し',4:'追込'})[safeHorses.find(row=>Number(row.no)===h.no)?.running_style]??null
    const rawTraining=assessmentNumber(stat.training_idx??horse.training_idx)
    const trainingComment=plain(horse.trainingComment??stat.training_comment)
    const carried=assessmentNumber(horse.weightCarried??horse.carriedWeight)
    const frame=assessmentNumber(horse.frameNo??horse.frame_no??stat.frame_no)
    const rider=plain(horse.jockey),trainer=plain(horse.trainer)
    const goingKnown=h.pastRuns.filter(r=>r.surface===contextRaceSurface(race)&&['良','稍重','重','不良'].includes(normalizeGoing(r.going))&&r.rank!==null)
    const goingRuns=source?.going?goingKnown.filter(r=>normalizeGoing(r.going)===normalizeGoing(source.going)):[]
    const supports=[],concerns=[]
    if(h.rank&&h.rank<=2)supports.push(`出走時IDMは${h.knownIdms}頭中${h.rank}位で、能力上位の比較材料です。`)
    else if(h.rank)concerns.push(`出走時IDMは${h.knownIdms}頭中${h.rank}位。上位馬を逆転するには別の裏付けが必要です。`)
    if(h.records.distance.runs>0&&h.records.distance.topThree>0)supports.push(conditionText('近い距離',h.records.distance))
    else if(h.records.distance.runs>0)concerns.push(`近い距離は${h.records.distance.runs}走で3着内なし。今回の条件での好走根拠は弱めです。`)
    if(h.records.course.topThree>0)supports.push(conditionText('同場同距離',h.records.course))
    if(h.history.runs<3)concerns.push(`比較できる近走は${h.history.runs}走。軸を固定するには材料が少ない状態です。`)
    if(move?.rising)supports.push(`単勝は比較元から${pct(-move.priceChange)}下落し、市場内の支持比率も上昇。ただし能力の上昇を証明するものではありません。`)
    if(!pricesUsable)concerns.push('時点と全頭を確認できる新しい単勝オッズがなく、投資妙味は判定保留です。')
    if(pad.weight===null||pad.index===null)concerns.push('パドック・馬体重の確認が一部不足しています。')
    if(isDebut)concerns.push('新馬戦のため、過去走に基づく軸判断を保留します。')
    const held=h.cancelled||horse.scratched||isDebut||!p||h.history.runs===0
    const role=h.cancelled||horse.scratched?'出走対象外':held?'軸判断を保留':rank<=2?'勝ち候補として比較':rank<=5?'上位の相手候補':'相手候補・評価慎重'
    const conclusion=h.cancelled||horse.scratched?'取消のため予想対象から除外します。':!p?'全頭の能力材料が揃わず、勝ち馬・着順の結論は保留します。'
      :isDebut?'IDMだけで勝ち切りを判断せず、過去走のない新馬戦は軸の固定を保留します。'
        :h.history.runs===0?`能力モデルでは${rank}位ですが、日付を確認できる過去走がありません。今回の適性を裏付けられず、軸判断は保留します。`
          :rank<=2?`能力・検証済み補正の勝率モデルでは${rank}位。1着候補に含めて比較しますが、1着固定の確実性は示せません。`
            :rank<=5?`勝率モデルでは${rank}位。まず2・3着の相手候補として比較し、1着に置くなら条件面の裏付けを確認します。`
              :`勝率モデルでは${rank}位。現状では軸の優先度を抑えます。高配当だけを理由に候補へ引き上げません。`
    const factors=[
      {key:'ability',label:'能力',known:h.idm!==null,text:h.summary},
      {key:'recent',label:'近走',known:h.history.runs>0,text:h.pastRuns.length?h.pastRuns.slice(0,3).map(r=>`${r.date} ${r.surface??'区分不明'}${r.distance??'距離不明'}m ${r.rank??'着順不明'}着${r.last3f!==null?`・上がり3F ${r.last3f}秒`:''}`).join(' ／ '):'日付を確認できる過去走なし。'},
      {key:'conditions',label:'今回の距離・コース・馬場',known:h.records.distance.runs>0||goingRuns.length>0,text:[conditionText('近い距離',h.records.distance),conditionText('同場同距離',h.records.course),source?.going?`今回の取得天候は${source.weather??'未取得'}、馬場は${source.going}。${goingKnown.length?`同区分・同馬場の取得近走は${goingRuns.length}走${goingRuns.length?`、3着内${goingRuns.filter(r=>r.rank<=3).length}回`:''}。`:'同馬場の比較材料は未取得。'}`:'今回の馬場状態は締切前情報未取得。'].join(' ')},
      {key:'pace',label:'脚質・展開',known:knownStyles===active.length&&Boolean(ownStyle),text:knownStyles?`脚質取得${knownStyles}/${active.length}頭。逃げ${styleCounts[0]}・先行${styleCounts[1]}・差し${styleCounts[2]}・追込${styleCounts[3]}。${ownStyle?`この馬は${ownStyle}。`:''}${styleCounts[0]+styleCounts[1]>1?'前の馬が競り合う場合と、隊列が落ち着く場合を分けて考えます。':'先手を取れるか、位置取りを確認する必要があります。'}脚質の頭数だけで有利不利を断定しません。当日同場・同区分で能力差と取得時点を確認できる先行レースは${context.evidence.dayBias.races}件です。`:'脚質構成の比較材料未取得。'},
      {key:'training',label:'調教',known:rawTraining!==null||Boolean(trainingComment),text:rawTraining!==null?`取得調教指数 ${rawTraining}。比較検証のない一律加点は行いません。${trainingComment??''}`:trainingComment??'調教指数・コメント未取得。好調と推測して補いません。'},
      {key:'paddock',label:'パドック・馬体',known:pad.index!==null||pad.weight!==null||pad.comments.length>0,text:[padOrigins?`取得元 ${padOrigins}。`:'',pad.weight===null?'馬体重未取得。':`馬体重${pad.weight}kg${pad.delta===null?'（増減未取得）':`（${signed(pad.delta)}kg）`}。`,pad.index===null?'パドック点未取得。':`JRDBパドック点${pad.index}。`,pad.comments.length?`取得コメント「${pad.comments.join(' ／ ')}」`:'コメント未取得。','数値や文面だけから良否を決めつけず、未検証の確率加算は行いません。'].join(' ')},
      {key:'market',label:'人気・オッズ推移',known:Boolean(pricesUsable&&p),text:odds?`単勝${odds}倍。${move?`比較元から${signed(Number((move.priceChange*100).toFixed(1)))}%、人気${move.previousRank}→${move.currentRank}位。`:'比較できる前時点なし。'}${p?`単勝の期待回収率試算${pct(p.probability*odds)}。`:''}人気だけで着順を固定しません。`:'利用時点までに取得した全頭の新しい単勝オッズなし。人気・妙味の評価は保留。'},
      {key:'connections',label:'枠・斤量・騎手・厩舎',known:frame!==null||carried!==null||Boolean(rider)||Boolean(trainer),text:`枠${frame??'未取得'} ／ 斤量${carried??'未取得'}${carried!==null?'kg':''} ／ 騎手${rider??'未取得'} ／ 厩舎${trainer??'未取得'}。比較実績・乗替わり効果の裏付けがなければ優劣は付けません。`},
    ]
    return {no:h.no,name:h.name,role,conclusion,rank,held,supports,concerns,factors,knownCount:factors.filter(f=>f.known).length,
      probabilities:!held&&pos?{win:pos[0],second:pos[1],third:pos[2],top3:pos.reduce((sum,n)=>sum+n,0)}:null,
      expectedReturn:!held&&p&&odds?p.probability*odds:null,contributions:p?[...(p.contributions??[]),...(p.contextContributions??[])]:[]}
  })
  const leaders=rows.filter(h=>!h.held&&h.rank<=2).sort((a,b)=>a.rank-b.rank||a.no-b.no)
  return {rows,boundary,cutoffAt,current:pricesUsable?current:null,source,model:ability.model,
    appliedFeatures:features,calibrationId:prediction.calibrationId??null,
    summary:leaders.length?`勝ち候補として比較するのは ${leaders.map(h=>`${h.no}番 ${h.name}`).join('、')}。取得した材料の懸念を確認し、着順固定と投資妙味は分けて判断します。`:'全頭の比較材料や過去走が足りず、今回の軸候補は判定保留です。',
    issues:[...ability.issues,...prediction.issues],version:'ace-evidence-review-v1'}
}
function contextRaceSurface(race){return ['ダ','ダート','2'].includes(String(race?.surface??race?.surfaceCode))?'ダート':['芝','1'].includes(String(race?.surface??race?.surfaceCode))?'芝':null}
