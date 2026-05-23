import React, { useEffect, useState, useMemo } from 'react'
import { supabase } from './supabase'
import { loadDb, queryAll } from './lib/db'

// ============================================================================
// constants
// ============================================================================
const PLACE_NAMES = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
}
const SURFACE_NAMES = { '1': '芝', '2': 'ダ', '3': '障' }

const ABILITY_COLORS = {
  S: 'text-rose-500 font-black',
  'A+': 'text-orange-500 font-black',
  A: 'text-amber-500 font-bold',
  'B+': 'text-emerald-500 font-bold',
  B: 'text-sky-500 font-semibold',
  'C+': 'text-slate-400 font-medium',
}
const EVAL_COLORS = {
  '◎': 'bg-rose-500',
  '○': 'bg-orange-500',
  '△': 'bg-sky-500',
  '×': 'bg-slate-400',
}
const MOTIVATION_COLORS = {
  '🔥 仕上がり万全': 'bg-rose-50 text-rose-700 border-rose-200',
  '🟢 標準的に良好': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '⚪ 普通': 'bg-slate-50 text-slate-600 border-slate-200',
  '💤 物足りず': 'bg-sky-50 text-sky-700 border-sky-200',
  '調教データなし': 'bg-slate-50 text-slate-400 border-slate-200',
}

function formatJrdbDate(s) {
  if (!s || s.length !== 8) return s
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

// ============================================================================
// LoginPage
// ============================================================================
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      onLogin(data.session)
    } catch (err) {
      setError(err?.message || 'ログインに失敗しました')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <p className="text-white font-black text-xl">Race Condition Analyzer</p>
          <p className="text-slate-400 text-xs mt-1">個人専用 / プライベート</p>
        </div>
        <form onSubmit={submit} className="bg-slate-800 rounded-xl border border-slate-700 p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-2">メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-2">パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500" />
          </div>
          {error && (
            <p className="text-xs text-rose-400 bg-rose-900/30 px-3 py-2 rounded-lg border border-rose-800">{error}</p>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-lg font-bold text-sm disabled:opacity-50">
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ============================================================================
// Race list view
// ============================================================================
function RaceListView({ db, selectedDate, dates, onDateChange, onSelectRace }) {
  const races = useMemo(() => {
    if (!selectedDate) return []
    return queryAll(
      db,
      `SELECT race_key, place_code, race_no, post_time, distance, surface_code,
              grade, field_size, race_name, prize_1st
       FROM jrdb_races WHERE race_date = ?
       ORDER BY place_code, race_no`,
      [selectedDate],
    )
  }, [db, selectedDate])

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <label className="text-xs text-slate-400">開催日</label>
        <select value={selectedDate} onChange={(e) => onDateChange(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm">
          {dates.map((d) => (
            <option key={d.race_date} value={d.race_date}>
              {formatJrdbDate(d.race_date)} ({d.n}R)
            </option>
          ))}
        </select>
      </div>
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-700/60 text-xs text-slate-300">
            <tr>
              <th className="text-left px-3 py-2">場</th>
              <th className="text-left px-3 py-2">R</th>
              <th className="text-left px-3 py-2">発走</th>
              <th className="text-left px-3 py-2">レース名</th>
              <th className="text-right px-3 py-2">距離</th>
              <th className="text-left px-3 py-2">芝/ダ</th>
              <th className="text-left px-3 py-2">G</th>
              <th className="text-right px-3 py-2">頭数</th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => (
              <tr key={r.race_key} onClick={() => onSelectRace(r.race_key)}
                className="border-t border-slate-700/60 hover:bg-emerald-900/20 cursor-pointer">
                <td className="px-3 py-2">{PLACE_NAMES[r.place_code] || r.place_code}</td>
                <td className="px-3 py-2">{r.race_no}R</td>
                <td className="px-3 py-2">{r.post_time}</td>
                <td className="px-3 py-2 text-emerald-300 font-medium">{r.race_name || '—'}</td>
                <td className="px-3 py-2 text-right">{r.distance}m</td>
                <td className="px-3 py-2">{SURFACE_NAMES[r.surface_code] || r.surface_code}</td>
                <td className="px-3 py-2">{r.grade || ''}</td>
                <td className="px-3 py-2 text-right">{r.field_size}</td>
              </tr>
            ))}
            {races.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-slate-500 text-sm">
                  この日のレース情報はありません
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// Race detail view (horses + badges)
// ============================================================================
function HorseBadges({ horse }) {
  const badges = []
  if (horse.phase) badges.push({ key: 'phase', cls: 'bg-slate-200 text-slate-700', title: horse.phase.detail, text: `${horse.phase.icon} ${horse.phase.label}` })
  if (horse.upgrade) badges.push({ key: 'upgrade', cls: 'bg-purple-100 text-purple-700', title: horse.upgrade.detail, text: `${horse.upgrade.icon} ${horse.upgrade.label}` })
  if (horse.class_challenge) badges.push({ key: 'cc', cls: 'bg-orange-100 text-orange-700', title: horse.class_challenge.detail, text: `${horse.class_challenge.icon} ${horse.class_challenge.label}` })
  if (horse.prize_chase) badges.push({ key: 'pc', cls: 'bg-yellow-100 text-yellow-700', title: horse.prize_chase.detail, text: `${horse.prize_chase.icon} ${horse.prize_chase.label}` })
  if (horse.crown) {
    const cls = horse.crown.count >= 4 ? 'bg-rose-100 text-rose-800' : horse.crown.count === 3 ? 'bg-orange-100 text-orange-800' : 'bg-amber-100 text-amber-800'
    badges.push({ key: 'crown', cls, title: `4指標のうち ${horse.crown.count} 指標で1位`, text: horse.crown.label })
  } else {
    if (horse.ability_rank_in_race === 1) badges.push({ key: 'a1', cls: 'bg-blue-100 text-blue-700', title: 'レース内能力1位', text: '🥇能力1位' })
    if (horse.motivation_rank_in_race === 1) badges.push({ key: 'm1', cls: 'bg-rose-100 text-rose-700', title: 'レース内本気度1位', text: '🔥本気1位' })
    if (horse.oikiri_rank_in_race === 1) badges.push({ key: 'o1', cls: 'bg-emerald-100 text-emerald-700', title: 'レース内追切指数1位', text: '💨追切1位' })
    if (horse.shimai_rank_in_race === 1) badges.push({ key: 's1', cls: 'bg-violet-100 text-violet-700', title: 'レース内終いF指数1位', text: '⚡終い1位' })
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {badges.map((b) => (
        <span key={b.key} title={b.title}
          className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${b.cls}`}>
          {b.text}
        </span>
      ))}
    </div>
  )
}

function PastRunsRow({ runs }) {
  if (!runs || runs.length === 0) return <span className="text-slate-500 text-xs">過去走なし</span>
  const recent = runs.slice(0, 5)
  return (
    <div className="text-[11px] text-slate-300 space-y-0.5">
      {recent.map((r, i) => (
        <div key={i} className="flex gap-2">
          <span className="text-slate-500 w-20">{r.date}</span>
          <span className="w-12">{r.rank ? `${r.rank}着` : '-'}</span>
          <span className="w-16">{r.distance}m{r.surface || ''}</span>
          <span className="text-slate-400 truncate">{r.race_name || ''}</span>
        </div>
      ))}
    </div>
  )
}

function RaceDetailView({ db, raceKey, onBack }) {
  const [evaluation, setEvaluation] = useState(null)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState('eval')
  const [expandedHorseId, setExpandedHorseId] = useState(null)

  useEffect(() => {
    setError('')
    setEvaluation(null)
    setExpandedHorseId(null)
    try {
      const rows = queryAll(
        db,
        'SELECT payload FROM race_evaluations WHERE race_key = ?',
        [raceKey],
      )
      if (rows.length === 0) {
        setError('このレースには評価データがありません（evaluate_all.py の再実行が必要かも）')
        return
      }
      setEvaluation(JSON.parse(rows[0].payload))
    } catch (err) {
      setError(err?.message || '評価データの読み込み失敗')
    }
  }, [db, raceKey])

  const sortedHorses = useMemo(() => {
    if (!evaluation?.horses) return []
    const evalOrder = { '◎': 0, '○': 1, '△': 2, '×': 3 }
    return [...evaluation.horses].sort((a, b) => {
      if (sortKey === 'no') return a.no - b.no
      if (sortKey === 'ability') return (b.abilityScore || 0) - (a.abilityScore || 0)
      if (sortKey === 'motivation') return (b.motivation?.score ?? -99) - (a.motivation?.score ?? -99)
      // eval
      const ea = evalOrder[a.eval] ?? 99
      const eb = evalOrder[b.eval] ?? 99
      if (ea !== eb) return ea - eb
      return (b.abilityScore || 0) - (a.abilityScore || 0)
    })
  }, [evaluation, sortKey])

  if (error) {
    return (
      <div>
        <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300 mb-3">
          ← レース一覧に戻る
        </button>
        <div className="bg-rose-900/40 border border-rose-700 text-rose-200 text-sm px-4 py-3 rounded">
          {error}
        </div>
      </div>
    )
  }
  if (!evaluation) {
    return (
      <div>
        <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300 mb-3">
          ← レース一覧に戻る
        </button>
        <div className="text-slate-400 text-sm">読み込み中...</div>
      </div>
    )
  }

  const { race, summary, horses, raceType } = evaluation

  return (
    <div>
      <button onClick={onBack} className="text-xs text-emerald-400 hover:text-emerald-300 mb-3">
        ← レース一覧に戻る
      </button>

      {/* レースヘッダ */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 mb-4">
        <div className="flex items-start justify-between mb-2">
          <div>
            <p className="text-xs text-slate-400">{race?.date} / {race?.course} / {race?.distance}</p>
            <h2 className="text-xl font-black text-white mt-1">{race?.name || '—'}</h2>
          </div>
          <div className="text-right text-xs text-slate-400">
            <div>{race?.fieldSize}頭立て</div>
            {race?.class && race.class !== '—' && <div className="text-emerald-300 font-bold mt-1">{race.class}</div>}
          </div>
        </div>
        {raceType && (
          <div className="inline-flex items-center px-3 py-1 rounded-full text-xs font-bold bg-emerald-900/50 text-emerald-200 border border-emerald-700/50 mt-2"
            title={raceType.detail}>
            {raceType.icon} {raceType.label}
          </div>
        )}
        <div className="mt-3 flex gap-4 text-xs text-slate-300">
          <span>◎ <b className="text-rose-300">{summary?.honmei || 0}</b></span>
          <span>○ <b className="text-orange-300">{summary?.taikou || 0}</b></span>
          <span>△ <b className="text-sky-300">{summary?.himo || 0}</b></span>
          <span>× <b className="text-slate-400">{summary?.keshi || 0}</b></span>
          <span className="text-slate-500">/ 計 {summary?.total || horses?.length || 0}</span>
        </div>
      </div>

      {/* ソート */}
      <div className="flex items-center gap-3 mb-2">
        <label className="text-xs text-slate-400">並べ替え</label>
        <select value={sortKey} onChange={(e) => setSortKey(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-1 text-xs">
          <option value="eval">評価順 (◎→×)</option>
          <option value="no">馬番順</option>
          <option value="ability">能力スコア順</option>
          <option value="motivation">本気度順</option>
        </select>
      </div>

      {/* 馬一覧 */}
      <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-700/60 text-xs text-slate-300">
            <tr>
              <th className="text-center px-2 py-2 w-12">馬番</th>
              <th className="text-left px-2 py-2">馬名 / バッジ</th>
              <th className="text-center px-2 py-2 w-12">能力</th>
              <th className="text-center px-2 py-2 w-32">本気度</th>
              <th className="text-center px-2 py-2 w-12">評価</th>
              <th className="text-center px-2 py-2 w-8"></th>
            </tr>
          </thead>
          <tbody>
            {sortedHorses.map((h) => {
              const isOpen = expandedHorseId === h.id
              return (
                <React.Fragment key={h.id}>
                  <tr onClick={() => setExpandedHorseId(isOpen ? null : h.id)}
                    className="border-t border-slate-700/60 hover:bg-emerald-900/10 cursor-pointer">
                    <td className="px-2 py-2 text-center font-bold">{h.no}</td>
                    <td className="px-2 py-2">
                      <div className="font-bold text-white">{h.name}</div>
                      <div className="mt-1"><HorseBadges horse={h} /></div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className={`text-lg ${ABILITY_COLORS[h.abilityRank] || 'text-slate-400'}`}>{h.abilityRank}</div>
                      <div className="text-[10px] text-slate-500 tabular-nums">{h.abilityScore}</div>
                    </td>
                    <td className="px-2 py-2 text-center">
                      {h.motivation ? (
                        <>
                          <span title={h.motivation.detail}
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${MOTIVATION_COLORS[h.motivation.label] || MOTIVATION_COLORS['調教データなし']}`}>
                            {h.motivation.icon} {h.motivation.label}
                          </span>
                          <div className="text-[10px] text-slate-500 tabular-nums mt-0.5">
                            {h.motivation.score >= 0 ? `+${h.motivation.score}` : h.motivation.score}
                          </div>
                        </>
                      ) : <span className="text-slate-500 text-xs">—</span>}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <div className={`w-7 h-7 mx-auto rounded-full flex items-center justify-center font-bold text-sm ${EVAL_COLORS[h.eval] || 'bg-slate-500'} text-white`}>
                        {h.eval}
                      </div>
                    </td>
                    <td className="px-2 py-2 text-center text-slate-500 text-xs">{isOpen ? '▴' : '▾'}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-t border-slate-700/30 bg-slate-900/40">
                      <td colSpan={6} className="px-4 py-3">
                        <div className="grid md:grid-cols-2 gap-4">
                          <div>
                            <p className="text-[11px] font-bold text-slate-400 mb-1">勝ち条件</p>
                            <p className="text-xs text-slate-200">
                              {h.winConditions?.distance || '-'} / {h.winConditions?.position || '-'}
                            </p>
                            <p className="text-[11px] font-bold text-slate-400 mb-1 mt-2">負け条件</p>
                            <p className="text-xs text-slate-200">
                              {h.loseConditions?.distance || '-'} / {h.loseConditions?.going || '-'}
                            </p>
                            {h.comment && (
                              <>
                                <p className="text-[11px] font-bold text-slate-400 mb-1 mt-2">コメント</p>
                                <p className="text-xs text-slate-200">{h.comment}</p>
                              </>
                            )}
                          </div>
                          <div>
                            <p className="text-[11px] font-bold text-slate-400 mb-1">過去走（最新5走）</p>
                            <PastRunsRow runs={h.pastRuns} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============================================================================
// Dashboard (top container)
// ============================================================================
function Dashboard({ session, onLogout }) {
  const [db, setDb] = useState(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 0, fromCache: false })
  const [error, setError] = useState('')
  const [dates, setDates] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [selectedRaceKey, setSelectedRaceKey] = useState(null)

  useEffect(() => {
    let cancelled = false
    setError('')
    loadDb({ onProgress: (p) => !cancelled && setProgress(p) })
      .then((d) => {
        if (cancelled) return
        setDb(d)
        const ds = queryAll(
          d,
          'SELECT race_date, COUNT(*) AS n FROM jrdb_races GROUP BY race_date ORDER BY race_date DESC LIMIT 30',
        )
        setDates(ds)
        if (ds[0]) setSelectedDate(ds[0].race_date)
      })
      .catch((err) => !cancelled && setError(err?.message || 'DB読み込み失敗'))
    return () => { cancelled = true }
  }, [])

  const refresh = async () => {
    setProgress({ loaded: 0, total: 0, fromCache: false })
    setDb(null)
    try {
      const d = await loadDb({ forceRefresh: true, onProgress: setProgress })
      setDb(d)
    } catch (err) {
      setError(err?.message || 'DB再読込失敗')
    }
  }

  const pct = progress.total ? Math.round((progress.loaded / progress.total) * 100) : 0
  const mb = (n) => (n / 1024 / 1024).toFixed(1)

  return (
    <div className="min-h-screen text-slate-100">
      <header className="border-b border-slate-700 bg-slate-800 px-6 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-black text-white">Race Condition Analyzer</h1>
          <p className="text-xs text-slate-400">{session.user?.email}</p>
        </div>
        <div className="flex items-center gap-3">
          <button onClick={refresh} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded font-bold">
            DB再取得
          </button>
          <button onClick={onLogout} className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded font-bold">
            ログアウト
          </button>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto">
        {error && (
          <div className="mb-4 bg-rose-900/40 border border-rose-700 text-rose-200 text-sm px-4 py-3 rounded">
            {error}
          </div>
        )}
        {!db && !error && (
          <div className="bg-slate-800 border border-slate-700 rounded-xl p-6 text-center">
            <p className="text-sm text-slate-300 mb-3">
              race.db を読み込み中… {progress.fromCache ? '（キャッシュ）' : ''}
              {progress.phase === 'decompress' && '（解凍中）'}
            </p>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all"
                style={{ width: progress.total ? `${pct}%` : '10%' }} />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {mb(progress.loaded)} MB
              {progress.total ? ` / ${mb(progress.total)} MB (${pct}%)` : ''}
            </p>
          </div>
        )}

        {db && (selectedRaceKey
          ? <RaceDetailView db={db} raceKey={selectedRaceKey} onBack={() => setSelectedRaceKey(null)} />
          : <RaceListView db={db} selectedDate={selectedDate} dates={dates}
              onDateChange={setSelectedDate} onSelectRace={setSelectedRaceKey} />
        )}
      </main>
    </div>
  )
}

// ============================================================================
// App
// ============================================================================
export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])

  const logout = async () => {
    await supabase.auth.signOut()
    setSession(null)
  }

  if (loading)
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )

  return session
    ? <Dashboard session={session} onLogout={logout} />
    : <LoginPage onLogin={setSession} />
}
