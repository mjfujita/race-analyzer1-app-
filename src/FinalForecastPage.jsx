import { useMemo, useRef, useState } from 'react'
import { Target, ArrowRight, Save, Download, Upload, ShieldCheck, Calculator } from 'lucide-react'
import { oddsStorageKey, readOddsHistory, readOddsEvents } from './oddsHistory.js'
import { decisionCutoff, raceTimestamp, snapshotTiming, formatRaceTime } from './raceTime.js'
import { loadModel } from './modelStore.js'
import RaceDataPanel, { readRaceData } from './RaceDataPanel.jsx'
import { buildAbilityField, analyzeMarket } from './marketModel.js'
import { BET_TYPES, RISK_PROFILES, buildPortfolio, officialFrames, parseQuotes } from './portfolio.js'
import { ledgerScope, readLedger, writeLedgerExclusive, appendForecast, appendPurchase, appendSettlement,
  activePurchases, latestSettlement, summarizeLedger, importLedger, exportLedger, parsePurchasedTickets, settlementFromHjc } from './forecastLedger.js'

const panel = 'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm'
const control = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 focus:border-cyan-600 focus:outline-none focus:ring-2 focus:ring-cyan-100'
const button = 'inline-flex items-center justify-center gap-2 rounded-lg bg-[#0B2545] px-4 py-2 text-sm font-semibold text-white hover:bg-[#153a62] disabled:cursor-not-allowed disabled:opacity-40'
const secondary = 'inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40'
const yen = value => `${Math.round(value ?? 0).toLocaleString('ja-JP')}円`
const pct = value => value == null || !Number.isFinite(value) ? '—' : `${(100 * value).toFixed(1)}%`
const decimal = value => value == null || !Number.isFinite(value) ? '—' : value.toFixed(2)
const label = ticket => `${ticket.type} ${ticket.numbers.join(['馬単', '3連単'].includes(ticket.type) ? '→' : '−')}`
const quoteText = quotes => (quotes ?? []).filter(ticket => ticket.type !== '単勝').map(ticket => `${ticket.type} ${ticket.numbers.join('-')} ${ticket.odds}${ticket.upper > ticket.odds ? `-${ticket.upper}` : ''}`).join('\n')
const purchaseText = tickets => tickets.map(ticket => `${ticket.type} ${ticket.numbers.join('-')} ${ticket.stake}`).join('\n')
const clockTime = iso => iso && Number.isFinite(Date.parse(iso)) ? new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso)) : ''

function Metric({ title, value, detail }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
    <p className="text-xs text-slate-500">{title}</p><p className="mt-1 font-mono text-xl font-semibold tabular-nums text-[#0B2545]">{value}</p>
    {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
  </div>
}

function downloadFile(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const link = document.createElement('a'); link.href = url; link.download = name; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function storedLedger(scope) {
  try { return readLedger(globalThis.localStorage, scope) }
  catch { return { ledger: { schemaVersion: 1, scope, forecasts: [], purchases: [], settlements: [] }, error: 'ブラウザの保存領域にアクセスできません。' } }
}

function oddsRecords(key, cutoffAt) {
  try { return { events: readOddsEvents(key), history: readOddsHistory(key), strictHistory: readOddsHistory(key, { asOf: cutoffAt }), error: null } }
  catch (error) { return { events: [], history: [], strictHistory: [], error: error.message } }
}

export default function FinalForecastPage(props) {
  let scope
  try { scope = ledgerScope(props.userId, props.race) }
  catch { return <section className={panel}><p role="alert">ログインしてレースを選ぶと、予想と記録を利用できます。</p></section> }
  return <ForecastWorkspace key={`${scope.userId}:${scope.raceDate}:${scope.raceId}`} {...props} scope={scope} />
}

function ForecastWorkspace({ race, horses, statistics, userId, scope, onOpenAbility, onOpenPace }) {
  const [loaded] = useState(() => storedLedger(scope))
  const [ledger, setLedger] = useState(loaded.ledger)
  const [storageError, setStorageError] = useState(loaded.error)
  const [message, setMessage] = useState('')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [records] = useState(() => oddsRecords(oddsStorageKey(userId, race), decisionCutoff(race)))
  const [model] = useState(() => loadModel(userId))
  const [raceData, setRaceData] = useState(() => readRaceData(scope))
  const payoutEvent = useMemo(() => [...(raceData.bundle?.observations ?? [])].filter(event => event.kind === 'HJC' && event.payload.status === 'published')
    .sort((a, b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0], [raceData])
  const cutoffAt = decisionCutoff(race)
  const usableHistory = useMemo(() => [...new Map([...records.strictHistory, ...records.history].map(item => [item.id, item])).values()].filter(item => {
    const observed = item.observedAt ?? raceTimestamp(race, item.time)
    return cutoffAt && observed && Date.parse(observed) <= Date.parse(cutoffAt)
  }).sort((a, b) => b.time.localeCompare(a.time) || Number(snapshotTiming(b, race).eligible) - Number(snapshotTiming(a, race).eligible)), [records.history, records.strictHistory, cutoffAt, race])
  const latestSaved = loaded.ledger.forecasts.at(-1)
  const [snapshotId, setSnapshotId] = useState(() => usableHistory.find(item => item.id === latestSaved?.inputs.sourceId)?.id
    ?? usableHistory.find(item => snapshotTiming(item, race).eligible)?.id ?? usableHistory[0]?.id ?? '')
  const [anchor, setAnchor] = useState(String(latestSaved?.parameters.anchor ?? ''))
  const [budget, setBudget] = useState(String(latestSaved?.parameters.budget ?? 10000))
  const [profile, setProfile] = useState(latestSaved?.parameters.profile ?? 'balanced')
  const [minimumHit, setMinimumHit] = useState(String((latestSaved?.parameters.minHit ?? 0) * 100))
  const [stress, setStress] = useState(String(Math.round((1 - (latestSaved?.parameters.oddsFactor ?? 0.9)) * 100)))
  const [pairs, setPairs] = useState(quoteText(latestSaved?.inputs.quotes))
  const [pairTime, setPairTime] = useState(latestSaved?.inputs.quoteObservedAt ? clockTime(latestSaved.inputs.quoteObservedAt) : usableHistory[0]?.time ?? '')
  const [pairRetrievedAt, setPairRetrievedAt] = useState(latestSaved?.inputs.quoteRetrievedAt ?? null)
  const [opinion, setOpinion] = useState('')
  const [sort, setSort] = useState('expectedReturn')
  const [limit, setLimit] = useState(30)
  const [selectedForecastId, setSelectedForecastId] = useState(latestSaved?.id ?? '')
  const [importing, setImporting] = useState(false)
  const current = usableHistory.find(item => item.id === snapshotId)
  const asOfRecords = useMemo(() => {
    const storage = { getItem: () => JSON.stringify(records.events) }
    const asOf = current?.retrievedAt ?? cutoffAt
    const history = readOddsHistory('snapshot-cache', { storage, asOf })
    return { previous: history.find(item => item.time < (current?.time ?? '')), baseline: readOddsHistory('snapshot-cache', { storage, asOf, kind: 'baseline' })[0] }
  }, [records.events, current, cutoffAt])
  const previous = asOfRecords.previous
  const baseline = asOfRecords.baseline
  const timing = snapshotTiming(current, race)
  const ability = useMemo(() => buildAbilityField({ horses, statistics, race, model }), [horses, statistics, race, model])
  const frames = useMemo(() => officialFrames(ability.field), [ability.field])
  const parsed = useMemo(() => parseQuotes(pairs, ability.field, frames), [pairs, ability.field, frames])
  const factor = 1 - Number(stress) / 100
  const market = useMemo(() => analyzeMarket({ field: ability.field, odds: current?.odds ?? {}, baselineOdds: baseline?.odds ?? {},
    previousOdds: previous?.odds ?? {}, priceFactor: factor }), [ability.field, current, baseline, previous, factor])
  const budgetValid = /^\d+$/.test(budget) && Number.isSafeInteger(Number(budget)) && Number(budget) <= 1_000_000
  const stressValid = stress !== '' && Number.isFinite(Number(stress)) && Number(stress) >= 0 && Number(stress) <= 80
  const pairTimeValid = !pairs.trim() || Boolean(current && pairTime === current.time)
  const pairErrors = parsed.quotes.some(ticket => ticket.type === '単勝') ? ['単勝は能力ページに記録した値を使用します。追加欄には他の券種を入力してください。'] : []
  const inputsReady = Boolean(ability.complete && market.complete && budgetValid && stressValid && pairTimeValid && !parsed.errors.length && !pairErrors.length && current)
  const quotes = useMemo(() => [...ability.field.filter(horse => Number.isFinite(current?.odds?.[horse.no])).map(horse => ({ type: '単勝', numbers: [horse.no], odds: current.odds[horse.no] })),
    ...parsed.quotes], [ability.field, current, parsed.quotes])
  const config = useMemo(() => ({ field: ability.field, quotes, budget: Number(budget), frames, minHit: Number(minimumHit) / 100,
    oddsFactor: factor, profile, maxTickets: 8, releaseFieldSize: Number(race.releaseFieldSize ?? race.fieldSize),
    placePositions: race.placePositions, frameBettingAvailable: race.frameBettingAvailable }),
  [ability.field, quotes, budget, frames, minimumHit, factor, profile, race.releaseFieldSize, race.fieldSize, race.placePositions, race.frameBettingAvailable])
  const ace = useMemo(() => inputsReady ? buildPortfolio(config) : null, [inputsReady, config])
  const selected = useMemo(() => !ace ? null : anchor ? buildPortfolio({ ...config, anchor: Number(anchor) }) : ace, [ace, config, anchor])
  const ready = inputsReady && !ace?.issues.length && !selected?.issues.length
  const rows = useMemo(() => [...(selected?.evaluated ?? [])].sort((a, b) => (b[sort] ?? -Infinity) - (a[sort] ?? -Infinity)), [selected, sort])
  const forecast = ledger.forecasts.find(item => item.id === selectedForecastId) ?? ledger.forecasts.at(-1)
  const purchase = activePurchases(ledger).findLast(item => item.forecastId === forecast?.id)
  const totals = summarizeLedger(ledger)
  const queryIssues = [...ability.issues, ...(current ? market.issues : []), ...parsed.errors, ...pairErrors,
    ...(ace?.issues ?? []), ...(selected?.issues ?? [])]
  const lateQuotes = pairs.trim() && (!pairRetrievedAt || !cutoffAt || Date.parse(pairRetrievedAt) > Date.parse(cutoffAt))
  const effectiveModel = ability.model.status === 'research' ? model : null
  const modelTimeEligible = !effectiveModel || [effectiveModel.generatedAt, effectiveModel.adoptedAt ?? effectiveModel.importedAt]
    .every(value => value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= Date.parse(cutoffAt))
  const actualLive = timing.eligible && !lateQuotes && modelTimeEligible && cutoffAt && Date.now() <= Date.parse(cutoffAt)

  async function persist(next, success) {
    if (loaded.error) { setStorageError(loaded.error); return false }
    if (savingRef.current) return false
    savingRef.current = true; setSaving(true)
    try {
      const saved = await writeLedgerExclusive(globalThis.localStorage, next)
      setLedger(saved); setStorageError(null); setMessage(success); return true
    } catch (error) {
      const refreshed = readLedger(globalThis.localStorage, scope)
      if (!refreshed.error) setLedger(refreshed.ledger)
      setStorageError(`保存できませんでした。元の記録は保持しています。${error.message}`); return false
    } finally { savingRef.current = false; setSaving(false) }
  }

  async function freeze() {
    if (!ready || !cutoffAt) return
    try {
      const common = { mode: actualLive && Date.now() <= Date.parse(cutoffAt) ? 'live' : 'replay', cutoffAt, modelVersion: ability.model.id,
        modelStatus: ability.model.status, inputs: { sourceId: current.id, observedAt: current.observedAt ?? null,
          sourcePublishedAt: current.sourcePublishedAt ?? null, retrievedAt: current.retrievedAt ?? null, winOdds: current.odds,
          baselineOdds: baseline?.odds ?? null, baselineSnapshot: baseline ?? null, previousSnapshot: previous ?? null, quotes, quoteObservedAt: pairs.trim() ? raceTimestamp(race, pairTime) : null,
          quoteRetrievedAt: pairs.trim() ? pairRetrievedAt : null, model: effectiveModel, weather: race.weather ?? null, going: race.going ?? null,
          contextObservationIds: (raceData.bundle?.observations ?? []).filter(event => event.kind === 'TYB').map(event => event.eventId),
          releaseFieldSize: config.releaseFieldSize, placePositions: config.placePositions ?? null, frameBettingAvailable: config.frameBettingAvailable ?? null },
        parameters: { budget: Number(budget), profile, minHit: Number(minimumHit) / 100, oddsFactor: factor, anchor: null },
        field: ability.field.map(horse => ({ no: horse.no, name: horse.name, idm: horse.idm, probability: horse.probability,
          frameNo: horse.frameNo, contributions: horse.contributions ?? [] })) }
      const base = appendForecast(ledger, { ...common, kind: 'ace', parentId: null, allocations: ace.allocations, metrics: ace.metrics,
        coverage: ace.coverage, method: ace.method, note: '利用者の軸指定・意見を加える前のACE原案。確率と収益性は検証中。' })
      const result = anchor || opinion.trim() ? appendForecast(base.ledger, { ...common, kind: 'user', parentId: base.record.id,
        parameters: { ...common.parameters, anchor: anchor ? Number(anchor) : null }, allocations: selected.allocations,
        metrics: selected.metrics, coverage: selected.coverage, method: selected.method, note: opinion.trim() || `${anchor}番を軸に指定` }) : base
      if (await persist(result.ledger, 'ACE原案と入力条件を固定保存しました。購入した内容は別に記録してください。')) setSelectedForecastId(result.record.id)
    } catch (error) { setStorageError(error.message) }
  }

  async function handleImport(event) {
    const file = event.target.files?.[0]
    if (!file) return
    setImporting(true); setMessage('')
    try {
      if (file.size > 4_000_000) throw new Error('4MB以下の記録ファイルを指定してください。')
      const next = importLedger(ledger, await file.text())
      if (await persist(next, '記録を照合して追加しました。同じ記録は重複保存しません。')) setSelectedForecastId(next.forecasts.at(-1)?.id ?? '')
    } catch (error) { setStorageError(`取込みを中止しました。${error.message}`) }
    finally { setImporting(false); event.target.value = '' }
  }

  return <div className="space-y-5 text-slate-800">
    <section className="overflow-hidden rounded-2xl bg-[#0B2545] p-5 text-white shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="font-mono text-xs tracking-widest text-cyan-300">ABILITY × MARKET × PRICE</p>
          <h3 className="mt-2 flex items-center gap-2 text-xl font-semibold"><Target className="h-5 w-5" />市場評価と買い方</h3>
          <p className="mt-2 text-sm text-slate-300">強さ、市場の評価、価格の余裕を分けて比較します。</p></div>
        <span className="rounded-full border border-cyan-600/50 bg-cyan-950/50 px-3 py-1 text-xs text-cyan-200">研究用・収益性検証中</span>
      </div>
      <div className="mt-5 grid gap-4 border-t border-white/10 pt-4 text-sm sm:grid-cols-3">
        <div><p className="text-xs text-slate-400">判断締切</p><p className="mt-1 font-mono">{formatRaceTime(cutoffAt)} <span className="text-xs text-slate-400">発走10分前</span></p></div>
        <div><p className="text-xs text-slate-400">能力モデル</p><p className="mt-1">{ability.model.label}</p></div>
        <div><p className="text-xs text-slate-400">取得時点の扱い</p><p className="mt-1">{actualLive ? '締切前の情報で記録可能' : '過去検証・試算として記録'}</p></div>
      </div>
    </section>

    {storageError && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{storageError}</p>}
    {message && <p role="status" className="rounded-xl border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900">{message}</p>}
    {records.error && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">{records.error}</p>}
    <RaceDataPanel scope={scope} data={raceData} onChange={setRaceData} />

    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">01 · 能力と市場の評価</h3><button type="button" className={secondary} onClick={onOpenAbility}>能力・オッズ記録 <ArrowRight className="h-4 w-4" /></button></div>
      <p className="text-sm text-slate-600">IDMを土台にした研究用モデルの確率を基準に比較します。市場支持率は勝率ではありません。市場で校正した勝率と統合勝率は、検証が済むまで未算出です。</p>
      {ability.model.trainedThrough && <p className="text-xs text-slate-500">学習対象の終了日 {ability.model.trainedThrough} ・ 学習モデルも研究段階です。</p>}
      {!modelTimeEligible && <p className="text-xs text-amber-800">このモデルの作成・採用時刻が締切前と確認できないため、今回の計算は過去検証として記録します。</p>}
      <label className="flex flex-wrap items-center gap-2 text-sm">オッズの観測時刻<select className={control} value={snapshotId} onChange={event => { setSnapshotId(event.target.value); const item = usableHistory.find(row => row.id === event.target.value); setPairTime(item?.time ?? ''); setPairs(''); setPairRetrievedAt(null) }}>
        {!usableHistory.length && <option value="">締切以前の記録なし</option>}
        {usableHistory.map(item => <option key={item.id} value={item.id}>{item.time} {snapshotTiming(item, race).eligible ? '時刻証跡あり' : '過去検証用'}</option>)}
      </select></label>
      {current && <p className="text-xs text-slate-500">観測 {formatRaceTime(current.observedAt)} ／ 取得 {formatRaceTime(current.retrievedAt)}。{timing.reason ?? '10分前までに取得された記録です。'}{lateQuotes ? ' 追加オッズは締切後入力のため過去検証に限定します。' : ''}</p>}
      {!ability.field.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm">正式な全出走馬とIDMが揃うと能力評価を表示します。</p> :
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs text-slate-500"><tr>{['能力順位・馬番', '馬名 / IDM', '能力確率 pF', '市場支持率 q', '市場校正 pM / 統合 p*', '単勝 / 購入境界', '評価差 log(pF/q)'].map(title => <th key={title} scope="col" className="p-3">{title}</th>)}</tr></thead>
          <tbody className="divide-y divide-slate-100">{market.rows.map(horse => <tr key={horse.no}><td className="p-3 font-mono">{horse.abilityRank}位 <span className="ml-2 rounded bg-slate-100 px-2 py-1 font-semibold">{horse.no}</span></td><th scope="row" className="p-3 font-semibold">{horse.name}<span className="ml-2 font-mono text-xs font-normal text-slate-500">{horse.idm}</span></th><td className="p-3 font-mono">{pct(horse.pF)}</td><td className="p-3 font-mono">{pct(horse.marketShare)}</td><td className="p-3 text-xs text-slate-400">未算出 / 未算出</td><td className="p-3 font-mono">{horse.odds?.toFixed(1) ?? '—'} / {decimal(horse.fairOdds)}倍</td><td className={`p-3 font-mono ${horse.gapLog > 0 ? 'text-cyan-800' : 'text-slate-500'}`}>{decimal(horse.gapLog)}</td></tr>)}</tbody></table></div>}
      {ability.field.some(horse => horse.contributions?.length) && <details className="text-sm"><summary className="cursor-pointer font-semibold text-cyan-800">能力上位候補の根拠を確認</summary><p className="my-2 text-xs text-slate-500">寄与値はレース内平均に対するモデルスコアの差です。確率の増減幅や因果効果ではありません。</p><div className="grid gap-3 lg:grid-cols-3">{ability.field.slice(0, 3).map(horse => <div key={horse.no} className="rounded-xl bg-slate-50 p-3"><p className="font-semibold">{horse.no}番 {horse.name}</p>{horse.contributions?.map(item => <p key={item.key} className="mt-2 text-xs text-slate-600">{item.label} <span className="font-mono">{decimal(item.centeredLogit)}</span>{item.evidence?.runs != null && <span> · 3着内 {item.evidence.top3}/{item.evidence.runs}走</span>}</p>)}</div>)}</div></details>}
      <p className="text-xs text-slate-500">購入境界はこの能力確率を仮定した損益分岐オッズです。未学習の条件は固定点で上乗せしません。<button type="button" onClick={onOpenPace} className="ml-1 font-semibold text-cyan-800 underline">展開・当日の傾向を確認</button></p>
    </section>

    <section className={`${panel} space-y-4`}>
      <h3 className="flex items-center gap-2 font-semibold"><Calculator className="h-4 w-4 text-cyan-700" />02 · 価格・予算・配分条件</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="space-y-1 text-xs text-slate-500"><span>予算上限（円）</span><input className={`${control} block w-full font-mono`} type="number" min="0" max="1000000" step="100" value={budget} onChange={event => setBudget(event.target.value)} /></label>
        <label className="space-y-1 text-xs text-slate-500"><span>配分方針</span><select className={`${control} block w-full`} value={profile} onChange={event => setProfile(event.target.value)}>{Object.entries(RISK_PROFILES).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></label>
        <label className="space-y-1 text-xs text-slate-500"><span>オッズ下落の感度設定（%）</span><input className={`${control} block w-full font-mono`} type="number" min="0" max="80" value={stress} onChange={event => setStress(event.target.value)} /></label>
        <label className="space-y-1 text-xs text-slate-500"><span>各買い目の最低試算的中率</span><select className={`${control} block w-full`} value={minimumHit} onChange={event => setMinimumHit(event.target.value)}>{[0, 5, 10, 20, 30, 50].map(value => <option key={value} value={value}>{value === 0 ? '制限なし' : `${value}%`}</option>)}</select></label>
      </div>
      {!budgetValid && <p role="alert" className="text-sm text-rose-700">予算は0〜1,000,000円の整数で入力してください。</p>}
      {!stressValid && <p role="alert" className="text-sm text-rose-700">オッズ下落率は0〜80%で入力してください。</p>}
      <div className="grid gap-4 rounded-xl bg-slate-50 p-4 lg:grid-cols-2">
        <div><label className="block text-sm font-semibold" htmlFor="combination-odds">各券種の実オッズ</label><p className="my-2 text-xs text-slate-500">1行に券種・馬番（枠連は枠番）・倍率。単勝は上の記録を使います。</p>
          <textarea id="combination-odds" className={`${control} w-full font-mono`} rows="4" value={pairs} onChange={event => { setPairs(event.target.value); setPairRetrievedAt(new Date().toISOString()) }} placeholder={'複勝 1 1.9-2.4\n馬連 1-2 15.0\nワイド 1-2 5.0\n3連単 1-2-3 100.0'} />
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">表示元のオッズ時刻<input className={control} type="time" value={pairTime} onChange={event => { setPairTime(event.target.value); setPairRetrievedAt(new Date().toISOString()) }} /></label></div>
        <div className="space-y-3 text-xs leading-relaxed text-slate-600"><p>同時点の価格を比較します。複勝・ワイドは表示幅の下限で試算し、最終払戻が同じになるとは仮定しません。</p><p>応援馬券は単勝と複勝の組合せとして比較できます。WIN5は対象外です。</p><p>{Object.keys(frames).length ? '正式な枠番号を取得済みです。' : '正式な枠番号が未取得のため、枠連は比較を保留します。'}</p><p>下落率は手動の感度分析です。学習済みの最終オッズ予測や統計的な信頼下限ではありません。</p></div>
      </div>
      {!pairTimeValid && <p role="alert" className="text-sm text-rose-700">追加オッズは選択中の単勝と同じ観測時刻を指定してください。</p>}
      {queryIssues.length > 0 && <ul className="space-y-1 text-sm text-amber-900">{[...new Set(queryIssues)].map(issue => <li key={issue}>{issue}</li>)}</ul>}
      {!current && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">発走10分前以前のオッズ記録が必要です。能力ページから記録・取込みできます。</p>}
    </section>

    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">03 · ACE原案と軸指定の比較</h3><label className="flex items-center gap-2 text-sm">選択する軸馬<select className={control} value={anchor} onChange={event => setAnchor(event.target.value)}><option value="">指定なし</option>{ability.field.map(horse => <option key={horse.no} value={horse.no}>{horse.no}番 {horse.name}</option>)}</select></label></div>
      <p className="text-xs text-slate-500">軸を指定してもACE原案の確率は変更しません。指定した馬を含む買い目に絞って、配分を再計算します。</p>
      {ready ? <>
        {anchor && <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">ACE原案・軸指定なし</p><p className="mt-2">投入 {yen(ace.metrics.invested)} / 試算回収率 {pct(ace.metrics.expectedReturn)}</p><p className="mt-1 text-xs text-slate-500">{ace.allocations.map(label).join('、') || '見送り'}</p></div><div className="rounded-xl border border-cyan-200 bg-cyan-50 p-3 text-sm"><p className="font-semibold text-cyan-900">{anchor}番を含む利用者案</p><p className="mt-2">投入 {yen(selected.metrics.invested)} / 試算回収率 {pct(selected.metrics.expectedReturn)}</p><p className="mt-1 text-xs text-cyan-800">{selected.allocations.map(label).join('、') || '見送り'}</p></div></div>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric title="投入額 / 予算上限" value={yen(selected.metrics.invested)} detail={`未使用 ${yen(selected.metrics.unspent)}`} /><Metric title="試算回収率" value={pct(selected.metrics.expectedReturn)} detail={`期待利益 ${yen(selected.metrics.expectedProfit)}`} /><Metric title="トータル黒字の確率" value={pct(selected.metrics.profitProbability)} detail={`全不的中 ${pct(selected.metrics.allMissProbability)}`} /><Metric title="投入額の損失上限" value={yen(selected.metrics.maxLoss)} detail={`損失確率 ${pct(selected.metrics.lossProbability)}`} /></div>
        <div className="rounded-xl border border-cyan-200 bg-cyan-50/60 p-4"><p className="font-semibold text-[#0B2545]">{selected.allocations.length ? `配分案 ${selected.allocations.length}点` : '見送り・購入0円'}</p><div className="mt-3 flex flex-wrap gap-2">{selected.allocations.map(ticket => <div key={ticket.key} className="rounded-lg border border-cyan-200 bg-white px-3 py-2 text-sm"><span className="font-semibold">{label(ticket)}</span><span className="ml-3 font-mono text-cyan-800">{yen(ticket.stake)}</span></div>)}</div>{!selected.allocations.length && <p className="mt-2 text-sm text-slate-600">入力済み価格と設定条件では配分対象がありません。予算を使い切るための購入は追加しません。</p>}</div>
        <div className="flex flex-wrap gap-2 text-xs">{Object.keys(BET_TYPES).map(type => { const item = selected.coverage.byType[type]; return <span key={type} className="rounded-md border border-slate-200 px-2 py-1">{type} {item?.priced ?? 0} / {item?.total ?? 0}</span> })}</div>
        <p className="text-xs text-slate-500">上の件数は価格取得数 / 比較可能な組合せ数。価格未取得は推測で埋めません。{selected.method}</p>
        <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">同一レースの相関を含む通常着順モデルによる試算。的中率は校正未完了です。</p><label className="text-xs">候補の並び<select className={`${control} ml-2`} value={sort} onChange={event => setSort(event.target.value)}><option value="expectedReturn">下落想定の回収率</option><option value="probability">的中確率</option><option value="odds">実オッズ</option></select></label></div>
        <div className="overflow-x-auto"><table className="w-full whitespace-nowrap text-left text-sm"><thead className="border-y border-slate-200 bg-slate-50 text-xs"><tr>{['買い目', '実オッズ', '下落想定', '的中確率', '損益分岐オッズ', '試算回収率', '判定'].map(title => <th key={title} scope="col" className="p-3">{title}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, limit).map(ticket => <tr key={ticket.key}><th scope="row" className="p-3 font-semibold">{label(ticket)}</th><td className="p-3 font-mono">{decimal(ticket.odds)}</td><td className="p-3 font-mono">{decimal(ticket.stressOdds)}</td><td className="p-3 font-mono">{pct(ticket.probability)}</td><td className="p-3 font-mono">{decimal(ticket.breakEvenOdds)}</td><td className="p-3 font-mono">{pct(ticket.expectedReturn)}</td><td className={`p-3 text-xs ${ticket.qualifies ? 'text-cyan-800' : 'text-slate-500'}`}>{ticket.reason || (ticket.qualifies ? '価格面の候補' : '条件外')}</td></tr>)}</tbody></table></div>
        {rows.length > limit && <button type="button" className={secondary} onClick={() => setLimit(limit + 100)}>次の100件を表示（全{rows.length}件）</button>}
        <label className="block text-sm">利用者の意見・判断メモ<textarea className={`${control} mt-2 block w-full`} rows="2" maxLength="4000" value={opinion} onChange={event => setOpinion(event.target.value)} placeholder="観察した事実や軸馬を選んだ理由。メモだけで確率は自動変更しません。" /></label>
        <button type="button" className={button} disabled={Boolean(loaded.error) || saving} onClick={freeze}><Save className="h-4 w-4" />{actualLive ? '10分前の予想を固定保存' : '研究用の試算を固定保存'}</button>
      </> : <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">全頭の能力・同時点のオッズ・有効な入力条件が揃うと、ACE原案と配分を比較できます。</p>}
    </section>

    <section className={`${panel} space-y-4`}>
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-semibold"><ShieldCheck className="h-4 w-4 text-cyan-700" />04 · 固定予想・実購入・払戻</h3><div className="flex flex-wrap gap-2"><button type="button" className={secondary} disabled={!ledger.forecasts.length} onClick={() => { try { downloadFile(exportLedger(ledger), `race-record-${scope.raceDate}-${scope.raceId}.json`) } catch (error) { setStorageError(error.message) } }}><Download className="h-4 w-4" />JSONを書き出す</button><label className={`${secondary} ${importing || saving || loaded.error ? 'opacity-40' : 'cursor-pointer'}`}><Upload className="h-4 w-4" />{importing ? '照合中…' : '記録を取り込む'}<input type="file" accept="application/json,.json" className="sr-only" disabled={importing || saving || Boolean(loaded.error)} onChange={handleImport} /></label></div></div>
      <p className="text-xs text-slate-500">このブラウザ・このユーザーの領域に保存します。予想は購入として計上せず、訂正も元記録を残します。端末移行や学習用の保管にはJSONを書き出してください。</p>
      {!ledger.forecasts.length ? <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">固定保存した予想はまだありません。</p> : <>
        <label className="flex flex-wrap items-center gap-2 text-sm">保存済み予想<select className={`${control} max-w-full`} value={forecast?.id ?? ''} onChange={event => setSelectedForecastId(event.target.value)}>{[...ledger.forecasts].reverse().map((item, i) => <option key={item.id} value={item.id}>#{ledger.forecasts.length - i} {item.kind === 'ace' ? 'ACE原案' : '利用者案'} · {formatRaceTime(item.createdAt)} · {item.mode === 'live' ? '締切前記録' : '過去検証'}</option>)}</select></label>
        {forecast && <div className="rounded-xl border border-slate-200 p-4 text-sm"><p className="font-semibold">固定条件：予算 {yen(forecast.parameters.budget)} / 下落想定 {Math.round((1 - forecast.parameters.oddsFactor) * 100)}% / {forecast.parameters.anchor ? `軸 ${forecast.parameters.anchor}番` : '軸指定なし'}</p><p className="mt-2 text-xs text-slate-500">モデル {forecast.modelVersion} ・ 観測 {formatRaceTime(forecast.inputs.observedAt)} ・ 締切 {formatRaceTime(forecast.cutoffAt)}</p><p className="mt-2">{forecast.allocations.map(ticket => `${label(ticket)} ${yen(ticket.stake)}`).join(' ／ ') || '見送り'}</p>{forecast.note && <p className="mt-2 whitespace-pre-wrap text-xs text-slate-600">{forecast.note}</p>}</div>}
        {forecast && <PurchaseEditor key={`${forecast.id}:${purchase?.id ?? 'new'}`} forecast={forecast} purchase={purchase} disabled={Boolean(loaded.error) || saving} onSave={(tickets, note) => { const next = appendPurchase(ledger, { forecastId: forecast.id, tickets, note, replacesId: purchase?.id ?? null }); return persist(next.ledger, '実購入の記録を保存しました。') }} />}
        {activePurchases(ledger).map(item => <SettlementEditor key={`${item.id}:${latestSettlement(ledger, item.id)?.id ?? 'new'}`} purchase={item} settlement={latestSettlement(ledger, item.id)} payoutEvent={payoutEvent} disabled={Boolean(loaded.error) || saving} onSave={(payouts, note, source) => { const latest = latestSettlement(ledger, item.id); const next = appendSettlement(ledger, { purchaseId: item.id, payouts, note, source, replacesId: latest?.id ?? null }); return persist(next.ledger, '正式払戻の記録を保存しました。') }} />)}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4"><Metric title="実購入の総額" value={yen(totals.invested)} detail={`未精算 ${totals.pendingCount}件`} /><Metric title="精算済みの払戻" value={yen(totals.payout)} detail={`精算した購入 ${yen(totals.settledInvested)}`} /><Metric title="精算済み損益" value={yen(totals.profit)} /><Metric title="実回収率" value={pct(totals.returnRate)} detail="未精算分は含みません" /></div>
      </>}
    </section>
  </div>
}

function PurchaseEditor({ forecast, purchase, disabled, onSave }) {
  const [text, setText] = useState(purchaseText(purchase?.tickets ?? forecast.allocations))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  return <form className="space-y-3 rounded-xl bg-slate-50 p-4" onSubmit={async event => { event.preventDefault(); try { const tickets = parsePurchasedTickets(text, forecast.field); if (await onSave(tickets, note)) setError('') } catch (problem) { setError(problem.message) } }}>
    <h4 className="text-sm font-semibold">{purchase ? '購入記録の訂正' : '実際に購入した内容を記録'}</h4>
    <p className="text-xs text-slate-500">提案と一致していても、購入後に保存してください。1行に券種・馬番・実購入額。空欄で保存すると購入なしの記録になります。</p>
    <label className="block text-xs text-slate-600">実購入した買い目と金額<textarea className={`${control} mt-1 block w-full font-mono`} rows="3" value={text} onChange={event => setText(event.target.value)} placeholder="単勝 1 500" /></label>
    <label className="block text-xs text-slate-600">{purchase ? '訂正理由（必須）' : '購入メモ'}<input className={`${control} mt-1 w-full`} value={note} maxLength="4000" onChange={event => setNote(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<button type="submit" className={secondary} disabled={disabled}>{purchase ? '購入訂正を追記する' : text.trim() ? '実購入を保存する' : '購入なしを保存する'}</button>
  </form>
}

function SettlementEditor({ purchase, settlement, payoutEvent, disabled, onSave }) {
  const [payouts, setPayouts] = useState(Object.fromEntries(purchase.tickets.map(ticket => [ticket.key, settlement?.payouts[ticket.key] == null ? '' : String(settlement.payouts[ticket.key])])))
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [refundsChecked, setRefundsChecked] = useState(false)
  const [source, setSource] = useState(null)
  return <form className="space-y-3 rounded-xl border border-slate-200 p-4" onSubmit={async event => { event.preventDefault(); try { if (Object.values(payouts).some(value => !/^\d+$/.test(value))) throw new Error('全購入馬券の100円あたり払戻を整数で入力してください。'); if (source && !refundsChecked) throw new Error('HJC反映後は取消・返還がないことの確認が必要です。'); if (await onSave(Object.fromEntries(Object.entries(payouts).map(([key, value]) => [key, Number(value)])), note, source)) setError('') } catch (problem) { setError(problem.message) } }}>
    <h4 className="text-sm font-semibold">{formatRaceTime(purchase.createdAt)}の購入 · {settlement ? '精算済み・訂正可能' : '正式払戻を入力'}</h4>
    <p className="text-xs text-slate-500">100円あたりの正式な払戻金（円）を入力。外れは0円、全額返還は100円です。オッズから払戻を自動確定しません。</p>
    {payoutEvent && purchase.tickets.length > 0 && <div className="space-y-2 rounded-lg border border-cyan-200 bg-cyan-50 p-3 text-xs text-cyan-950"><p>このレースのHJC確定払戻と自動照合できます。HJCには返還情報がないため、取消・返還の有無を別に確認してください。</p><label className="flex items-start gap-2"><input type="checkbox" className="mt-0.5" checked={refundsChecked} onChange={event => setRefundsChecked(event.target.checked)} /><span>主催者情報で、この購入馬券に取消・返還がないことを確認しました</span></label><button type="button" className={secondary} disabled={!refundsChecked || disabled} onClick={() => { try { const proposed = settlementFromHjc(purchase, payoutEvent, refundsChecked); setPayouts(Object.fromEntries(Object.entries(proposed.payouts).map(([key, value]) => [key, String(value)]))); setSource(proposed.source); setError('') } catch (problem) { setError(problem.message) } }}>HJCから払戻を照合して入力</button>{source && <p>照合結果を入力しました。金額を確認して「正式払戻を保存する」で確定します。</p>}</div>}
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{purchase.tickets.map(ticket => <label key={ticket.key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-slate-50 p-2 text-sm"><span>{label(ticket)}<span className="ml-1 text-xs text-slate-500">購入 {yen(ticket.stake)}</span></span><input aria-label={`${label(ticket)}の100円あたり払戻`} className={`${control} w-28 font-mono`} type="number" min="0" step="1" value={payouts[ticket.key]} onChange={event => setPayouts({ ...payouts, [ticket.key]: event.target.value })} /></label>)}</div>
    {!purchase.tickets.length && <p className="text-sm text-slate-500">購入なしのため払戻0円です。</p>}
    <label className="block text-xs text-slate-600">{settlement ? '訂正理由（必須）' : '払戻の確認元・メモ'}<input className={`${control} mt-1 w-full`} value={note} maxLength="4000" onChange={event => setNote(event.target.value)} /></label>
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}<button type="submit" className={secondary} disabled={disabled}>{settlement ? '払戻訂正を追記する' : '正式払戻を保存する'}</button>
  </form>
}
