import { decisionCutoff, raceTimestamp, snapshotTiming, validTimestamp } from './raceTime.js'
import { ticketKey } from './portfolio.js'

export const GROUP_METHOD = 'odds-gap-v1'
const clone = value => JSON.parse(JSON.stringify(value))
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])])) : value
const sameJson = (a,b) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
const fail = message => { throw new Error(message) }
const price = value => typeof value === 'number' && Number.isFinite(value) && value >= 1 && value <= 9999999
export const groupLabel = index => String.fromCharCode(65 + index)

export function groupOdds(field, odds, threshold = 1.5, boundaries = null) {
  if (!Number.isFinite(threshold) || threshold < 1.1 || threshold > 5) fail('区切り倍率は1.1〜5で指定してください。')
  const active = field.filter(h => !h.cancelled)
  const numbers = active.map(h => Number(h.no))
  if (!numbers.length || numbers.length > 18 || new Set(numbers).size !== numbers.length
    || numbers.some(no => !Number.isInteger(no) || no < 1 || no > 18)) fail('出走馬を確認してください。')
  const rows = active.filter(h => price(odds?.[h.no])).map(h => ({ no: Number(h.no), name: h.name ?? '', odds: odds[h.no] }))
    .sort((a,b) => a.odds - b.odds || a.no - b.no)
  const automatic = rows.filter((h,i) => i > 0 && h.odds / rows[i-1].odds >= threshold - 1e-12).map(h => h.no)
  const cuts = boundaries ?? automatic
  if (!Array.isArray(cuts) || new Set(cuts).size !== cuts.length || cuts.some(no => {
    const i = rows.findIndex(h => h.no === no)
    return i <= 0 || rows[i].odds === rows[i-1].odds
  })) fail('同じオッズの馬は分割できません。区切り位置を確認してください。')
  const groups = []
  for (const row of rows) {
    if (!groups.length || cuts.includes(row.no)) groups.push({ label: groupLabel(groups.length), horses: [] })
    groups.at(-1).horses.push(row)
  }
  return { method: GROUP_METHOD, threshold, automatic, boundaries: [...cuts], manual: boundaries !== null,
    complete: rows.length === active.length, missing: numbers.filter(no => !price(odds?.[no])), groups,
    membership: Object.fromEntries(groups.flatMap(g => g.horses.map(h => [h.no, g.label]))) }
}

export function formationTickets(grouping, slots, type = '3連単', excluded = []) {
  if (!['馬単','3連単','3連複'].includes(type) || !Array.isArray(slots) || slots.length !== 3
    || slots.some(slot => !Array.isArray(slot) || slot.some(label => !grouping.groups.some(g => g.label === label)))) fail('着順のグループを確認してください。')
  const rows = slots.map(slot => grouping.groups.filter(g => slot.includes(g.label)).flatMap(g => g.horses.map(h => h.no)).filter(no => !excluded.includes(no)))
  const tickets = new Map()
  for (const a of rows[0]) for (const b of rows[1]) {
    if (a === b) continue
    for (const c of type === '馬単' ? [null] : rows[2]) {
      if (c === a || c === b) continue
      const numbers = c === null ? [a,b] : type === '3連複' ? [a,b,c].sort((x,y) => x-y) : [a,b,c]
      const key = ticketKey(type,numbers)
      tickets.set(key, { key, type, numbers })
    }
  }
  return [...tickets.values()]
}

export function compareGroupPlans(grouping, slots, excluded = []) {
  return [
    { id:'ordered', label:'指定した着順', type:'3連単', slots },
    { id:'swapped', label:'２着・３着を入替', type:'3連単', slots:[slots[0],slots[2],slots[1]] },
    { id:'trio', label:'同じ候補で３連複', type:'3連複', slots },
    { id:'exacta', label:'１着・２着で馬単', type:'馬単', slots },
  ].map(item => ({ ...item, tickets: formationTickets(grouping,item.slots,item.type,excluded) }))
}

export function groupBudget(tickets, budget, unit = 100, overrides = {}, quotes = []) {
  if (!Number.isSafeInteger(budget) || budget < 0 || budget > 10000 || budget % 100 !== 0) fail('予算上限は0〜10,000円、100円単位で指定してください。')
  if (!Number.isSafeInteger(unit) || unit < 100 || unit > 10000 || unit % 100 !== 0) fail('１点の金額は100円単位で指定してください。')
  const priced = new Map(quotes.map(q => [ticketKey(q.type,q.numbers),q.odds]))
  const allocations = tickets.map(t => {
    const stake = overrides[t.key] ?? unit
    if (!Number.isSafeInteger(stake) || stake < 0 || stake > 10000 || stake % 100 !== 0) fail('配分は0〜10,000円、100円単位で指定してください。')
    return { ...t, stake }
  }).filter(t => t.stake > 0)
  const invested = allocations.reduce((sum,t) => sum+t.stake,0)
  const payouts = allocations.filter(t => price(priced.get(t.key))).map(t => Math.floor(t.stake*priced.get(t.key)))
  return { allocations, invested, unspent: Math.max(0,budget-invested), overBudget: invested > budget,
    pricedCount: payouts.length, minimumConditionalPayout: allocations.length && payouts.length === allocations.length ? Math.min(...payouts) : null,
    expectedReturn: null, hitProbability: null }
}

export function createGroupPlan({ race, field, snapshot, referenceSnapshot = null, threshold, boundaries, slots, excluded = [], variant, budget, unit, overrides, quotes = [], quoteObservedAt = null, quoteRetrievedAt = null, note = '', decision = 'plan' }, now = new Date().toISOString()) {
  const grouping = groupOdds(field,snapshot?.odds,threshold,boundaries)
  if (!grouping.complete || field.some(h => h.cancelled)) fail('取消を含まない全出走馬の単勝オッズが必要です。')
  const alternatives = compareGroupPlans(grouping,slots,excluded)
  const selected = alternatives.find(p => p.id === variant)
  if (!selected || !['plan','skip'].includes(decision)) fail('保存する比較案を選んでください。')
  const totals = groupBudget(decision === 'skip' ? [] : selected.tickets,budget,unit,overrides,quotes)
  if (totals.overBudget || decision === 'plan' && !totals.allocations.length) fail('点数と配分を調整し、予算内の買い目を指定してください。')
  const cutoffAt = decisionCutoff(race)
  if (!cutoffAt || !validTimestamp(now)) fail('開催日と発走時刻が必要です。')
  if (String(snapshot?.raceId) !== String(race.id) || String(snapshot?.raceDate).replaceAll('-','') !== String(race.raceDate).replaceAll('-','') || snapshot.kind !== 'observed') fail('このレースの実オッズを選択してください。')
  let referenceGrouping = null
  if (referenceSnapshot) {
    if (referenceSnapshot.kind !== 'observed' || String(referenceSnapshot.raceId) !== String(race.id)
      || String(referenceSnapshot.raceDate).replaceAll('-','') !== String(race.raceDate).replaceAll('-','')
      || ![referenceSnapshot.observedAt,referenceSnapshot.retrievedAt,snapshot.observedAt,snapshot.retrievedAt].every(validTimestamp)
      || Date.parse(referenceSnapshot.observedAt) >= Date.parse(snapshot.observedAt)
      || Date.parse(referenceSnapshot.retrievedAt) > Date.parse(snapshot.retrievedAt)) fail('比較元は選択時点までに取得した同じレースの記録が必要です。')
    referenceGrouping = groupOdds(field,referenceSnapshot.odds,threshold)
    if (!referenceGrouping.complete) fail('比較元にも全出走馬の単勝オッズが必要です。')
  }
  const quoteLive = !quotes.length || [quoteObservedAt,quoteRetrievedAt].every(t => validTimestamp(t) && Date.parse(t) <= Date.parse(now) && Date.parse(t) <= Date.parse(cutoffAt))
    && Date.parse(quoteObservedAt) <= Date.parse(quoteRetrievedAt)
  const live = snapshotTiming(snapshot,race).eligible && Date.parse(snapshot.retrievedAt) <= Date.parse(now) && Date.parse(now) <= Date.parse(cutoffAt) && quoteLive
  return { id: crypto.randomUUID(), createdAt: now, method: GROUP_METHOD, mode: live ? 'live' : 'replay', cutoffAt,
    race: { id:String(race.id), raceDate:String(race.raceDate).replaceAll('-',''), name:race.name ?? '', postTime:race.postTime ?? race.post_time },
    field: clone(field), snapshot: clone(snapshot), referenceSnapshot:clone(referenceSnapshot), referenceGrouping,
    grouping, slots: clone(slots), excluded: [...excluded], variant, decision,
    budget, unit, overrides: clone(overrides ?? {}), quotes: clone(quotes), quoteObservedAt, quoteRetrievedAt,
    note: String(note).slice(0,4000), ...totals }
}

export function validateGroupPlan(plan, scope) {
  if (!plan || plan.method !== GROUP_METHOD || plan.race?.id !== scope.raceId || plan.race?.raceDate !== scope.raceDate
    || !['live','replay'].includes(plan.mode) || !Array.isArray(plan.field) || plan.field.length < 2 || plan.field.length > 18
    || !Array.isArray(plan.excluded) || new Set(plan.excluded).size !== plan.excluded.length || plan.excluded.some(no => !plan.field.some(h => h.no === no))
    || !Array.isArray(plan.quotes) || plan.quotes.length > 5000 || typeof plan.note !== 'string' || plan.note.length > 4000) fail('グループ記録の形式が正しくありません。')
  for (const h of plan.field) if (!Number.isInteger(h.no) || typeof h.name !== 'string' || typeof h.evidence !== 'string' || h.evidence.length > 4000) fail('能力比較の記録を確認してください。')
  const keys = new Set()
  for (const q of plan.quotes) {
    if (!['馬単','3連単','3連複'].includes(q.type) || !Array.isArray(q.numbers) || q.numbers.length !== (q.type === '馬単' ? 2 : 3)
      || new Set(q.numbers).size !== q.numbers.length || q.numbers.some(no => !plan.field.some(h => h.no === no)) || !price(q.odds)) fail('組合せ価格が不正です。')
    const key = ticketKey(q.type,q.numbers)
    if (keys.has(key)) fail('組合せ価格が重複しています。')
    keys.add(key)
  }
  const expected = createGroupPlan({ ...plan, race: plan.race, threshold:plan.grouping?.threshold,
    boundaries:plan.grouping?.manual ? plan.grouping.boundaries : null },plan.createdAt)
  for (const key of ['mode','cutoffAt','grouping','referenceGrouping','allocations','invested','unspent','overBudget','pricedCount','minimumConditionalPayout','expectedReturn','hitProbability']) {
    if (!sameJson(expected[key],plan[key])) fail('グループ・買い目・集計と保存内容が一致しません。')
  }
  return plan
}

export function reviewGroupPlan(plan, outcome) {
  const field = outcome?.field
  if (outcome?.state !== 'matched' || !Array.isArray(field) || field.length !== plan.field.length
    || plan.field.some(h => !field.some(r => r.no === h.no))
    || field.map(r => r.rank).sort((a,b) => a-b).some((rank,i) => rank !== i+1)) return null
  const top = field.filter(h => h.rank <= 3).sort((a,b) => a.rank-b.rank)
  // Dead heats and abnormal/missing fields need official payout matching, not a guessed ordering.
  if (top.length !== 3 || top.some((h,i) => h.rank !== i+1)) return null
  const numbers = top.map(h => h.no)
  const selected = compareGroupPlans(plan.grouping,plan.slots,plan.excluded).find(p => p.id === plan.variant)
  const pool = new Set(selected.tickets.flatMap(t => t.numbers))
  const key = ticketKey(selected.type, selected.type === '馬単' ? numbers.slice(0,2) : numbers)
  const allocated = new Set(plan.allocations.map(t => t.key))
  return { groups:numbers.map(no => plan.grouping.membership[no]).join('→'), numbers,
    candidatesCovered:(selected.type === '馬単' ? numbers.slice(0,2) : numbers).every(no => pool.has(no)), formationCovered:selected.tickets.some(t => t.key === key), hit:allocated.has(key) }
}

export function groupReceiptVerified(plan,receipt,scope) {
  return plan.mode === 'live' && receipt?.ownerId === scope.userId && receipt?.raceId === scope.raceId && receipt?.raceDate === scope.raceDate
    && receipt?.planId === plan.id && receipt?.sourceId === plan.snapshot.id && receipt?.cutoffAt === plan.cutoffAt
    && validTimestamp(receipt.receivedAt) && Date.parse(receipt.receivedAt) >= Date.parse(plan.createdAt) && Date.parse(receipt.receivedAt) <= Date.parse(plan.cutoffAt)
}

export function groupOutcome(plan,review,cloud) {
  const existing = review?.races?.find(r => r.raceId === plan.race.id && r.raceDate.replaceAll('-','') === plan.race.raceDate)
  // A model-review export may still be waiting when a newer official capture arrives.
  // Explicit conflicts/abnormal standings remain held; only waiting states may fall back.
  if (existing && !['awaiting-results','awaiting-payout'].includes(existing.state)) return existing
  const post = raceTimestamp(plan.race,plan.race.postTime)
  const events = (cloud?.observations ?? []).filter(e => e.kind === 'LIVE_RACE'
    && String(e.payload?.raceId) === plan.race.id && String(e.payload?.raceDate).replaceAll('-','') === plan.race.raceDate
    && validTimestamp(e.retrievedAt) && post && Date.parse(e.retrievedAt) >= Date.parse(post))
    .sort((a,b) => Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))
  const latest = events[0]?.payload
  if (latest?.priceStatus !== 'final-visible' || latest.horses?.some(h => h.cancelled)
    || latest.results?.length !== plan.field.length || latest.releaseFieldSize !== plan.field.length) return null
  const field = latest.results.map(r => ({ no:r.horseNo,rank:r.rank }))
  const simultaneous = events.filter(e => Date.parse(e.retrievedAt) === Date.parse(events[0].retrievedAt))
  if (simultaneous.some(e => !sameJson(e.payload.results,latest.results))) return null
  const winner = field.find(r => r.rank === 1)?.no
  const official = (cloud.observations ?? []).filter(e => e.kind === 'HJC' && e.payload?.status === 'published')
    .sort((a,b) => Date.parse(b.retrievedAt)-Date.parse(a.retrievedAt))[0]
  const winPayouts = official?.payload.payouts.filter(p => p.type === '単勝') ?? []
  if (winPayouts.length && (winPayouts.length !== 1 || winPayouts[0].numbers[0] !== winner)) return null
  const result = { state:'matched',field }
  return reviewGroupPlan(plan,result) ? result : null
}

// Descriptive Wilson interval; one day of selected races is not independent validation.
export function groupHitInterval(hits,count) {
  if (!Number.isInteger(count) || count <= 0 || !Number.isInteger(hits) || hits < 0 || hits > count) return null
  const z = 1.959963984540054, p = hits/count, denominator = 1+z*z/count
  const center = (p+z*z/(2*count))/denominator
  const spread = z*Math.sqrt(p*(1-p)/count+z*z/(4*count*count))/denominator
  return [Math.max(0,center-spread),Math.min(1,center+spread)]
}
