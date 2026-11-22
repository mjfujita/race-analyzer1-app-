import { Target, LayoutDashboard, History, Database, LogOut, Gauge, Route, TrendingUp, Layers, ShieldCheck } from 'lucide-react'

const mainItems = [
  ['today', '本日のレース', LayoutDashboard], ['anchors', '予想・軸選択', Target],
  ['forecastReview', '振り返り', History], ['automation', 'データ管理', Database],
]
const raceItems = [['groups', 'グループ・買い目', Layers], ['anchors', '軸候補', Target], ['ability', '能力・適性', Gauge], ['winOdds', 'オッズ推移', TrendingUp], ['pace', '展開・馬場', Route]]
export const isRacePage = tab => raceItems.some(([id]) => id === tab)

export default function WorkspaceShell({ tab, onNavigate, onLogout, email, children, raceHeader, footer }) {
  const active = isRacePage(tab) ? 'anchors' : tab === 'records' ? 'forecastReview' : ['races'].includes(tab) ? 'today' : tab
  const nav = mobile => <nav aria-label={mobile ? 'モバイル開催メニュー' : '開催メニュー'} className={mobile ? 'rca-bottom-nav' : 'rca-main-nav'}>
    {mainItems.map(([id, label, Icon]) => <button key={id} type="button" aria-current={active === id ? 'page' : undefined} onClick={() => onNavigate(id)}><Icon size={18} aria-hidden="true" /><span>{label}</span></button>)}
  </nav>
  return <div className="rca-app">
    <header className="rca-topbar"><button type="button" className="rca-brand" onClick={() => onNavigate('today')} aria-label="本日のレースへ"><span className="rca-brand-icon"><Target size={25} /></span><span><b>Race Condition Analyzer</b><small>軸馬を選ぶためのレース分析</small></span></button>{nav(false)}
      <div className="flex gap-3 items-center"><button type="button" className="rca-account" onClick={()=>onNavigate('devices')} aria-label="端末認証"><ShieldCheck size={18} /><span>端末認証</span></button><button type="button" className="rca-account" onClick={onLogout} title={`${email ?? ''} の端末承認を解除`} aria-label="ログアウト"><LogOut size={16} /></button></div></header>
    <main className="rca-workspace">{raceHeader}{isRacePage(tab) && <nav className="rca-race-nav" aria-label="選択中のレースの分析">{raceItems.map(([id, label, Icon]) => <button key={id} type="button" onClick={() => onNavigate(id)} aria-current={tab === id ? 'page' : undefined}><Icon size={17} aria-hidden="true" />{label}</button>)}</nav>}{children}<footer className="rca-footer">{footer}<span>JRDBの情報を基に判断を支援 · 購入は利用者が行います</span></footer></main>{nav(true)}
  </div>
}
