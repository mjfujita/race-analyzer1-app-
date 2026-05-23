import React, { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { loadDb, queryAll } from './lib/db'

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
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-400 mb-2">パスワード</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
          {error && (
            <p className="text-xs text-rose-400 bg-rose-900/30 px-3 py-2 rounded-lg border border-rose-800">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-3 rounded-lg font-bold text-sm disabled:opacity-50"
          >
            {loading ? 'ログイン中...' : 'ログイン'}
          </button>
        </form>
      </div>
    </div>
  )
}

function formatJrdbDate(s) {
  if (!s || s.length !== 8) return s
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

const PLACE_NAMES = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
}

function Dashboard({ session, onLogout }) {
  const [db, setDb] = useState(null)
  const [progress, setProgress] = useState({ loaded: 0, total: 0, fromCache: false })
  const [error, setError] = useState('')
  const [dates, setDates] = useState([])
  const [selectedDate, setSelectedDate] = useState('')
  const [races, setRaces] = useState([])

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
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!db || !selectedDate) return
    const rows = queryAll(
      db,
      `SELECT race_key, place_code, race_no, post_time, distance, surface_code,
              grade, field_size, race_name, prize_1st
       FROM jrdb_races WHERE race_date = ?
       ORDER BY place_code, race_no`,
      [selectedDate],
    )
    setRaces(rows)
  }, [db, selectedDate])

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
          <button
            onClick={refresh}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded font-bold"
          >
            DB再取得
          </button>
          <button
            onClick={onLogout}
            className="text-xs bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded font-bold"
          >
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
            </p>
            <div className="w-full bg-slate-700 rounded-full h-2 overflow-hidden">
              <div
                className="bg-emerald-500 h-full transition-all"
                style={{ width: progress.total ? `${pct}%` : '10%' }}
              />
            </div>
            <p className="text-xs text-slate-500 mt-2">
              {mb(progress.loaded)} MB
              {progress.total ? ` / ${mb(progress.total)} MB (${pct}%)` : ''}
            </p>
          </div>
        )}

        {db && (
          <>
            <div className="flex items-center gap-3 mb-4">
              <label className="text-xs text-slate-400">開催日</label>
              <select
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm"
              >
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
                    <tr key={r.race_key} className="border-t border-slate-700/60 hover:bg-slate-700/30">
                      <td className="px-3 py-2">{PLACE_NAMES[r.place_code] || r.place_code}</td>
                      <td className="px-3 py-2">{r.race_no}R</td>
                      <td className="px-3 py-2">{r.post_time}</td>
                      <td className="px-3 py-2">{r.race_name || '—'}</td>
                      <td className="px-3 py-2 text-right">{r.distance}m</td>
                      <td className="px-3 py-2">
                        {r.surface_code === '1' ? '芝' : r.surface_code === '2' ? 'ダ' : r.surface_code === '3' ? '障' : r.surface_code}
                      </td>
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
          </>
        )}
      </main>
    </div>
  )
}

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

  return session ? <Dashboard session={session} onLogout={logout} /> : <LoginPage onLogin={setSession} />
}
