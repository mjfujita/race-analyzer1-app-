import {useCallback,useEffect,useState} from 'react'
import {fetchRaceCatalog} from './cloudStore.js'

// Keep the archive independent of dashboard requests cancelled during navigation.
export function useRaceCatalog(userId) {
  const [catalog,setCatalog]=useState({data:null,loading:true,error:null})
  const [revision,setRevision]=useState(0)
  const refreshCatalog=useCallback(()=>setRevision(value=>value+1),[])
  useEffect(()=>{
    if(!userId)return
    let disposed=false,busy=false,pending=null
    async function refresh(){
      if(disposed||busy||document.hidden)return
      busy=true
      const controller=new AbortController();pending=controller
      const timeout=setTimeout(()=>controller.abort(),15000)
      setCatalog(previous=>({...previous,loading:true,error:null}))
      try{
        const data=await fetchRaceCatalog(controller.signal)
        if(!disposed)setCatalog({data,loading:false,error:null})
      }catch(error){
        if(!disposed)setCatalog(previous=>({...previous,loading:false,error:controller.signal.aborted?'開催一覧の取得に時間がかかっています。再取得してください。':error.message}))
      }finally{clearTimeout(timeout);busy=false;pending=null}
    }
    void refresh()
    const timer=setInterval(refresh,60000)
    document.addEventListener('visibilitychange',refresh)
    globalThis.addEventListener('focus',refresh)
    return()=>{disposed=true;pending?.abort();clearInterval(timer);document.removeEventListener('visibilitychange',refresh);globalThis.removeEventListener('focus',refresh)}
  },[userId,revision])
  return {catalog,refreshCatalog}
}
