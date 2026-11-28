import {useMemo,useEffect,useState} from 'react'
import {usePredictionJournal} from './usePredictionJournal.js'
import {japanRaceDay} from './raceTime.js'
import {journalDate} from './predictionJournal.js'
import {workspaceLedgers} from './workspaceReview.js'
import {readCloudRace} from './cloudStore.js'
import PredictionJournalPanel from './PredictionJournalPanel.jsx'
import RaceGroupTrends from './RaceGroupTrends.jsx'
import {automaticResultGroups} from './automaticResultGroups.js'
import {readOddsHistory,oddsStorageKey} from './oddsHistory.js'
export default function RaceResultsWorkspace({userId,race,horses=[],cloudRevision=0,onSyncLedger,availableRaces=[],onOpenRace,onOpenPersonal,onOpenGroups}){
  const day=useMemo(()=>race??{id:'day',raceDate:japanRaceDay(Date.now())},[race])
  const journal=usePredictionJournal({userId,race:day,connected:Boolean(onSyncLedger),revision:cloudRevision})
  const [cache,setCache]=useState(()=>({ledgers:workspaceLedgers(userId),cloud:readCloudRace(userId,race)}))
  useEffect(()=>{setCache({ledgers:workspaceLedgers(userId),cloud:readCloudRace(userId,race)})},[userId,race,cloudRevision])
  const legacy=useMemo(()=>cache.ledgers.ledgers.filter(l=>l.scope.raceDate===journalDate(day)).flatMap(l=>l.groupPlans??[]),[cache.ledgers,day])
  const [view,setView]=useState('trends')
  const races=useMemo(()=>[...availableRaces,...(journal.remote.races??[]),...(race?[{...race,horses}]:[])],[availableRaces,journal.remote.races,race,horses])
  const automaticGroups=useMemo(()=>{
    const local=races.map(r=>{const cloud=String(r.id)===String(race?.id)?cache.cloud:readCloudRace(userId,r);return automaticResultGroups({...r,horses:cloud?.race?.horses??r.horses},readOddsHistory(oddsStorageKey(userId,r)),cloud?.observations??[])}).filter(Boolean)
    return [...new Map([...local,...(journal.remote.automaticGroups??[])].map(g=>[g.race.id,g])).values()]
  },[userId,races,journal.remote.automaticGroups,cache,race?.id])
  async function openRace(next){await onOpenRace(next);setView('comparison');requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}))}

  return <div className="rca-stack"><div className="rca-page-title"><div><h1>レース結果と予想</h1><p>今日の全レースをグループで並べ、着順の傾向を確認します。</p></div>{race&&onOpenPersonal&&<button className="rca-secondary" onClick={onOpenPersonal}>私の予想を開く</button>}</div>
    {cache.ledgers.errors.length>0&&<p role="alert" className="rca-error">{cache.ledgers.errors.join(' ')} 元の記録は保持しています。</p>}
    {journal.loading&&<p role="status" className="rca-notice">当日の全レース・結果を読み込み中です。</p>}{journal.error&&<p role="alert" className="rca-error">{journal.error}</p>}
    <div className="flex flex-wrap gap-3" aria-label="結果の表示切替"><button className={view==='trends'?'rca-primary':'rca-secondary'} onClick={()=>setView('trends')} aria-pressed={view==='trends'}>当日のグループ傾向</button><button className={view==='comparison'?'rca-primary':'rca-secondary'} disabled={!race} onClick={()=>setView('comparison')} aria-pressed={view==='comparison'}>選択レースの予想・照合</button><button className="rca-secondary" disabled={journal.loading||journal.busy} onClick={journal.refresh}>結果一覧を再読込</button></div>
    {view==='trends'?<RaceGroupTrends key={journalDate(day)} raceDate={journalDate(day)} races={races} registrations={journal.registrations} results={journal.data.results} official={journal.remote.official??[]} automaticGroups={automaticGroups} predictions={journal.data.predictions} receipts={journal.remote.receipts} onOpenRace={onOpenRace?openRace:undefined} loading={journal.loading}/>:race&&<PredictionJournalPanel journal={journal} race={race} field={horses.map(h=>({no:Number(h.no),name:h.name??''}))} legacy={legacy} cloud={cache.cloud} availableRaces={races} onOpenRace={onOpenRace} onOpenGroups={onOpenGroups}/>}
  </div>
}
