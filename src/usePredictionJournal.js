import {useCallback,useEffect,useRef,useState} from 'react'
import {readJournal,writeJournal,journalDate,mergeJournal} from './predictionJournal.js'
import {fetchPredictionJournal,saveJournalRecord} from './cloudStore.js'
import {readGroupRegistrations,writeGroupRegistrations,mergeGroupRegistrations} from './groupRegistration.js'
import {saveGroupRegistration} from './cloudStore.js'
const empty={predictions:[],results:[]}
export function usePredictionJournal({userId,race,connected,revision}){
  const date=journalDate(race)
  const [registrations,setRegistrations]=useState([])
  const [data,setData]=useState(empty),[remote,setRemote]=useState({receipts:{},legacy:[],official:[]}),[error,setError]=useState(''),[message,setMessage]=useState(''),[loading,setLoading]=useState(false),[busy,setBusy]=useState(false)
  const scope=useRef(''),active=`${userId}:${date}`,saving=useRef(false)
  const refresh=useCallback(async()=>{
    scope.current=active;setError('');setLoading(true)
    try{
      const local=readJournal(localStorage,userId,date)
      const localGroups=readGroupRegistrations(localStorage,userId,date)
      if(scope.current===active){setData(local);setRegistrations(localGroups)}
      if(connected){
        const response=await fetchPredictionJournal(date)
        const merged=await writeJournal(localStorage,userId,date,mergeJournal(local,response))
        const groups=await writeGroupRegistrations(localStorage,userId,date,response.registrations??[])
        if(scope.current===active){setData(merged);setRegistrations(groups);setRemote(response)}
      }
    }catch(problem){if(scope.current===active)setError(problem.message)}
    finally{if(scope.current===active)setLoading(false)}
  },[userId,date,connected,active])
  useEffect(()=>{setData(empty);setRegistrations([]);setRemote({receipts:{},legacy:[],official:[]});refresh();return()=>{scope.current=''}},[refresh,revision])
  const save=async record=>{
    if(saving.current)throw new Error('保存処理中です。')
    saving.current=true;setBusy(true);setError('');setMessage('')
    let locallySaved=false
    try{
      // Serialize result corrections at the server before publishing a local result.
      // A stale second device can refresh and retry without poisoning its append-only cache.
      let receipt=null
      if(connected&&record.kind==='result'){
        mergeJournal(readJournal(localStorage,userId,date),{predictions:[],results:[record]})
        receipt=await saveJournalRecord(record)
      }
      const merged=await writeJournal(localStorage,userId,date,{predictions:record.kind==='selection'?[record]:[],results:record.kind==='result'?[record]:[]})
      locallySaved=true;setData(merged);setMessage('このブラウザに保存しました。')
      if(connected){
        receipt??=await saveJournalRecord(record)
        setRemote(old=>({...old,receipts:{...old.receipts,[record.id]:receipt.receivedAt}}));setMessage('クラウドにも保存しました。')
      }
    }catch(problem){
      setError(`${problem.message} ${locallySaved?'ブラウザの記録は保存済みです。「未同期の記録を再送」で同期できます。':'今回の登録は未完了です。入力内容を保持しています。再読込してから再送してください。'}`)
      if(!locallySaved)throw problem
    }
    finally{saving.current=false;setBusy(false)}
  }
  const registerGroups=async record=>{
    if(saving.current)throw new Error('保存処理中です。')
    saving.current=true;setBusy(true);setError('');setMessage('')
    try{
      mergeGroupRegistrations(readGroupRegistrations(localStorage,userId,date),[record])
      const receipt=connected?await saveGroupRegistration(record):null
      const groups=await writeGroupRegistrations(localStorage,userId,date,[record])
      setRegistrations(groups)
      if(receipt)setRemote(old=>({...old,receipts:{...old.receipts,[record.id]:receipt.receivedAt}}))
      setMessage(connected?'グループをクラウドに登録し、結果・集計に反映しました。':'グループをこのブラウザに登録し、結果・集計に反映しました。')
    }catch(problem){setError(`${problem.message} グループの登録は未完了です。設定は保持しています。`);throw problem}
    finally{saving.current=false;setBusy(false)}
  }
  const resend=async()=>{
    if(saving.current||!connected)return
    saving.current=true;setBusy(true);setError('')
    try{for(const record of registrations)await saveGroupRegistration(record);for(const record of [...data.predictions,...data.results])await saveJournalRecord(record);await refresh();setMessage('保存済み記録をクラウドへ同期しました。')}
    catch(problem){setError(problem.message)}finally{saving.current=false;setBusy(false)}
  }
  return {data,registrations,registerGroups,remote,error,message,loading,busy,save,refresh,resend,connected}
}
