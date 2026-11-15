import { Activity, RefreshCw, Database, Clock, CheckCircle2 } from 'lucide-react'
import { formatRaceTime, raceDateISO } from './raceTime.js'

const stateNames = { partial: '一部の取得を再試行中', not_connected: '未接続', running: '取得中', ready: '正常', idle: '待機中', waiting: '次の取得時刻まで待機', auth_required: 'JRDBへのログインが必要', auth_expired: 'JRDBのログイン切れ', error: '取得エラー', stopped: '停止中', completed: '今回の取得完了', learning: '学習中' }
const modelNames = { contextModel: '天候・展開・状態', marketModel: '市場校正・能力との統合', closingOddsModel: '最終オッズの推定' }
const placeNames = { '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京', '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉' }
const modelReasons = {
  'At least 60 complete races across 15 dates are required for three chronological partitions': '学習・校正・検証を開催日順に分けるため、必要な情報が揃った60レース以上・15開催日以上の記録を待っています。',
  'No prerace running styles': '出走前の脚質データが不足しています。',
  'At least 30 training-period races with each varying context feature are required': '各条件の影響を学ぶため、学習期間内にその条件の違いを比較できる30レース以上の記録を待っています。',
  'All three chronological periods need valid decision-to-closing price pairs': '学習・校正・検証の各期間に、判断時点のオッズと最終オッズが対になった記録が必要です。',
}
const postTimeLabel = value => {
  const raw = String(value ?? '').replace(':', '')
  return /^(?:[01]\d|2[0-3])[0-5]\d$/.test(raw) ? `${raw.slice(0, 2)}:${raw.slice(2)}` : '時刻確認中'
}
const placeLabel = race => {
  const value = race.place ?? race.placeCode ?? race.place_code
  return placeNames[String(value ?? '').padStart(2, '0')] ?? value ?? '会場確認中'
}
const modelReason = item => {
  const reason = item?.reason ?? item?.message
  return modelReasons[reason] ?? reason ?? '時刻と結果が揃った記録で評価し、採用条件を満たすまで自動加点しません。'
}
export default function AutomationPanel({ sync, onRefresh, onSelectRace }) {
  const payload = sync?.data ?? {}
  const status = payload.status ?? {}
  const models = payload.models?.runtimeModel
  const available = payload.availableRaces ?? []
  const last = status.lastRunAt ?? status.updatedAt ?? status.generatedAt
  const stale = last && Date.now() - Date.parse(last) > 10 * 60000
  const syncFailed = status.sync?.code === 'sync_failed' || status.sync?.state === 'failed' || status.state === 'sync_failed'
    || (Array.isArray(status.failures) && status.failures.some(item => item?.code === 'sync_failed'))
  const lastState = syncFailed ? 'データ送信失敗・再試行待ち' : stale ? 'しばらく応答がありません' : stateNames[status.state] ?? (last ? status.state : '未接続')
  return <div className="space-y-5">
    <section className="rounded-2xl bg-[#0B2545] p-6 text-white"><p className="font-mono text-xs tracking-widest text-cyan-300">OBSERVE → PREDICT → RECORD → LEARN</p><h2 className="mt-2 flex items-center gap-2 text-xl font-bold"><Activity />自動取得と学習</h2><p className="mt-3 max-w-3xl text-sm text-slate-200">PCの取得ワーカーがJRDBを巡回し、時刻付きの情報と学習結果をこの画面へ同期します。発走10分前の情報で判断し、結果と払戻は検証用に蓄積します。</p></section>
    <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 font-bold"><Database size={18} />収集と同期の状態</h3><button type="button" className="flex items-center gap-2 rounded-lg bg-[#0B2545] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={sync?.loading} onClick={onRefresh}><RefreshCw size={16} className={sync?.loading ? 'animate-spin' : ''} />{sync?.loading ? '同期中…' : '今すぐ同期'}</button></div>
      {sync?.error && <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{sync.error} ブラウザの記録は保持しています。</p>}
      <div className="grid gap-3 sm:grid-cols-3">{[['最後に届いた取得状態', lastState], ['最終稼働', formatRaceTime(last)], ['画面への同期', formatRaceTime(sync?.syncedAt)]].map(([title,value])=><div key={title} className="rounded-xl bg-slate-50 p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-2 text-sm font-semibold">{value ?? '—'}</p></div>)}</div>
      {syncFailed && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">取得データのクラウド送信が完了していません。画面に表示されているのは、最後に送信できたデータです。</p>}
      {stale && <p className="text-xs text-amber-800">最後の稼働記録から10分以上経過しています。現在の取得・送信状態は確認できていません。</p>}
      <p className="text-xs text-slate-500">取得データの最終送信成功：{formatRaceTime(status.lastFullSyncAt ?? status.lastSuccessfulDataSyncAt)}。状態通知や画面の同期時刻とは区別します。</p>
      <p className="text-xs leading-relaxed text-slate-500">PCが起動し、ネットワークとJRDB認証が有効な間に取得します。時刻は取得の証拠として保存し、ログイン切れ・取得失敗・古い情報を成功扱いにはしません。購入操作は行いません。</p>
      {status.message && <p className="text-sm text-amber-800">{status.message}</p>}
      <div className="flex flex-wrap gap-2 text-xs">{[60,30,20,15,12,11,10].map(min=><span key={min} className="flex items-center gap-1 rounded-full bg-cyan-50 px-3 py-2 text-cyan-900"><Clock size={12} />発走{min}分前</span>)}<span className="rounded-full bg-slate-100 px-3 py-2">締切後も結果・最終価格・払戻を追跡</span></div>
    </section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-4 font-bold">学習モデルの状態</h3><div className="grid gap-3 lg:grid-cols-3">{Object.entries(modelNames).map(([key,title])=>{const item=models?.[key];return <div key={key} className="rounded-xl border border-slate-200 p-4"><p className="font-semibold">{title}</p><p className={`mt-2 text-sm ${item?.status==='ready'?'text-teal-700':'text-amber-800'}`}>{item?.status==='ready'?'学習済み・適用条件を確認して使用':'学習データを蓄積中'}</p><p className="mt-2 text-xs leading-relaxed text-slate-500">{modelReason(item)}</p>{item?.status==='insufficient-data' && item.available && <p className="mt-2 text-xs text-slate-500">現在 {item.available.races??0}レース・{item.available.dates??0}開催日</p>}</div>})}</div><p className="mt-4 text-xs text-slate-500">モデル版 {models?.id ?? '未同期'} ／ 学習期限 {models?.trainedThrough ?? payload.models?.abilityModel?.trainedThrough ?? '—'}。学習済みであっても収益性の保証ではありません。</p></section>
    <section className="rounded-2xl border border-slate-200 bg-white p-5"><h3 className="mb-3 flex items-center gap-2 font-bold"><CheckCircle2 size={18} />取得済みレース</h3>{!available.length?<p className="text-sm text-slate-500">同期されたレースはまだありません。既存DBのレース分析は引き続き利用できます。</p>:<div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{available.map(race=><button key={`${race.raceDate}:${race.id??race.raceId}`} type="button" className="rounded-xl border border-slate-200 p-4 text-left text-sm hover:border-cyan-600 hover:bg-cyan-50" onClick={()=>onSelectRace?.(race)}><strong>{raceDateISO(race)?.replaceAll('-', '/') ?? '日付確認中'} {placeLabel(race)} {race.raceNo??''}R</strong><p className="mt-1">{race.name??race.raceName??race.id??race.raceId}</p><p className="mt-1 text-xs text-slate-500">{postTimeLabel(race.postTime??race.post_time)} 発走 ／ {race.fieldSize??'—'}頭</p></button>)}</div>}</section>
  </div>
}
