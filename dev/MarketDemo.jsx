import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import AbilityPage from '../src/AbilityPage.jsx'
import PacePage from '../src/PacePage.jsx'
import WinOddsPage from '../src/WinOddsPage.jsx'
import ForecastReviewPage from '../src/ForecastReviewPage.jsx'
import FinalForecastPage from '../src/FinalForecastPage.jsx'
import { oddsStorageKey } from '../src/oddsHistory.js'
import { syncLedgerToCloud } from '../src/cloudStore.js'
import { race, horses, statistics, earlierRaces, demoSnapshots } from './fixtures.js'

const state = new URLSearchParams(location.search).get('state') ?? 'normal'
const userId = `synthetic-demo-${state}`
if (state !== 'empty' && !localStorage.getItem(oddsStorageKey(userId, race))) {
  localStorage.setItem(oddsStorageKey(userId, race), state === 'error' ? '{broken' : JSON.stringify(demoSnapshots()))
}
function Demo() {
  const [tab, setTab] = useState(state.startsWith('review') ? 'review' : 'final')
  const [cloudRevision, setCloudRevision] = useState(0)
  const empty = state === 'empty'
  const props = { race, horses, statistics: empty ? [] : statistics, earlierRaces, userId, cloudRevision,
    onSyncLedger: state === 'cloud-test' ? syncLedgerToCloud : undefined,
    onOpenAbility: () => setTab('ability'), onOpenPace: () => setTab('pace'), onSelectRace: () => {}, onSelectHorse: () => {} }
  return <div className="min-h-screen bg-slate-100 pb-16 text-slate-900">
    <header className="border-b border-slate-200 bg-white px-4 py-5"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><div><p className="text-lg font-black text-[#0B2545]">Race Condition Analyzer</p><p className="text-xs text-slate-500">開発確認 · 架空の8頭 · 本番データに接続しません</p></div><span className="rounded-full bg-amber-100 px-3 py-1 text-xs text-amber-900">架空データの操作確認</span></div></header>
    <main className="mx-auto max-w-[1440px] px-3 py-5 sm:px-6"><nav aria-label="レースの分析" className="mb-5 flex flex-wrap gap-2">{[['ability','能力・適性'],['pace','展開・天候'],['odds','市場評価差'],['final','最終予想・記録'],['review','振り返り']].map(([id,label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} className={`rounded-xl px-4 py-2 text-sm font-semibold ${tab === id ? 'bg-[#0B2545] text-white' : 'bg-white text-slate-700'}`} onClick={() => setTab(id)}>{label}</button>)}<button type="button" className="rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-600" onClick={() => setCloudRevision(value => value + 1)}>同期データを再読込（開発確認）</button></nav>
      {tab === 'review' && <ForecastReviewPage review={JSON.parse(localStorage.getItem('synthetic-forecast-review') ?? 'null')}
        loading={state === 'review-loading'} error={state === 'review-error' ? '同期を完了できませんでした。' : null} />}
      {tab === 'ability' && <AbilityPage {...props} />}{tab === 'pace' && <PacePage {...props} />}{tab === 'odds' && <WinOddsPage {...props} />}{tab === 'final' && <FinalForecastPage {...props} />}
    </main>
  </div>
}
createRoot(document.getElementById('root')).render(<Demo />)
