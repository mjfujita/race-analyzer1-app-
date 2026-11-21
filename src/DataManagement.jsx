import { formatRaceTime } from './raceTime.js'
import { useState } from 'react'
import AutomationPanel from './AutomationPanel.jsx'
import ForecastReviewPage from './ForecastReviewPage.jsx'
import RaceDataPanel, { readRaceData } from './RaceDataPanel.jsx'
import { ledgerScope } from './forecastLedger.js'
import DisplaySettings from './DisplaySettings.jsx'

function Recovery({ scope }) {
  const [data,setData] = useState(() => readRaceData(scope))
  return <RaceDataPanel scope={scope} data={data} onChange={setData} />
}

export default function DataManagement({ userId, race, sync, onRefresh, onSelectRace, onRefreshDb, onOpenArchive, settingsChanged, diagnostics }) {
  const [tab, setTab] = useState('capture')
  const scope = race ? ledgerScope(userId,race) : null
  const snapshot = [...(sync.data?.snapshots ?? [])].sort((a,b) => Date.parse(b.retrievedAt) - Date.parse(a.retrievedAt))[0]
  return <div><div className="rca-page-title"><div><h1>データ管理</h1><p>取得状況・学習の検証・表示条件を確認します。</p></div></div>
    <nav className="rca-data-nav" aria-label="データ管理の項目">{[['capture','取得状況'],['learning','学習・検証'],['settings','表示・運用設定']].map(([id,label]) => <button key={id} type="button" aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}</button>)}</nav>
    {tab === 'settings' ? <DisplaySettings userId={userId} onSaved={settingsChanged} onOpenCapture={() => setTab('capture')} /> : tab === 'learning' ? <div className="rca-stack">
      <section className="rca-panel"><h2>学習から採用まで</h2><div className="grid gap-3 sm:grid-cols-4">{[['1','受領と結果の照合'],['2','開催日順に学習'],['3','未使用期間で比較'],['4','改善時だけ採用']].map(([n,label]) => <div key={n} className="rounded-xl bg-slate-50 p-4"><p className="font-bold text-blue-600">{n}</p><p className="mt-2 font-semibold">{label}</p></div>)}</div><p className="rca-muted mt-4">未来の結果を入力に混ぜず、校正前・候補版・従来採用版を同じ期間で比較します。劣化・結果訂正による自動採用停止は常時有効です。</p></section>
      <AutomationPanel sync={sync} view="learning" />
      <ForecastReviewPage view="learning" review={sync.data?.forecastReview} />
      {!sync.data?.forecastReview && <p className="rca-notice">独立評価の集計は未取得です。同期後に比較値・モデル採用履歴を表示します。</p>}
    </div> : <div className="rca-stack"><section className="rca-panel"><h2>取得用Macから画面まで</h2><div className="grid gap-4 sm:grid-cols-3">{[['JRDBでの観測時刻',snapshot?.observedAt,'表示元を観測した時刻'],['Macで取得した時刻',snapshot?.retrievedAt,'実際に読み取れた時刻'],['画面への同期',sync.syncedAt,'このブラウザが受信した時刻']].map(([label,time,help]) => <div className="rounded-xl bg-slate-50 p-4" key={label}><p className="rca-muted">{label}</p><p className="mt-2 font-bold tabular-nums">{formatRaceTime(time)}</p><p className="rca-muted">{help}</p></div>)}</div><p className="rca-muted mt-3">観測・取得は選択中レースの記録です。未取得の時刻は推測しません。クラウドの観測単位の受領時刻は未確認です。</p></section><AutomationPanel sync={sync} onRefresh={onRefresh} onSelectRace={onSelectRace} view="capture" />
      <section className="rca-panel"><h2>詳細・復旧</h2><details><summary>PACI・過去開催・取得エラーを確認する</summary><p className="rca-muted">既存のPACIデータと保存履歴は維持しています。データベースの再取得は保存済みの予想台帳を削除しません。</p><div className="flex flex-wrap gap-3"><button type="button" className="rca-secondary" onClick={onOpenArchive}>過去開催・PACIレース一覧</button><button type="button" className="rca-secondary" onClick={onRefreshDb}>PACIデータベースを再取得</button></div><p className="rca-muted mt-3">{diagnostics}</p></details><details><summary>直前情報・払戻の取込エラーを補完する</summary><p className="rca-muted">通常は自動取得を使います。補完は選択したレースのブラウザ記録に追記します。</p>{scope ? <Recovery key={`${scope.userId}:${scope.raceDate}:${scope.raceId}`} scope={scope} /> : <p className="rca-notice">先に対象レースを選んでから、この項目を開いてください。</p>}</details></section>
    </div>}
  </div>
}
