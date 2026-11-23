import {useEffect,useRef,useState} from 'react'
import {fetchCaptureRequest,requestRaceCapture} from './cloudStore.js'
import {formatRaceTime} from './raceTime.js'

export default function CaptureControls({race,onSync,syncing,syncError}) {
  const [record,setRecord]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false)
  const current=useRef({onSync});current.current={onSync}
  const checkRef=useRef(null),finished=useRef(null)
  const command=record?.command
  const raceId=String(race.id),raceDate=String(race.raceDate).replaceAll('-','')
  useEffect(()=>{
    let disposed=false,checking=false,submitting=false,generation=0
    const target={id:raceId,raceDate}
    const pending=new Set()
    async function bounded(work){
      const controller=new AbortController();pending.add(controller)
      let timeout
      try{return await Promise.race([work(controller.signal),new Promise((_,reject)=>{
        timeout=setTimeout(()=>{controller.abort();reject(new Error('取得状況の確認がタイムアウトしました。通信を確認して再試行してください。'))},15000)
      })])}finally{clearTimeout(timeout);pending.delete(controller)}
    }
    async function accept(data){
      if(disposed)return
      if(data.command&&(data.command.raceId!==raceId||data.command.raceDate!==raceDate||!['pending','completed','failed','expired'].includes(data.command.status)))throw new Error('取得依頼のレースを確認できません。')
      setRecord(previous=>({...previous,...data}));setError('')
      if(data.command?.status==='completed'&&finished.current!==data.command.id){
        finished.current=data.command.id
        void current.current.onSync()
      }
    }
    async function check(){
      if(disposed||checking||submitting||document.hidden)return
      checking=true
      const version=++generation
      try{const data=await bounded(signal=>fetchCaptureRequest(target,signal));if(version===generation)await accept(data)}
      catch(problem){if(!disposed&&version===generation)setError(problem.message)}finally{checking=false}
    }
    async function submit(){
      if(disposed||submitting)return
      submitting=true;generation++
      setBusy(true);setError('')
      try{await accept(await bounded(signal=>requestRaceCapture(target,signal)))}
      catch(problem){if(!disposed)setError(problem.message)}finally{submitting=false;if(!disposed)setBusy(false)}
    }
    checkRef.current={check,submit}
    void check()
    const timer=setInterval(check,10000)
    document.addEventListener('visibilitychange',check)
    return()=>{disposed=true;checkRef.current=null;clearInterval(timer);pending.forEach(c=>c.abort());document.removeEventListener('visibilitychange',check)}
  },[raceId,raceDate])
  const messages={pending:'取得依頼を受け付けました。PCの取得ワーカーの処理待ちです。まだ最新データへの更新は完了していません。',
    completed:'JRDBの取得・クラウドへの送信が完了しました。保存済みデータを画面へ同期します。JRDB側のオッズ時刻が同じ場合、観測時点は変わりません。',
    failed:'取得に失敗しました。データ管理でMacのワーカーとJRDBのログイン状態を確認し、再度依頼してください。',
    expired:'取得依頼が5分以内に処理されませんでした。Macのワーカーが動いているか確認し、再度依頼してください。'}
  return <div className="mb-4 text-xs" aria-label="JRDBの最新取得状況">
    <div className="flex flex-wrap items-center gap-3"><button className="rca-secondary" disabled={busy||command?.status==='pending'} onClick={()=>checkRef.current?.submit()}>{busy?'取得を依頼中…':command?.status==='pending'?'PCの取得処理待ち…':'JRDBへ最新取得を依頼'}</button>
      <button className="rca-secondary" onClick={onSync} disabled={syncing}>{syncing?'同期中…':'保存済みデータと同期'}</button>
      {(error||command?.status==='pending')&&<button className="rca-secondary" onClick={()=>checkRef.current?.check()}>取得状況を確認</button>}</div>
    {command&&<p role={['failed','expired'].includes(command.status)?'alert':'status'} className="mt-3">{messages[command.status]}（依頼 {formatRaceTime(command.requestedAt)}）</p>}
    {record?.workerLastContactAt&&<p className="rca-muted mt-2">取得ワーカーの最終連絡：{formatRaceTime(record.workerLastContactAt)}</p>}
    {(error||syncError)&&<p role="alert" className="text-rose-700 mt-2">{error||syncError}</p>}
  </div>
}
