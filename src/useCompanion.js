import { useCallback, useEffect, useRef, useState } from 'react'
import { applyCloudData, fetchCloudRace, syncLedgerToCloud } from './cloudStore.js'
import { readLedger, ledgerScope } from './forecastLedger.js'

export function useCompanion({ userId, race, horses }) {
  const [sync, setSync] = useState({ loading: false, error: null, data: null, revision: 0, syncedAt: null })
  const current = useRef({ userId, race, horses })
  const active = useRef(false)
  current.current = { userId, race, horses }
  const raceKey = race ? `${race.raceDate}:${race.id}` : ''
  const refresh = useCallback(async () => {
    if (active.current || !current.current.userId) return
    active.current = true
    const target = current.current
    setSync(previous => ({ ...previous, loading: true, error: null }))
    try {
      const data = await fetchCloudRace(target.race)
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) return
      await applyCloudData(target.userId, target.race, target.horses, data)
      let receipts
      if (target.race) {
        const local = readLedger(localStorage, ledgerScope(target.userId, target.race))
        if (local.error) throw new Error(local.error)
        if (local.ledger.forecasts.length) receipts = (await syncLedgerToCloud(local.ledger)).receipts
      }
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) return
      setSync(previous => ({ ...previous, data: { ...data, receipts }, error: null, loading: false,
        revision: previous.revision + 1, syncedAt: new Date().toISOString() }))
    } catch (error) {
      if (current.current.userId === target.userId && current.current.race?.id === target.race?.id && current.current.race?.raceDate === target.race?.raceDate) setSync(previous => ({ ...previous, loading: false, error: error.message }))
    }
    finally {
      active.current = false
      if (current.current.userId !== target.userId || current.current.race?.id !== target.race?.id || current.current.race?.raceDate !== target.race?.raceDate) queueMicrotask(() => { void refresh() })
    }
  }, [])
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { void refresh() }, 60000)
    return () => clearInterval(timer)
  }, [userId, raceKey, refresh])
  return { sync, refresh }
}
