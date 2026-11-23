import {useCallback,useEffect,useRef,useState} from 'react'
import {deviceRequest} from './deviceAuth.js'
import {supabase} from './supabase.js'

// Only a successful server response may declare a device unapproved. A failed
// network check must not turn an existing approval into a registration prompt.
export function useDeviceSession() {
  const [session,setSession]=useState(null),[loading,setLoading]=useState(true)
  const [error,setError]=useState(''),[checking,setChecking]=useState(false)
  const refreshRef=useRef(null)
  const refresh=useCallback(()=>refreshRef.current?.(),[])
  useEffect(()=>{
    let active=true,pending=false,again=false,controller
    const check=async()=>{
      if(pending){again=true;return}
      pending=true
      if(active)setChecking(true)
      controller=new AbortController()
      let timeout
      try {
        const data=await Promise.race([
          deviceRequest(undefined,{}, {signal:controller.signal}),
          new Promise((_,reject)=>{timeout=setTimeout(()=>{
            controller.abort()
            reject(new Error('認証の確認がタイムアウトしました。'))
          },15000)}),
        ])
        if(active){setSession(data.session);setError('')}
      } catch {
        if(active)setError('通信の問題で端末の承認を確認できませんでした。再登録せず、確認を再試行してください。')
      } finally {
        clearTimeout(timeout)
        pending=false
        if(active){setLoading(false);setChecking(false)}
        if(again&&active){again=false;void check()}
      }
    }
    refreshRef.current=check
    void check()
    const visible=()=>{if(!document.hidden)void check()}
    const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setTimeout(()=>{if(active)void check()},0)})
    globalThis.addEventListener('race-device-session-changed',check)
    globalThis.addEventListener('online',visible)
    document.addEventListener('visibilitychange',visible)
    const interval=setInterval(visible,60000)
    return ()=>{
      active=false;refreshRef.current=null;controller?.abort();subscription.unsubscribe();clearInterval(interval)
      globalThis.removeEventListener('race-device-session-changed',check)
      globalThis.removeEventListener('online',visible)
      document.removeEventListener('visibilitychange',visible)
    }
  },[])
  return {session,setSession,loading,error,checking,refresh}
}
