import { useCallback,useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import AbilityPage from '../src/AbilityPage.jsx'
import PacePage from '../src/PacePage.jsx'
import WinOddsPage from '../src/WinOddsPage.jsx'
import ForecastReviewPage from '../src/ForecastReviewPage.jsx'
import FinalForecastPage from '../src/FinalForecastPage.jsx'
import GroupWorkspace from '../src/GroupWorkspace.jsx'
import CaptureControls from '../src/CaptureControls.jsx'
import { oddsStorageKey } from '../src/oddsHistory.js'
import { syncLedgerToCloud } from '../src/cloudStore.js'
import { useCompanion } from '../src/useCompanion.js'
import { race, horses, statistics, assessmentHorses, aceHorses, assessmentStatistics, earlierRaces, demoSnapshots } from './fixtures.js'

const state = import.meta.env.MODE === 'phone-review' ? 'groups-local-review' : new URLSearchParams(location.search).get('state') ?? 'normal'
// LAN HTTP is not a secure browser context. Keep UUID generation usable only
// in the isolated fixture build; production authentication is not involved.
if (import.meta.env.MODE === 'phone-review' && !globalThis.crypto.randomUUID) {
  globalThis.crypto.randomUUID = () => {
    const bytes=globalThis.crypto.getRandomValues(new Uint8Array(16))
    bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
    const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('')
    return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`
  }
}
const userId = `synthetic-demo-${state}`
const useAssessmentFixture = state.startsWith('ace') || state === 'groups-local-review'
const connected = state === 'connected-test' || state.startsWith('groups-connected') || state.startsWith('personal-connected')
if (!connected && state !== 'empty' && !localStorage.getItem(oddsStorageKey(userId, race))) {
  localStorage.setItem(oddsStorageKey(userId, race), state === 'error' ? '{broken' : JSON.stringify(demoSnapshots()))
}
function Demo() {
  const [tab, setTab] = useState(state.startsWith('ace') ? 'ability' : state.startsWith('personal') ? 'personal' : state.startsWith('groups') ? 'groups' : state.startsWith('review') ? 'review' : state.startsWith('anchors') ? 'anchors' : 'final')
  const [cloudRevision, setCloudRevision] = useState(0)
  const [groupDisplay,setGroupDisplay]=useState(null)
  const onGroupDisplayChange=useCallback(value=>setGroupDisplay(previous=>JSON.stringify(previous)===JSON.stringify(value)?previous:value),[])
  const empty = state === 'empty'
  const { sync, refresh } = useCompanion({ userId: connected ? userId : null, race, horses })
  const props = { workspace:state.startsWith('pace-links'),groupDisplay,onGroupDisplayChange,race, horses:useAssessmentFixture?aceHorses:state==='assessment'?assessmentHorses:horses, statistics: empty||state==='pace-links-missing' ? [] : state==='assessment'?assessmentStatistics:statistics, earlierRaces, userId, cloudRevision: cloudRevision + sync.revision,
    syncedGroupReceipts:sync.data?.groupReceipts, loading:sync.loading,
    syncedReceipts: sync.data?.receipts, onSyncLedger: connected || state === 'cloud-test' ? syncLedgerToCloud : undefined,
    onOpenAbility: () => setTab('ability'), onOpenPace: () => setTab('pace'), onSelectRace: () => {}, onSelectHorse: () => {} }
  return <div className="min-h-screen bg-slate-100 pb-16 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-5"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><div><p className="text-lg font-black text-[#0B2545]">Race Condition Analyzer</p><p className="text-xs text-slate-500">開発確認 · 架空の8頭 · 本番データに接続しません</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">架空データの操作確認</span></div></header>
    <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6"><nav aria-label="レースの分析" className="mb-5 flex flex-wrap gap-2">{[['groups','グループ・買い目'],['personal','私の予想'],['anchors','軸候補・妙味判断'],['ability','能力・適性'],['pace','展開・天候'],['odds','市場評価差'],['final','最終予想・記録'],['review','振り返り']].map(([id,label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-[#0B2545] text-white' : 'bg-white text-slate-700'}`} onClick={() => setTab(id)}>{label}</button>)}<button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-600" onClick={connected ? refresh : () => setCloudRevision(value => value + 1)}>同期データを再読込（開発確認）</button></nav>
      {state==='groups-connected-capture'&&<CaptureControls race={race} onSync={refresh} syncing={sync.loading} syncError={sync.error} />}
      {tab === 'review' && <ForecastReviewPage review={connected ? sync.data?.forecastReview : JSON.parse(localStorage.getItem('synthetic-forecast-review') ?? 'null')}
        loading={connected ? sync.loading : state === 'review-loading'}
        error={connected ? sync.error : state === 'review-error' ? '同期を完了できませんでした。' : null}
        onRefresh={connected ? refresh : undefined} />}
      {tab === 'groups' && <GroupWorkspace {...props} onOpenPersonal={()=>setTab('personal')} />}{tab === 'personal' && <GroupWorkspace {...props} personalOnly onOpenGroups={()=>setTab('groups')} />}{tab === 'anchors' && <FinalForecastPage {...props} anchorMode />}{tab === 'ability' && <AbilityPage {...props} />}{tab === 'pace' && <PacePage {...props} />}{tab === 'odds' && <WinOddsPage {...props} />}{tab === 'final' && <FinalForecastPage {...props} />}
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<Demo />)
