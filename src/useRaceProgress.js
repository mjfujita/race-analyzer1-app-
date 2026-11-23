import {useEffect,useState} from 'react'
import {fetchRaceProgress} from './cloudStore.js'

export function useRaceClock(){
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),5000);return()=>clearInterval(timer)},[])
  return now
}

// Result checks do not block the independent, lightweight programme catalog.
export function useRaceProgress(date){
  const [state,setState]=useState({date:null,rows:[],loading:true,error:null})
  const [revision,setRevision]=useState(0)
  useEffect(()=>{
    if(!date)return
    let disposed=false,active=false,controller
    async function refresh(){
      if(disposed||active||document.hidden)return
      active=true;controller=new AbortController()
      const timeout=setTimeout(()=>controller.abort(),15000)
      setState(old=>({...old,loading:true,error:null}))
      try{
        const data=await fetchRaceProgress(date,controller.signal)
        if(data.raceDate!==date||!Array.isArray(data.races))throw new Error('結果の開催日を確認できません。')
        if(!disposed)setState({date,rows:data.races,loading:false,error:null})
      }catch(error){if(!disposed)setState(old=>({...old,loading:false,error:controller.signal.aborted?'結果の確認がタイムアウトしました。':error.message}))}
      finally{clearTimeout(timeout);active=false}
    }
    void refresh()
    const timer=setInterval(refresh,60000)
    document.addEventListener('visibilitychange',refresh)
    return()=>{disposed=true;controller?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh)}
  },[date,revision])
  return {...state,rows:state.date===date?state.rows:[],refresh:()=>setRevision(n=>n+1)}
}
