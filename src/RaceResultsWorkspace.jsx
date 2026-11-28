import {useMemo,useEffect,useState} from 'react'
import {usePredictionJournal} from './usePredictionJournal.js'
import {japanRaceDay} from './raceTime.js'
import {journalDate} from './predictionJournal.js'
import {journalPlans} from './racePredictionResults.js'
import {workspaceLedgers} from './workspaceReview.js'
import {readCloudRace} from './cloudStore.js'
import PredictionJournalPanel from './PredictionJournalPanel.jsx'
import RacePredictionResultsList from './RacePredictionResultsList.jsx'
export default function RaceResultsWorkspace({userId,race,horses=[],cloudRevision=0,onSyncLedger,availableRaces=[],onOpenRace,onOpenPersonal}){
  const day=race??{id:'day',raceDate:japanRaceDay(Date.now())}
  const journal=usePredictionJournal({userId,race:day,connected:Boolean(onSyncLedger),revision:cloudRevision})
  const [cache,setCache]=useState(()=>({ledgers:workspaceLedgers(userId),cloud:readCloudRace(userId,race)}))
  useEffect(()=>{setCache({ledgers:workspaceLedgers(userId),cloud:readCloudRace(userId,race)})},[userId,race,cloudRevision])
  const legacy=useMemo(()=>cache.ledgers.ledgers.filter(l=>l.scope.raceDate===journalDate(day)).flatMap(l=>l.groupPlans??[]),[cache.ledgers,day])
  const plans=journalPlans(journal,legacy)
  const races=[...availableRaces,...(journal.remote.races??[])]
  return <div className="rca-stack"><div className="rca-page-title"><div><h1>レース結果と予想</h1><p>保存したグループ・馬番と実際の着順を並べて確認します。</p></div>{race&&onOpenPersonal&&<button className="rca-secondary" onClick={onOpenPersonal}>私の予想を開く</button>}</div>
    {cache.ledgers.errors.length>0&&<p role="alert" className="rca-error">{cache.ledgers.errors.join(' ')} 元の記録は保持しています。</p>}
    {race?<PredictionJournalPanel journal={journal} race={race} field={horses.map(h=>({no:Number(h.no),name:h.name??''}))} legacy={legacy} cloud={cache.cloud} availableRaces={races} onOpenRace={onOpenRace}/>:<>
      {journal.loading&&<p role="status" className="rca-notice">当日の予想・結果を読み込み中です。</p>}{journal.error&&<p role="alert" className="rca-error">{journal.error}</p>}
      <button className="rca-secondary self-start" disabled={journal.loading} onClick={journal.refresh}>結果一覧を再読込</button>
      <RacePredictionResultsList raceDate={journalDate(day)} races={races} plans={plans} results={journal.data.results} official={journal.remote.official??[]} onOpenRace={onOpenRace} loading={journal.loading}/>
    </>}
  </div>
}
