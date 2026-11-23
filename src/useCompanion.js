import { useCallback, useEffect, useRef, useState } from 'react'
import { applyCloudData, fetchCloudRace, syncLedgerToCloud } from './cloudStore.js'
import { readLedger, ledgerScope } from './forecastLedger.js'

export function useCompanion({ userId, race, horses }) {
  const [sync, setSync] = useState({ loading: false, error: null, data: null, revision: 0, syncedAt: null })
  const current = useRef({ userId, race, horses })
  const active = useRef(false)
  const pending = useRef(null)
  current.current = { userId, race, horses }
  const raceKey = race ? `${race.raceDate}:${race.id}` : ''
  const refresh = useCallback(async () => {
    if (active.current || !current.current.userId) return
    active.current = true
    const target = current.current
    setSync(previous => ({ ...previous, loading: true, error: null }))
    const controller=new AbortController();pending.current=controller
    let timeout
    try {
      const data = await Promise.race([fetchCloudRace(target.race,controller.signal),new Promise((_,reject)=>{
        timeout=setTimeout(()=>{controller.abort();reject(new Error('同期がタイムアウトしました。保存済みデータは保持しています。再度同期してください。'))},20000)
      })])
      clearTimeout(timeout)
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) return
      await applyCloudData(target.userId, target.race, target.horses, data)
      let receipts = data.receipts, groupReceipts = data.groupReceipts
      if (target.race) {
        const local = readLedger(localStorage, ledgerScope(target.userId, target.race))
        if (local.error) throw new Error(local.error)
        if (local.ledger.forecasts.length || local.ledger.groupPlans?.length) {
          const uploaded = await syncLedgerToCloud(local.ledger)
          receipts = { ...receipts,...uploaded.receipts }; groupReceipts = { ...groupReceipts,...uploaded.groupReceipts }
        }
      }
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) return
      setSync(previous => ({ ...previous, data: { ...data, receipts, groupReceipts }, error: null, loading: false,
        revision: previous.revision + 1, syncedAt: new Date().toISOString() }))
    } catch (error) {
      if (current.current.userId === target.userId && current.current.race?.id === target.race?.id && current.current.race?.raceDate === target.race?.raceDate) setSync(previous => ({ ...previous, loading: false, error: error.message }))
    }
    finally {
      clearTimeout(timeout);pending.current=null
      active.current = false
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) queueMicrotask(() => { void refresh() })
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60000)
    return () => {clearInterval(timer);pending.current?.abort()}
  }, [userId, raceKey, refresh])
  return { sync, refresh }
}
