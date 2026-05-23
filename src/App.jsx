import React, { useState, useMemo, useEffect } from 'react'
import {
  ChevronRight, Search, Target, TrendingUp, AlertTriangle,
  CheckCircle2, XCircle, MinusCircle, Sparkles, ArrowUpDown,
  Activity, Info, Zap, Layers, GitCompare, Clock, LogOut,
} from 'lucide-react'
import { supabase } from './supabase'
import { loadDb, queryAll } from './lib/db'

// ================================================================
//  Race Condition Analyzer — Vercel + Supabase 版
//  ローカル版 (~/Documents/race-analyzer/src/App.jsx) の UI をそのまま移植。
//  fetch(http://localhost:8000/...) は全部 sql.js + race_evaluations への
//  読み込みに置き換え（API ラッパー dataApi.* 参照）。
// ================================================================

const PLACE_NAMES = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
}
const SURFACE_NAMES = { '1': '芝', '2': 'ダ', '3': '障' }

const EVAL_COLORS = {
  '◎': { text: 'text-[#0B2545]', bg: 'bg-[#0B2545]', border: 'border-[#0B2545]', lightBg: 'bg-[#0B2545]/10' },
  '○': { text: 'text-[#4A90E2]', bg: 'bg-[#4A90E2]', border: 'border-[#4A90E2]', lightBg: 'bg-[#4A90E2]/10' },
  '△': { text: 'text-slate-400', bg: 'bg-slate-400', border: 'border-slate-400', lightBg: 'bg-slate-100' },
  '×': { text: 'text-rose-400', bg: 'bg-rose-400', border: 'border-rose-400', lightBg: 'bg-rose-50' },
}
const EVAL_LABELS = { '◎': '本命', '○': '対抗', '△': '押さえ', '×': '消し' }
const ABILITY_COLORS = {
  S: 'text-[#0B2545] font-black',
  'A+': 'text-[#0B2545] font-bold',
  A: 'text-[#2B6CB0] font-bold',
  'B+': 'text-[#4A90E2]',
  B: 'text-slate-600',
  'C+': 'text-slate-400',
}
const MOTIVATION_COLORS = {
  '仕上がり万全': 'bg-rose-50 text-rose-700 border-rose-200',
  '標準的に良好': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '普通': 'bg-slate-100 text-slate-600 border-slate-200',
  '物足りず': 'bg-sky-50 text-sky-700 border-sky-200',
  '調教データなし': 'bg-slate-50 text-slate-400 border-slate-200',
}

// ================================================================
// データアクセスラッパー (sql.js -> ローカル版 API レスポンスと同じ形に整える)
// ================================================================
const dataApi = {
  getStats(db) {
    const r = queryAll(db, `
      SELECT
        (SELECT COUNT(*) FROM jrdb_races)   AS race_count,
        (SELECT COUNT(*) FROM jrdb_horses)  AS horse_count,
        (SELECT COUNT(*) FROM jrdb_results) AS result_count,
        (SELECT MIN(race_date) FROM jrdb_races) AS earliest,
        (SELECT MAX(race_date) FROM jrdb_races) AS latest
    `)[0]
    return {
      race_count: r.race_count,
      horse_count: r.horse_count,
      result_count: r.result_count,
      date_range: { earliest: r.earliest, latest: r.latest },
    }
  },
  getDates(db) {
    return queryAll(
      db,
      'SELECT race_date AS date, COUNT(*) AS race_count FROM jrdb_races GROUP BY race_date ORDER BY race_date DESC LIMIT 60',
    )
  },
  getRacesOfDate(db, date) {
    const rows = queryAll(
      db,
      `SELECT race_key, place_code, race_no, post_time, distance, surface_code,
              grade, field_size, race_name
       FROM jrdb_races WHERE race_date = ?
       ORDER BY place_code, race_no`,
      [date],
    )
    return rows.map((r) => ({
      ...r,
      place: PLACE_NAMES[r.place_code] || r.place_code,
      surface: SURFACE_NAMES[r.surface_code] || r.surface_code,
    }))
  },
  getEvaluation(db, raceKey) {
    const rows = queryAll(db, 'SELECT payload FROM race_evaluations WHERE race_key = ?', [raceKey])
    if (rows.length === 0) return null
    return JSON.parse(rows[0].payload)
  },
}

// ================================================================
// ログイン画面
// ================================================================
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
    <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#0B2545] to-[#4A90E2] flex items-center justify-center">
              <Target className="w-6 h-6 text-white" />
            </div>
            <div className="text-left">
              <p className="text-[#0B2545] font-black text-lg leading-none">Race Condition Analyzer</p>
              <p className="text-[10px] font-medium text-slate-500 tracking-wider mt-1">PROTOTYPE v0.1 / 個人専用</p>
            </div>
          </div>
        </div>
        <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-6 space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-2">メールアドレス</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4A90E2]/30" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-2">パスワード</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-2.5 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-[#4A90E2]/30" />
          </div>
          {error && <p className="text-xs text-rose-700 bg-rose-50 px-3 py-2 rounded-lg border border-rose-200">{error}</p>}
          <button type="submit" disabled={loading}
            className="w-full bg-[#0B2545] hover:bg-[#0B2545]/90 text-white py-2.5 rounded-lg font-bold text-sm disabled:opacity-50">
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ================================================================
// メインアプリ
// ================================================================
function MainApp({ session, onLogout }) {
  // ---------- DB 読み込み ----------
  const [db, setDb] = useState(null)
  const [dbProgress, setDbProgress] = useState({ loaded: 0, total: 0, fromCache: false })
  const [dbError, setDbError] = useState('')

  useEffect(() => {
    let cancelled = false
    loadDb({ onProgress: (p) => !cancelled && setDbProgress(p) })
      .then((d) => !cancelled && setDb(d))
      .catch((err) => !cancelled && setDbError(err?.message || 'DB読み込み失敗'))
    return () => { cancelled = true }
  }, [])

  const refreshDb = async () => {
    setDb(null)
    setDbError('')
    setDbProgress({ loaded: 0, total: 0, fromCache: false })
    try {
      const d = await loadDb({ forceRefresh: true, onProgress: setDbProgress })
      setDb(d)
    } catch (err) {
      setDbError(err?.message || 'DB再取得失敗')
    }
  }

  // ---------- 評価結果 (1レース) ----------
  const [raceInfo, setRaceInfo] = useState(null)
  const [horses, setHorses] = useState([])
  const [summary, setSummary] = useState({ total: 0, honmei: 0, taikou: 0, himo: 0, keshi: 0 })
  const [currentRaceKey, setCurrentRaceKey] = useState(null)

  const [tab, setTab] = useState('jrdb')
  const [selectedId, setSelectedId] = useState(null)
  const [sortKey, setSortKey] = useState('eval')
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')

  const selectedHorse = useMemo(() => horses.find((h) => h.id === selectedId), [horses, selectedId])

  // レース選択 → 評価データロード → list タブへ
  const loadAsTarget = (raceKey) => {
    if (!db) return
    try {
      const data = dataApi.getEvaluation(db, raceKey)
      if (!data) {
        alert('このレースには評価データがありません（evaluate_all.py の再実行が必要かも）')
        return
      }
      setRaceInfo(data.race)
      setHorses(data.horses)
      setSummary(data.summary)
      setCurrentRaceKey(raceKey)
      setSelectedId(data.horses[0]?.id || null)
      setTab('list')
    } catch (err) {
      console.error(err)
      alert('評価データの読み込みに失敗: ' + err.message)
    }
  }

  // ---------- 表示用ソート/フィルタ済み馬一覧 ----------
  const displayHorses = useMemo(() => {
    let list = [...horses]
    if (filter !== 'all') list = list.filter((h) => h.eval === filter)
    if (search) {
      const s = search.toLowerCase()
      list = list.filter((h) => (h.name || '').toLowerCase().includes(s) || (h.jockey || '').toLowerCase().includes(s))
    }
    list.sort((a, b) => {
      const evalMap = { '◎': 4, '○': 3, '△': 2, '×': 1 }
      const phaseMap = { '上昇': 7, '安定': 6, '条件再設定': 5, 'ムラ': 4, '下降': 3, '休養明け': 2, '経験浅': 1 }
      switch (sortKey) {
        case 'no': return a.no - b.no
        case 'eval': return (evalMap[b.eval] || 0) - (evalMap[a.eval] || 0)
        case 'ability': return (b.abilityScore || 0) - (a.abilityScore || 0)
        case 'match': return (b.matchScore || 0) - (a.matchScore || 0)
        case 'pop': return (a.expectedPop || 99) - (b.expectedPop || 99)
        case 'phase': return (phaseMap[b.phase?.label] || 0) - (phaseMap[a.phase?.label] || 0)
        case 'motivation': {
          const aS = a.motivation?.score, bS = b.motivation?.score
          if (aS == null && bS == null) return 0
          if (aS == null) return 1
          if (bS == null) return -1
          return bS - aS
        }
        default: return 0
      }
    })
    return list
  }, [filter, sortKey, search, horses])

  // ---------- DB ロード中 ----------
  if (!db) {
    const pct = dbProgress.total ? Math.round((dbProgress.loaded / dbProgress.total) * 100) : 0
    const mb = (n) => (n / 1024 / 1024).toFixed(1)
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm p-8 w-full max-w-md text-center">
          {dbError ? (
            <>
              <AlertTriangle className="w-10 h-10 mx-auto text-rose-400 mb-3" />
              <p className="text-sm text-rose-600 mb-3">{dbError}</p>
              <button onClick={refreshDb} className="text-xs bg-[#0B2545] text-white px-4 py-2 rounded font-bold">
                再試行
              </button>
            </>
          ) : (
            <>
              <div className="w-10 h-10 mx-auto border-4 border-[#4A90E2] border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-slate-700 font-medium mb-3">
                race.db を読み込み中… {dbProgress.fromCache ? '（キャッシュ）' : ''}
                {dbProgress.phase === 'decompress' && '（解凍中）'}
              </p>
              <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden mb-2">
                <div className="bg-[#4A90E2] h-full transition-all" style={{ width: dbProgress.total ? `${pct}%` : '10%' }} />
              </div>
              <p className="text-xs text-slate-500 tabular-nums">
                {mb(dbProgress.loaded)} MB
                {dbProgress.total ? ` / ${mb(dbProgress.total)} MB (${pct}%)` : ''}
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  // ---------- 共通: 判定ロジック (簡易部分一致) ----------
  const getMatchStatus = (winText, loseText, currentKeywords) => {
    const isWin = currentKeywords.some((k) => (winText || '').includes(k))
    const isLose = currentKeywords.some((k) => (loseText || '').includes(k))
    if (isWin) return 'win'
    if (isLose) return 'lose'
    return 'neutral'
  }

  // ================================================================
  // タブ: JRDB 実データ閲覧
  // ================================================================
  const TabJrdb = () => {
    const [dates, setDates] = useState([])
    const [stats, setStats] = useState(null)
    const [selectedDate, setSelectedDate] = useState(null)
    const [races, setRaces] = useState([])
    const [loadingKey, setLoadingKey] = useState(null)

    useEffect(() => {
      try {
        const ds = dataApi.getDates(db)
        setDates(ds)
        if (ds.length > 0) setSelectedDate(ds[0].date)
        setStats(dataApi.getStats(db))
      } catch (err) {
        console.error(err)
      }
    }, [])

    useEffect(() => {
      if (!selectedDate) return
      try {
        setRaces(dataApi.getRacesOfDate(db, selectedDate))
      } catch (err) {
        console.error(err)
      }
    }, [selectedDate])

    const openRace = (raceKey) => {
      setLoadingKey(raceKey)
      try {
        loadAsTarget(raceKey)
      } finally {
        setLoadingKey(null)
      }
    }

    const fmtTime = (t) => {
      if (!t || t.length < 4) return ''
      return `${t.slice(0, 2)}:${t.slice(2, 4)}`
    }

    const groups = []
    const idx = new Map()
    for (const r of races) {
      const key = r.place_code || r.place
      if (!idx.has(key)) {
        idx.set(key, groups.length)
        groups.push({ place: r.place, place_code: key, items: [] })
      }
      groups[idx.get(key)].items.push(r)
    }

    return (
      <div className="space-y-6 pb-12">
        {stats && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <span className="text-xs font-bold tracking-widest text-[#4A90E2] uppercase">JRDB 取り込みデータ</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold tracking-widest text-slate-500 uppercase">開催日</span>
                <select value={selectedDate || ''} onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-white border border-slate-200 text-sm font-medium text-slate-800 py-1.5 px-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4A90E2]">
                  {dates.map((d) => (
                    <option key={d.date} value={d.date}>
                      {d.date.slice(0, 4)}/{d.date.slice(4, 6)}/{d.date.slice(6, 8)} ({d.race_count}R)
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-slate-500 font-medium mb-1">レース総数</div>
                <div className="text-2xl font-bold tabular-nums text-[#0B2545]">{stats.race_count.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium mb-1">登録馬数</div>
                <div className="text-2xl font-bold tabular-nums text-[#0B2545]">{stats.horse_count.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium mb-1">過去走レコード</div>
                <div className="text-2xl font-bold tabular-nums text-[#0B2545]">{stats.result_count.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-xs text-slate-500 font-medium mb-1">対象期間</div>
                <div className="text-sm font-bold tabular-nums text-slate-700 mt-1">
                  {stats.date_range.earliest} 〜 {stats.date_range.latest}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="text-xs text-slate-500 px-1">
          レースをクリックすると、そのレースの能力評価画面が開きます。
        </div>

        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, minmax(0, 1fr))` }}>
          {groups.map((g) => (
            <div key={g.place_code} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
              <div className="px-4 py-3 bg-[#0B2545] text-white flex items-center justify-between">
                <span className="font-bold tracking-wide">{g.place}</span>
                <span className="text-xs font-medium text-slate-300">{g.items.length}R</span>
              </div>
              <div className="divide-y divide-slate-100">
                {g.items.map((r) => {
                  const isLoading = loadingKey === r.race_key
                  return (
                    <button key={r.race_key} onClick={() => openRace(r.race_key)} disabled={isLoading}
                      className={`w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5 ${
                        isLoading ? 'bg-[#4A90E2]/10' : 'hover:bg-slate-50 active:bg-[#4A90E2]/5'
                      }`}>
                      <div className="shrink-0 w-9 text-center">
                        <div className="text-sm font-bold text-[#0B2545] tabular-nums">{r.race_no}R</div>
                        <div className="text-[10px] text-slate-400 tabular-nums">{fmtTime(r.post_time)}</div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                          {r.grade && (
                            <span className="inline-flex items-center px-1.5 py-0 rounded text-[10px] font-bold bg-rose-50 text-rose-700 border border-rose-100">
                              {r.grade}
                            </span>
                          )}
                          <span className="truncate">{r.race_name}</span>
                        </div>
                        <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
                          {r.surface}{r.distance}m ・ {r.field_size}頭
                        </div>
                      </div>
                      <div className="shrink-0 self-center">
                        {isLoading ? (
                          <span className="text-[10px] text-[#4A90E2] font-bold">読込中</span>
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-300" />
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        {groups.length === 0 && (
          <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
            この開催日のレースデータがありません。
          </div>
        )}
      </div>
    )
  }

  // ================================================================
  // タブ: 一覧 & 詳細
  // ================================================================
  const TabListDetail = () => {
    if (!raceInfo || horses.length === 0) {
      return (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
          上部の「レースを切替」または「JRDB実データ」タブからレースを選んでください。
        </div>
      )
    }
    return (
      <div className="grid grid-cols-12 gap-6 items-start pb-12">
        {/* 左ペイン */}
        <div className="col-span-7 bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
            <h3 className="font-bold text-slate-800 flex items-center gap-2">
              出走馬一覧 <span className="text-xs font-normal text-slate-500">({displayHorses.length}頭)</span>
            </h3>
            <div className="flex gap-4">
              <div className="flex bg-slate-200 p-0.5 rounded-full">
                {['all', '◎', '○', '△', '×'].map((f) => (
                  <button key={f} onClick={() => setFilter(f)}
                    className={`px-3 py-1 text-xs font-bold rounded-full transition-all ${
                      filter === f ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'
                    }`}>
                    {f === 'all' ? '全て' : f}
                  </button>
                ))}
              </div>
              <div className="relative">
                <select className="appearance-none bg-white border border-slate-200 text-xs font-bold text-slate-700 py-1.5 pl-3 pr-8 rounded-full focus:outline-none focus:ring-1 focus:ring-[#4A90E2]"
                  value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="eval">評価順</option>
                  <option value="no">馬番順</option>
                  <option value="ability">能力順</option>
                  <option value="match">一致度順</option>
                  <option value="phase">フェーズ順</option>
                  <option value="motivation">本気度順</option>
                </select>
                <ArrowUpDown className="w-3 h-3 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs border-b border-slate-200">
                <tr>
                  <th className="py-3 px-4 font-semibold text-center w-12">馬番</th>
                  <th className="py-3 px-2 font-semibold">馬名 / 騎手</th>
                  <th className="py-3 px-2 font-semibold text-center w-14">能力</th>
                  <th className="py-3 px-2 font-semibold text-center w-28">本気度</th>
                  <th className="py-3 px-2 font-semibold">条件要約</th>
                  <th className="py-3 px-4 font-semibold w-32">今回一致度</th>
                  <th className="py-3 px-2 font-semibold text-center w-14">評価</th>
                  <th className="py-3 px-2 w-8"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayHorses.map((horse) => (
                  <tr key={horse.id} onClick={() => setSelectedId(horse.id)}
                    className={`cursor-pointer transition-colors group ${
                      selectedId === horse.id ? 'bg-[#4A90E2]/5' : 'hover:bg-slate-50'
                    }`}>
                    <td className="py-3 px-4 text-center">
                      <div className={`w-7 h-7 mx-auto rounded flex items-center justify-center font-bold text-slate-700 ${
                        selectedId === horse.id ? 'bg-white shadow-sm' : 'bg-slate-100'
                      }`}>{horse.no}</div>
                    </td>
                    <td className="py-3 px-2">
                      <div className="font-bold text-slate-900">{horse.name}</div>
                      <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                        <span>{horse.jockey || ''}</span>
                        {horse.phase && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-700">
                            {horse.phase.icon} {horse.phase.label}
                          </span>
                        )}
                        {horse.upgrade && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-50 text-purple-700" title={horse.upgrade.detail}>
                            {horse.upgrade.icon} {horse.upgrade.label}
                          </span>
                        )}
                        {horse.class_challenge && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-orange-50 text-orange-700" title={horse.class_challenge.detail}>
                            {horse.class_challenge.icon} {horse.class_challenge.label}
                          </span>
                        )}
                        {horse.prize_chase && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-yellow-100 text-yellow-700" title={horse.prize_chase.detail}>
                            {horse.prize_chase.icon} {horse.prize_chase.label}
                          </span>
                        )}
                        {horse.crown && (
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            horse.crown.count >= 4 ? 'bg-rose-100 text-rose-800'
                            : horse.crown.count === 3 ? 'bg-orange-100 text-orange-800'
                            : 'bg-amber-100 text-amber-800'
                          }`} title={`4指標(能力/本気度/追切/終いF)のうち ${horse.crown.count} 指標で1位`}>
                            {horse.crown.label}
                          </span>
                        )}
                        {horse.ability_rank_in_race === 1 && !horse.crown && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700" title="レース内能力スコア1位">🥇能力1位</span>
                        )}
                        {horse.motivation_rank_in_race === 1 && !horse.crown && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 text-rose-700" title="レース内本気度1位">🔥本気1位</span>
                        )}
                        {horse.oikiri_rank_in_race === 1 && !horse.crown && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700" title="レース内追切指数1位">💨追切1位</span>
                        )}
                        {horse.shimai_rank_in_race === 1 && !horse.crown && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-violet-50 text-violet-700" title="レース内終いF指数1位">⚡終い1位</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <span className={`text-lg ${ABILITY_COLORS[horse.abilityRank] || 'text-slate-400'}`}>{horse.abilityRank}</span>
                    </td>
                    <td className="py-3 px-2 text-center">
                      {horse.motivation ? (
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${
                            MOTIVATION_COLORS[horse.motivation.label] || MOTIVATION_COLORS['調教データなし']
                          }`} title={horse.motivation.detail}>
                            {horse.motivation.icon} {horse.motivation.label}
                          </span>
                          <span className="text-[10px] font-bold text-slate-500 tabular-nums">
                            {horse.motivation.score >= 0 ? `+${horse.motivation.score}` : horse.motivation.score}
                          </span>
                        </div>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-2 max-w-[160px]">
                      <div className="text-[11px] truncate text-slate-700 mb-0.5"><span className="font-bold text-[#0B2545]">勝:</span> {horse.winConditions?.distance || '-'} / {horse.winConditions?.position || '-'}</div>
                      <div className="text-[11px] truncate text-slate-500"><span className="font-bold text-rose-400">負:</span> {horse.loseConditions?.distance || '-'} / {horse.loseConditions?.going || '-'}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex justify-between text-[10px] font-bold">
                          <span className="text-slate-500">一致度</span>
                          <span className="text-slate-800 tabular-nums">{horse.matchScore}%</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${
                            horse.matchScore >= 80 ? 'bg-[#0B2545]' :
                            horse.matchScore >= 70 ? 'bg-[#4A90E2]' :
                            horse.matchScore >= 60 ? 'bg-slate-400' : 'bg-rose-400'
                          }`} style={{ width: `${horse.matchScore}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-2 text-center">
                      <div className={`w-8 h-8 mx-auto rounded-full flex items-center justify-center font-bold text-lg ${(EVAL_COLORS[horse.eval] || EVAL_COLORS['×']).bg} text-white shadow-sm`}>
                        {horse.eval}
                      </div>
                    </td>
                    <td className="py-3 px-2 text-right">
                      <ChevronRight className={`w-4 h-4 transition-colors ${
                        selectedId === horse.id ? 'text-[#4A90E2]' : 'text-slate-300 group-hover:text-slate-500'
                      }`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右ペイン: 詳細 */}
        <div className="col-span-5 sticky top-24">
          {selectedHorse ? (
            <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col max-h-[calc(100vh-120px)]">
              <div className="p-6 border-b border-slate-100 relative overflow-hidden bg-gradient-to-br from-white to-slate-50">
                <div className="flex justify-between items-start">
                  <div className="flex items-start gap-4">
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center font-bold text-2xl ${(EVAL_COLORS[selectedHorse.eval] || EVAL_COLORS['×']).bg} text-white shadow-md z-10`}>
                      {selectedHorse.eval}
                    </div>
                    <div className="z-10">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="bg-slate-200 text-slate-700 text-xs font-bold px-1.5 py-0.5 rounded">馬番 {selectedHorse.no}</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${(EVAL_COLORS[selectedHorse.eval] || EVAL_COLORS['×']).border} ${(EVAL_COLORS[selectedHorse.eval] || EVAL_COLORS['×']).text}`}>
                          {EVAL_LABELS[selectedHorse.eval] || '—'}
                        </span>
                      </div>
                      <h2 className="text-2xl font-black text-slate-900 leading-none mb-2">{selectedHorse.name}</h2>
                      <div className="text-sm font-medium text-slate-500">
                        {selectedHorse.age || '?'}歳 | {selectedHorse.jockey || '—'} | {selectedHorse.expectedPop || '?'}番人気
                      </div>
                    </div>
                  </div>
                  <div className="text-right z-10">
                    <div className="text-[10px] font-bold text-slate-400 mb-[-4px]">能力ランク</div>
                    <div className={`text-4xl tabular-nums ${ABILITY_COLORS[selectedHorse.abilityRank] || 'text-slate-400'}`}>{selectedHorse.abilityRank}</div>
                    <div className="text-xs font-medium text-slate-500 tabular-nums">Score: {selectedHorse.abilityScore}</div>
                  </div>
                </div>
                <div className="mt-4 flex gap-2 flex-wrap z-10 relative">
                  {(selectedHorse.tags || []).map((tag) => (
                    <span key={tag} className="px-2.5 py-1 bg-[#4A90E2]/10 text-[#2B6CB0] text-xs font-bold rounded-full">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>

              <div className="overflow-y-auto p-6 space-y-6">
                <div className="bg-gradient-to-r from-[#0B2545]/5 to-[#4A90E2]/5 border border-[#4A90E2]/20 rounded-xl p-4">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Sparkles className="w-4 h-4 text-[#4A90E2]" />
                    <span className="text-xs font-bold text-[#0B2545]">AI短評 — 今回レースへの評価</span>
                  </div>
                  <p className="text-sm text-slate-800 leading-relaxed font-medium">{selectedHorse.comment || '—'}</p>
                  <div className="mt-3 text-[10px] text-slate-400 flex items-start gap-1">
                    <span>※</span><span>これは条件整理に基づく要約です。最終判断は人間が行います。</span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <h4 className="text-xs font-bold text-[#0B2545] mb-2 flex items-center gap-1 border-b border-slate-200 pb-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> 勝つ条件
                    </h4>
                    <dl className="text-xs space-y-1.5">
                      {Object.entries(selectedHorse.winConditions || {}).map(([key, val]) => (
                        <div key={key} className="flex justify-between border-b border-slate-50 pb-1">
                          <dt className="text-slate-400 font-medium capitalize">
                            {key === 'going' ? '馬場' : key === 'course' ? 'コース' : key === 'distance' ? '距離' : key === 'position' ? '位置' : 'クラス'}
                          </dt>
                          <dd className="font-bold text-slate-800 text-right pl-2">{val}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                  <div className="bg-slate-50 p-3 rounded-lg border border-slate-100">
                    <h4 className="text-xs font-bold text-rose-500 mb-2 flex items-center gap-1 border-b border-rose-100 pb-1">
                      <XCircle className="w-3.5 h-3.5" /> 負ける条件
                    </h4>
                    <dl className="text-xs space-y-1.5">
                      {Object.entries(selectedHorse.loseConditions || {}).map(([key, val]) => (
                        <div key={key} className="flex justify-between border-b border-slate-100 pb-1">
                          <dt className="text-slate-400 font-medium capitalize">
                            {key === 'going' ? '馬場' : key === 'course' ? 'コース' : key === 'distance' ? '距離' : key === 'position' ? '位置' : 'クラス'}
                          </dt>
                          <dd className="font-bold text-slate-700 text-right pl-2">{val}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>

                <div>
                  <h4 className="text-xs font-bold text-slate-700 mb-2 flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" /> 過去成績 (能力抽出元)
                  </h4>
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-left text-[11px]">
                      <thead className="bg-slate-50 text-slate-500 border-b border-slate-200">
                        <tr>
                          <th className="py-1.5 px-2 font-medium">日付/レース</th>
                          <th className="py-1.5 px-2 font-medium">距離/馬場</th>
                          <th className="py-1.5 px-2 font-medium text-center">着順</th>
                          <th className="py-1.5 px-2 font-medium text-right">通過</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {(selectedHorse.pastRuns || []).map((run, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="py-1.5 px-2">
                              <div className="text-[9px] text-slate-400">{run.date}</div>
                              <div className="font-bold text-slate-800">{run.race || run.race_name || '-'}</div>
                            </td>
                            <td className="py-1.5 px-2 text-slate-600">
                              {run.dist || run.distance || '-'} <span className="text-slate-300">|</span> {run.going || run.surface || '-'}
                            </td>
                            <td className="py-1.5 px-2 text-center">
                              <span className={`font-bold ${run.rank === 1 ? 'text-[#0B2545]' : run.rank <= 3 ? 'text-[#4A90E2]' : 'text-slate-400'}`}>
                                {run.rank}着
                              </span>
                            </td>
                            <td className="py-1.5 px-2 text-right text-slate-500 tabular-nums">{run.pass || '-'}</td>
                          </tr>
                        ))}
                        {(!selectedHorse.pastRuns || selectedHorse.pastRuns.length === 0) && (
                          <tr><td colSpan={4} className="py-3 text-center text-slate-400">過去走データなし</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 bg-white">
              <Search className="w-8 h-8 mb-2 opacity-50" />
              <p className="text-sm font-medium">左の一覧から馬を選択してください</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ================================================================
  // タブ: 全体評価
  // ================================================================
  const TabOverview = () => {
    if (!raceInfo || horses.length === 0) {
      return (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
          レースを選択してください。
        </div>
      )
    }
    const evals = [
      { id: '◎', title: '本命', color: EVAL_COLORS['◎'] },
      { id: '○', title: '対抗', color: EVAL_COLORS['○'] },
      { id: '△', title: '押さえ', color: EVAL_COLORS['△'] },
      { id: '×', title: '消し', color: EVAL_COLORS['×'] },
    ]
    const topAbility = [...horses].sort((a, b) => (b.abilityScore || 0) - (a.abilityScore || 0)).slice(0, 3)
    const topMatch = [...horses].sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0)).slice(0, 3)
    const riskHorses = horses.filter((h) => (h.abilityScore || 0) >= 70 && (h.matchScore || 0) < 70)

    return (
      <div className="space-y-8 pb-12">
        <div className="grid grid-cols-4 gap-4">
          {evals.map((ev) => {
            const list = horses.filter((h) => h.eval === ev.id).slice(0, 3)
            const count = horses.filter((h) => h.eval === ev.id).length
            return (
              <div key={ev.id} className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm">
                <div className="flex justify-between items-start border-b border-slate-100 pb-3 mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-lg text-white ${ev.color.bg}`}>{ev.id}</span>
                    <span className={`font-bold text-sm ${ev.color.text}`}>{ev.title}</span>
                  </div>
                  <div className={`text-3xl font-black tabular-nums ${ev.color.text} opacity-80`}>{count}</div>
                </div>
                <div className="space-y-2 text-sm">
                  {list.length > 0 ? list.map((h) => (
                    <div key={h.id} className="flex items-center gap-2">
                      <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded font-mono">{h.no}</span>
                      <span className="font-bold text-slate-800 truncate">{h.name}</span>
                    </div>
                  )) : <div className="text-slate-400 text-xs py-2">該当馬なし</div>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-3 gap-6">
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="bg-[#0B2545] p-3 text-white flex items-center gap-2">
              <TrendingUp className="w-4 h-4" /> <span className="font-bold text-sm">能力上位馬</span>
            </div>
            <div className="p-2">
              {topAbility.map((h, i) => (
                <div key={h.id} className="flex justify-between items-center p-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${i === 0 ? 'bg-[#0B2545]' : i === 1 ? 'bg-[#2B6CB0]' : 'bg-[#4A90E2]'}`}>{i + 1}</span>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{h.name}</div>
                      <div className="text-[10px] text-slate-500">{h.jockey || '—'}</div>
                    </div>
                  </div>
                  <div className="text-lg font-black text-[#0B2545] tabular-nums">{h.abilityScore}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="bg-[#4A90E2] p-3 text-white flex items-center gap-2">
              <Target className="w-4 h-4" /> <span className="font-bold text-sm">条件一致度上位馬</span>
            </div>
            <div className="p-2">
              {topMatch.map((h, i) => (
                <div key={h.id} className="flex justify-between items-center p-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white ${i === 0 ? 'bg-[#4A90E2]' : 'bg-[#4A90E2]/60'}`}>{i + 1}</span>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{h.name}</div>
                      <div className="text-[10px] text-slate-500">{h.jockey || '—'}</div>
                    </div>
                  </div>
                  <div className="text-lg font-black text-[#4A90E2] tabular-nums">{h.matchScore}%</div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
            <div className="bg-rose-400 p-3 text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> <span className="font-bold text-sm">リスク馬 (能力高・一致度低)</span>
            </div>
            <div className="p-2">
              {riskHorses.length > 0 ? riskHorses.map((h) => (
                <div key={h.id} className="flex justify-between items-center p-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-center gap-3">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold text-white bg-rose-300">!</span>
                    <div>
                      <div className="font-bold text-slate-900 text-sm">{h.name} <span className="text-[10px] font-normal text-rose-500">({h.expectedPop || '?'}人気)</span></div>
                      <div className="text-[10px] text-slate-500">能力: {h.abilityScore}</div>
                    </div>
                  </div>
                  <div className="text-lg font-black text-rose-500 tabular-nums">{h.matchScore}%</div>
                </div>
              )) : <div className="p-4 text-center text-sm text-slate-400">該当馬なし</div>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ================================================================
  // タブ: AI の位置づけ
  // ================================================================
  const TabPhilosophy = () => (
    <div className="grid grid-cols-2 gap-8 pb-12 items-stretch">
      <div className="bg-gradient-to-br from-[#0B2545] to-[#1a365d] rounded-2xl p-8 text-white shadow-md relative overflow-hidden">
        <Zap className="absolute -right-8 -bottom-8 w-48 h-48 text-white/5" />
        <h2 className="text-2xl font-black mb-4 relative z-10">AIは予想者ではない</h2>
        <p className="text-slate-300 text-sm leading-relaxed mb-8 relative z-10">
          当システムは「当たるAI」を目指していません。競馬における不確実性をAIで断定することは危険であると考え、あくまで膨大なデータ処理とパターン抽出の「アシスタント」として機能します。
        </p>
        <div className="space-y-4 relative z-10">
          {[
            'AIは勝ち馬を断定しない',
            'AIは条件整理 / 要約 / 比較を担当する',
            '評価軸は「今回能力を出せるか」に寄せる',
            '最終判断は常に人間が行う',
          ].map((text, i) => (
            <div key={i} className="flex items-center gap-3 bg-white/10 p-3 rounded-lg border border-white/5">
              <CheckCircle2 className="w-5 h-5 text-[#4A90E2] shrink-0" />
              <span className="font-medium text-sm">{text}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2">
          <Activity className="w-5 h-5 text-[#4A90E2]" /> 拡張機能 (Coming Soon)
        </h2>
        <div className="grid grid-cols-2 gap-4">
          {[
            '当日オッズ連携', '馬体重変化追跡', '天候連動シミュレート',
            'EV(期待値)計算', '買い目(フォーメーション)提案', '当日トラックバイアス補正',
          ].map((text, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between h-24 bg-slate-50/50 hover:bg-slate-50 transition-colors">
              <span className="font-bold text-slate-700 text-sm">{text}</span>
              <div className="text-right">
                <span className="text-[9px] font-black tracking-wider text-slate-400 bg-slate-200 px-2 py-0.5 rounded-sm">SOON</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  // ================================================================
  // ヘッダ・タブナビ
  // ================================================================
  const GlobalHeader = () => (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm px-8 py-3 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0B2545] to-[#4A90E2] flex items-center justify-center">
          <Target className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-[#0B2545] leading-tight">Race Condition Analyzer</h1>
          <p className="text-[10px] font-medium text-slate-500 tracking-wider">PROTOTYPE v0.1</p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="馬名・騎手で検索..."
            className="pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[#4A90E2]/30"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setTab('jrdb')}
          className="text-sm font-medium text-slate-600 px-4 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50 transition-colors">
          レースを切替
        </button>
        <button onClick={refreshDb} title="race.db を Supabase から再取得"
          className="text-xs font-medium text-slate-500 px-3 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50">
          DB再取得
        </button>
        <button onClick={onLogout} title="ログアウト"
          className="text-xs font-medium text-slate-500 px-3 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50 flex items-center gap-1">
          <LogOut className="w-3 h-3" /> {session.user?.email?.split('@')[0]}
        </button>
      </div>
    </header>
  )

  const RaceInfoHeader = () => {
    if (!raceInfo) return null
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-6 shadow-sm mb-6 flex justify-between items-center">
        <div className="space-y-2">
          <div className="text-sm font-bold text-[#4A90E2] tracking-wide">{raceInfo.date}</div>
          <div className="flex items-center gap-3">
            {raceInfo.class && raceInfo.class !== '—' && (
              <span className="bg-[#0B2545] text-white text-xs font-bold px-2 py-0.5 rounded">{raceInfo.class}</span>
            )}
            <h2 className="text-3xl font-black text-slate-900">{raceInfo.name || '—'}</h2>
          </div>
          <div className="flex items-center gap-2 text-sm font-medium text-slate-600">
            <span>{raceInfo.course}</span><span className="text-slate-300">•</span>
            <span>{raceInfo.distance}</span><span className="text-slate-300">•</span>
            <span>{raceInfo.going || '—'}</span><span className="text-slate-300">•</span>
            <span>{raceInfo.fieldSize}頭</span>
          </div>
          {raceInfo.features && raceInfo.features.length > 0 && (
            <div className="flex gap-2 pt-1">
              {raceInfo.features.map((f, i) => (
                <span key={i} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-1 rounded-md border border-slate-200">{f}</span>
              ))}
              {raceInfo.bias && raceInfo.bias !== '—' && (
                <span className="text-[11px] bg-[#4A90E2]/10 text-[#4A90E2] font-bold px-2 py-1 rounded-md border border-[#4A90E2]/20">⚑ {raceInfo.bias}</span>
              )}
            </div>
          )}
          {raceInfo.raceType && (
            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 mt-2">
              <span className="text-[11px] bg-amber-50 text-amber-700 font-bold px-2 py-1 rounded-md border border-amber-200">
                {raceInfo.raceType.icon} {raceInfo.raceType.label}
              </span>
              <span className="text-[11px] text-slate-600">{raceInfo.raceType.detail}</span>
              {raceInfo.raceType.advice && (
                <span className="text-[11px] text-slate-500 italic">≫ {raceInfo.raceType.advice}</span>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col items-end gap-4">
          <div className="flex items-center gap-6">
            <div className="text-center">
              <div className="text-xs text-slate-500 font-medium mb-1">評価対象</div>
              <div className="text-2xl font-bold tabular-nums text-slate-800">{summary.total}</div>
            </div>
            <div className="w-px h-10 bg-slate-200"></div>
            <div className="text-center">
              <div className="text-xs text-[#0B2545] font-bold mb-1">◎候補</div>
              <div className="text-2xl font-bold tabular-nums text-[#0B2545]">{summary.honmei}</div>
            </div>
            <div className="w-px h-10 bg-slate-200"></div>
            <div className="text-center">
              <div className="text-xs text-[#4A90E2] font-bold mb-1">○候補</div>
              <div className="text-2xl font-bold tabular-nums text-[#4A90E2]">{summary.taikou}</div>
            </div>
            <div className="w-px h-10 bg-slate-200"></div>
            <div className="text-center">
              <div className="text-xs text-rose-500 font-bold mb-1">注意馬</div>
              <div className="text-2xl font-bold tabular-nums text-rose-500">{summary.keshi}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const TabNav = () => {
    const tabs = [
      { id: 'jrdb', label: 'JRDB実データ', icon: Activity },
      { id: 'list', label: '一覧 & 詳細', icon: Layers },
      { id: 'overview', label: '全体評価', icon: Activity },
      { id: 'philosophy', label: 'AIの位置づけ', icon: Info },
    ]
    return (
      <div className="flex gap-8 border-b border-slate-200 mb-6">
        {tabs.map((t) => {
          const Icon = t.icon
          const isActive = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 font-bold transition-colors text-sm ${
                isActive ? 'border-[#0B2545] text-[#0B2545]' : 'border-transparent text-slate-500 hover:text-slate-800'
              }`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-8"
      style={{ fontFamily: "'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
      <GlobalHeader />
      <main className="max-w-[1440px] mx-auto px-8 pt-8">
        {raceInfo && <RaceInfoHeader />}
        <TabNav />
        <div>
          {tab === 'jrdb' && <TabJrdb />}
          {tab === 'list' && <TabListDetail />}
          {tab === 'overview' && <TabOverview />}
          {tab === 'philosophy' && <TabPhilosophy />}
        </div>
      </main>
      <footer className="fixed bottom-0 w-full bg-white border-t border-slate-200 px-8 py-2 text-[10px] text-slate-500 flex justify-between items-center z-50">
        <div>Race Condition Analyzer — 前日までの情報に基づく能力評価</div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
          </span>
          条件整理エンジン稼働中
        </div>
      </footer>
    </div>
  )
}

// ================================================================
// 認証ラッパー
// ================================================================
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

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center">
        <div className="w-10 h-10 border-4 border-[#4A90E2] border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return session
    ? <MainApp session={session} onLogout={logout} />
    : <LoginPage onLogin={setSession} />
}
