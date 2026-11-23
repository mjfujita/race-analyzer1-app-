import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import AbilityPage from '../src/AbilityPage.jsx'
import PacePage from '../src/PacePage.jsx'
import WinOddsPage from '../src/WinOddsPage.jsx'
import ForecastReviewPage from '../src/ForecastReviewPage.jsx'
import FinalForecastPage from '../src/FinalForecastPage.jsx'
import GroupWorkspace from '../src/GroupWorkspace.jsx'
import { oddsStorageKey } from '../src/oddsHistory.js'
import { syncLedgerToCloud } from '../src/cloudStore.js'
import { useCompanion } from '../src/useCompanion.js'
import { race, horses, statistics, assessmentHorses, assessmentStatistics, earlierRaces, demoSnapshots } from './fixtures.js'

const state = new URLSearchParams(location.search).get('state') ?? 'normal'
const userId = `synthetic-demo-${state}`
const connected = state === 'connected-test' || state.startsWith('groups-connected')
if (!connected && state !== 'empty' && !localStorage.getItem(oddsStorageKey(userId, race))) {
  localStorage.setItem(oddsStorageKey(userId, race), state === 'error' ? '{broken' : JSON.stringify(demoSnapshots()))
}
function Demo() {
  const [tab, setTab] = useState(state.startsWith('groups') ? 'groups' : state.startsWith('review') ? 'review' : state.startsWith('anchors') ? 'anchors' : 'final')
  const [cloudRevision, setCloudRevision] = useState(0)
  const empty = state === 'empty'
  const { sync, refresh } = useCompanion({ userId: connected ? userId : null, race, horses })
  const props = { race, horses:state==='assessment'?assessmentHorses:horses, statistics: empty ? [] : state==='assessment'?assessmentStatistics:statistics, earlierRaces, userId, cloudRevision: cloudRevision + sync.revision,
    syncedGroupReceipts:sync.data?.groupReceipts, loading:sync.loading,
    syncedReceipts: sync.data?.receipts, onSyncLedger: connected || state === 'cloud-test' ? syncLedgerToCloud : undefined,
    onOpenAbility: () => setTab('ability'), onOpenPace: () => setTab('pace'), onSelectRace: () => {}, onSelectHorse: () => {} }
  return <div className="min-h-screen bg-slate-100 pb-16 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-5"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><div><p className="text-lg font-black text-[#0B2545]">Race Condition Analyzer</p><p className="text-xs text-slate-500">開発確認 · 架空の8頭 · 本番データに接続しません</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">架空データの操作確認</span></div></header>
    <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6"><nav aria-label="レースの分析" className="mb-5 flex flex-wrap gap-2">{[['groups','グループ・買い目'],['anchors','軸候補・妙味判断'],['ability','能力・適性'],['pace','展開・天候'],['odds','市場評価差'],['final','最終予想・記録'],['review','振り返り']].map(([id,label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-[#0B2545] text-white' : 'bg-white text-slate-700'}`} onClick={() => setTab(id)}>{label}</button>)}<button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-600" onClick={connected ? refresh : () => setCloudRevision(value => value + 1)}>同期データを再読込（開発確認）</button></nav>
      {tab === 'review' && <ForecastReviewPage review={connected ? sync.data?.forecastReview : JSON.parse(localStorage.getItem('synthetic-forecast-review') ?? 'null')}
        loading={connected ? sync.loading : state === 'review-loading'}
        error={connected ? sync.error : state === 'review-error' ? '同期を完了できませんでした。' : null}
        onRefresh={connected ? refresh : undefined} />}
      {tab === 'groups' && <GroupWorkspace {...props} />}{tab === 'anchors' && <FinalForecastPage {...props} anchorMode />}{tab === 'ability' && <AbilityPage {...props} />}{tab === 'pace' && <PacePage {...props} />}{tab === 'odds' && <WinOddsPage {...props} />}{tab === 'final' && <FinalForecastPage {...props} />}
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<Demo />)
