import { readLedger, summarizeLedger } from './forecastLedger.js'
import { SINGLE_ANCHOR_METHOD } from './anchorAssessment.js'

export function workspaceLedgers(userId, storage = globalThis.localStorage) {
  const prefix = `race-forecast-ledger:v1:${encodeURIComponent(userId)}:`
  const ledgers = [], errors = []
  try {
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i)
      if (!key?.startsWith(prefix)) continue
      try {
        const [,date,encodedId] = key.slice(prefix.length).match(/^(\d{8}):(.+)$/) ?? []
        if (!date) throw new Error('保存キーの形式を確認できません。')
        const result = readLedger(storage, { userId, raceDate: date, raceId: decodeURIComponent(encodedId) })
        if (result.error) throw new Error(result.error)
        ledgers.push(result.ledger)
      } catch (error) { errors.push(error.message) }
    }
  } catch { errors.push('ブラウザの保存領域を読み込めません。元記録は保持しています。') }
  return { ledgers: ledgers.sort((a,b) => b.scope.raceDate.localeCompare(a.scope.raceDate)), errors }
}

export function workspaceReview(ledgers, review, receipts = {}) {
  let invested = 0, payout = 0, resolved = 0, hits = 0
  const rows = ledgers.map(ledger => {
    const choices = [...ledger.forecasts].reverse().filter(f => f.parameters.anchorSelection?.method === SINGLE_ANCHOR_METHOD)
    const isVerified = forecast => {
      const receipt = receipts[forecast?.id]
      return forecast?.mode === 'live' && receipt?.ownerId === ledger.scope.userId
        && receipt?.raceId === ledger.scope.raceId && receipt?.raceDate === ledger.scope.raceDate
        && receipt?.forecastId === forecast.id && Number.isFinite(Date.parse(receipt.receivedAt))
        && Date.parse(receipt.receivedAt) >= Date.parse(forecast.createdAt)
        && Date.parse(receipt.receivedAt) <= Date.parse(forecast.cutoffAt)
    }
    const formal = choices.filter(f => isVerified(f) && ['selected','skip'].includes(f.parameters.anchorSelection.decision))
      .sort((a,b) => Date.parse(receipts[b.id].receivedAt) - Date.parse(receipts[a.id].receivedAt))
    // Later retrospective trials cannot replace the last receipted prerace decision.
    const forecast = formal[0] ?? choices[0]
    const totals = summarizeLedger(ledger)
    invested += totals.settledInvested; payout += totals.payout
    const selection = forecast?.parameters.anchorSelection
    const horse = forecast?.field.find(h => h.no === selection?.selected)
    const outcome = review?.races?.find(r => r.raceId === ledger.scope.raceId && r.raceDate.replaceAll('-','') === ledger.scope.raceDate)
    const sameField = forecast && outcome?.field?.length === forecast.field.length && forecast.field.every(h => outcome.field.some(r => r.no === h.no))
    const verified = isVerified(forecast)
    const rank = sameField && outcome?.state === 'matched' ? outcome.field.find(h => h.no === horse?.no)?.rank : null
    if (verified && selection?.decision === 'selected' && Number.isInteger(rank)) { resolved++; if (rank <= 3) hits++ }
    return { ledger, forecast, selection, horse, rank, verified, totals, outcome }
  })
  return { rows, resolved, hits, top3Rate: resolved ? hits / resolved : null, returnRate: invested ? payout / invested : null }
}
