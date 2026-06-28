import React, { useState, useMemo, useEffect, useRef } from 'react'
import {
  ChevronRight, Search, Target, TrendingUp, AlertTriangle,
  CheckCircle2, Sparkles, ArrowUpDown, Star, Flame, Layers2,
  Activity, Info, Zap, Layers, Clock, LogOut, MapPin, Flag,
  Eye, Lightbulb, ListFilter, Gauge, Users, Wand2,
} from 'lucide-react'
import { supabase } from './supabase'
import { loadDb, queryAll, dbMeta } from './lib/db'

const UI_VERSION = 'v0.2'
const COMMIT_HASH = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'dev'

// ================================================================
//  Race Condition Analyzer v0.2 — 朝の判断支援コックピット
//  本日のレース一覧（妙味構造の俯瞰）＋ 各レース分析（役割・妙味）
//  データは backend が race.db の race_evaluations / race_summaries に
//  プレ計算した結果を sql.js でブラウザ内読込みして表示するだけ。
// ================================================================

const PLACE_NAMES = {
  '01': '札幌', '02': '函館', '03': '福島', '04': '新潟', '05': '東京',
  '06': '中山', '07': '中京', '08': '京都', '09': '阪神', '10': '小倉',
}
const SURFACE_NAMES = { '1': '芝', '2': 'ダ', '3': '障' }

// ---- 優先度 ----
const PRIORITY_STYLES = {
  A: { label: 'A優先', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
  B: { label: 'B優先', cls: 'bg-[#4A90E2]/10 text-[#2B6CB0] border-[#4A90E2]/30' },
  C: { label: 'C優先', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
  D: { label: '見送り', cls: 'bg-slate-50 text-slate-400 border-slate-200' },
}

// ---- レース分類 / シナリオタグ ----
const SCENARIO_TAG_STYLES = {
  '人気落ち実力馬あり': 'bg-orange-50 text-orange-700 border-orange-200',
  '妙味軸': 'bg-orange-50 text-orange-700 border-orange-200',
  '2着妙味': 'bg-[#4A90E2]/10 text-[#2B6CB0] border-[#4A90E2]/30',
  '頭固定・2着ズレ': 'bg-indigo-50 text-indigo-700 border-indigo-200',
  '人気馬不安': 'bg-rose-50 text-rose-700 border-rose-200',
  '未勝利・初出走注意': 'bg-emerald-50 text-emerald-700 border-emerald-200',
  '地方馬注意': 'bg-purple-50 text-purple-700 border-purple-200',
  '除外対象': 'bg-slate-100 text-slate-500 border-slate-200',
  '見送り候補': 'bg-slate-100 text-slate-500 border-slate-200',
}
const flowStyle = 'bg-slate-100 text-slate-600 border-slate-200'
const tagStyle = (t) => {
  if (SCENARIO_TAG_STYLES[t]) return SCENARIO_TAG_STYLES[t]
  if (t && t.startsWith('流れ')) return flowStyle
  if (t && t.startsWith('内枠')) return flowStyle
  return 'bg-slate-100 text-slate-600 border-slate-200'
}

// ---- 役割タグ（馬単位） ----
const ROLE_STYLES = {
  '妙味軸': 'bg-orange-100 text-orange-800',
  '2着妙味': 'bg-[#4A90E2]/15 text-[#2B6CB0]',
  '3着穴': 'bg-emerald-50 text-emerald-700',
  '危険人気': 'bg-rose-100 text-rose-700',
  '人気過信注意': 'bg-rose-100 text-rose-700',
  '人気飛び候補': 'bg-rose-200 text-rose-800',
  // 昇級組（オレンジ系で統一）
  '昇級妙味': 'bg-orange-100 text-orange-800',
  '昇級確認': 'bg-orange-50 text-orange-700',
  '昇級後通用': 'bg-amber-100 text-amber-800',
  '昇級注意': 'bg-orange-50 text-orange-600',
  '地方注意': 'bg-purple-50 text-purple-700',
  '未勝利注意': 'bg-sky-50 text-sky-700',
  '初出走注意': 'bg-sky-50 text-sky-700',
  'データ不足': 'bg-slate-100 text-slate-400',
  '注意': 'bg-amber-50 text-amber-700',
  '見送り': 'bg-slate-100 text-slate-500',
}
const roleStyle = (r) => ROLE_STYLES[r] || 'bg-slate-100 text-slate-600'
const UPGRADE_ROLES = new Set(['昇級妙味', '昇級確認', '昇級後通用', '昇級注意'])
const isUpgradeCategory = (t) => t && (t.startsWith('昇級') || t === '昇級初戦')

// 本日一覧: バッジ/シナリオタグ → フィルタキーの対応
const tagToDayFilter = (t) => {
  if (!t) return null
  if (t === '人気落ち実力馬あり' || t === '妙味軸') return 'value'
  if (t === '未勝利・初出走注意' || t === '未勝利注意' || t === '初出走注意') return 'maiden'
  if (t === '地方馬注意' || t === '地方注意') return 'local'
  if (t === 'A優先' || t === 'B優先') return 'notable'
  return null
}

const ABILITY_COLORS = {
  S: 'text-[#0B2545] font-black',
  'A+': 'text-[#0B2545] font-bold',
  A: 'text-[#2B6CB0] font-bold',
  'B+': 'text-[#4A90E2]',
  B: 'text-slate-600',
  'C+': 'text-slate-400',
}

// ---- 直近5走 判定ラベルの色 ----
const JUDGMENT_STYLES = {
  '同級好走': 'bg-emerald-50 text-emerald-700',
  '同級勝ち': 'bg-emerald-100 text-emerald-800',
  '好走': 'bg-emerald-50 text-emerald-700',
  '昇級根拠': 'bg-[#4A90E2]/10 text-[#2B6CB0]',
  '人気上位大敗': 'bg-rose-50 text-rose-700',
  '人気薄好走': 'bg-amber-50 text-amber-700',
  '人気相応': 'bg-slate-100 text-slate-500',
  '凡走': 'bg-slate-50 text-slate-400',
  '地方実績参考': 'bg-purple-50 text-purple-600',
  '比較不可': 'bg-slate-50 text-slate-400',
}
const judgmentStyle = (j) => JUDGMENT_STYLES[j] || 'bg-slate-100 text-slate-500'

// ---- 旧予想カテゴリ（v2.2・後方互換） ----
const CATEGORY_STYLES = {
  '軸候補':   'bg-[#0B2545] text-white',
  '相手本線': 'bg-[#4A90E2] text-white',
  '穴候補':   'bg-orange-500 text-white',
  '押さえ':   'bg-slate-300 text-slate-800',
  '評価下げ': 'bg-rose-100 text-rose-700',
  '見送り':   'bg-slate-100 text-slate-500',
}
const categoryStyle = (c) => CATEGORY_STYLES[c] || 'bg-slate-100 text-slate-600'

// ---- 人気×着順ギャップ視点の予想カテゴリ（v2.3 メイン） ----
const GAP_CATEGORY_STYLES = {
  '巻き返し軸':   'bg-[#0B2545] text-white',
  '人気落ち妙味': 'bg-orange-500 text-white',
  '穴候補':       'bg-amber-500 text-white',
  '人気安定型':   'bg-[#4A90E2] text-white',
  '人気以上走る型': 'bg-emerald-500 text-white',
  '人気裏切り型': 'bg-rose-300 text-rose-900',
  '前走過剰人気': 'bg-rose-200 text-rose-800',
  '判断保留':     'bg-slate-200 text-slate-600',
}
const gapCategoryStyle = (c) => GAP_CATEGORY_STYLES[c] || 'bg-slate-100 text-slate-600'

// ---- 軸タイプ（馬券上の扱い 6分類） ----
const BET_ROLE_STYLES = {
  '1着軸': 'bg-[#0B2545] text-white border-[#0B2545]',
  '2着軸': 'bg-[#4A90E2] text-white border-[#4A90E2]',
  '3着軸': 'bg-amber-500 text-white border-amber-500',
  '相手軸': 'bg-emerald-500 text-white border-emerald-500',
  '押さえ': 'bg-slate-200 text-slate-700 border-slate-300',
  '軽視':   'bg-rose-100 text-rose-700 border-rose-200',
}
const betRoleStyle = (r) => BET_ROLE_STYLES[r] || 'bg-slate-100 text-slate-500 border-slate-200'

// ---- 人気×着順ギャップ値の色（正=好走 / 負=裏切り） ----
const gapColor = (g) => {
  if (g == null) return 'text-slate-300'
  if (g >= 4) return 'text-emerald-600 font-bold'
  if (g >= 1) return 'text-emerald-500'
  if (g <= -4) return 'text-rose-600 font-bold'
  if (g <= -1) return 'text-rose-500'
  return 'text-slate-500'
}

// ---- スコアバー（win/place/risk 用、0-100） ----
const ScoreBar = ({ label, score, tone = 'navy', inverted = false }) => {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  // 表示色: tone=navy/blue/rose に応じてバーの色を決める
  const barColor = tone === 'navy' ? 'bg-[#0B2545]'
                  : tone === 'blue' ? 'bg-[#4A90E2]'
                  : tone === 'rose' ? 'bg-rose-500'
                  : 'bg-slate-400'
  // 不安度は高いほど悪い → 逆向きの語感ヒントを表示
  const tier = inverted
    ? (s >= 65 ? '高' : s >= 45 ? '中' : '低')
    : (s >= 70 ? '高' : s >= 45 ? '中' : '低')
  const tierColor = inverted
    ? (s >= 65 ? 'text-rose-600' : s >= 45 ? 'text-amber-600' : 'text-emerald-600')
    : (s >= 70 ? 'text-emerald-600' : s >= 45 ? 'text-amber-600' : 'text-slate-400')
  return (
    <div className="border border-slate-200 rounded-lg px-2.5 py-1.5 bg-white">
      <div className="flex justify-between items-baseline mb-1">
        <span className="text-[10px] font-bold text-slate-500">{label}</span>
        <span className={`text-[10px] font-bold ${tierColor}`}>{tier}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="text-[18px] font-black tabular-nums text-slate-800 leading-none">{s}</span>
        <span className="text-[10px] text-slate-400">/100</span>
      </div>
      <div className="mt-1 w-full h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor} transition-all`} style={{ width: `${s}%` }} />
      </div>
    </div>
  )
}

// ---- 直近5走の 人気→着順 トレンドストリップ（古い順） ----
const GapTrendStrip = ({ pops = [], ranks = [], gaps = [] }) => {
  if (!pops.length) return <span className="text-slate-300 text-xs">—</span>
  // 直近順で入ってくるので、表示は古い順に並べる
  const items = pops.map((p, i) => ({ p, r: ranks[i], g: gaps[i] })).reverse()
  return (
    <div className="flex gap-0.5 items-center justify-start">
      {items.map((it, i) => {
        const bg = it.g >= 4 ? 'bg-emerald-100 text-emerald-800'
                 : it.g >= 1 ? 'bg-emerald-50 text-emerald-700'
                 : it.g <= -4 ? 'bg-rose-100 text-rose-800'
                 : it.g <= -1 ? 'bg-rose-50 text-rose-700'
                 : 'bg-slate-100 text-slate-600'
        return (
          <div key={i} className={`px-1 py-0.5 rounded text-[9px] font-bold tabular-nums leading-tight ${bg}`} title={`${it.p}人気 → ${it.r}着 (gap ${it.g > 0 ? '+' : ''}${it.g})`}>
            {it.p}/{it.r}
          </div>
        )
      })}
    </div>
  )
}

// ---- 一覧用ミニスコアセル（後方互換、勝ち切り度・馬券内度） ----
const MiniScoreCell = ({ score, tone = 'navy', sortHighlight = false }) => {
  const s = Math.max(0, Math.min(100, Number(score) || 0))
  const barColor = tone === 'navy' ? 'bg-[#0B2545]' : tone === 'blue' ? 'bg-[#4A90E2]' : 'bg-slate-400'
  const numColor = s >= 70 ? 'text-[#0B2545]' : s >= 45 ? 'text-slate-700' : 'text-slate-400'
  return (
    <td className={`py-2.5 px-2 text-center ${sortHighlight ? 'bg-slate-50/60' : ''}`}>
      <div className={`text-[14px] font-black tabular-nums leading-none ${numColor}`}>{s || '—'}</div>
      <div className="mt-1 mx-auto w-12 h-1 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full ${barColor}`} style={{ width: `${s}%` }} />
      </div>
    </td>
  )
}

const fmtTime = (t) => (!t || t.length < 4 ? '' : `${t.slice(0, 2)}:${t.slice(2, 4)}`)

// ================================================================
// AI 候補抽出（自然文 → 構造化検索）
// ================================================================
const AI_QUESTION_CHIPS = [
  { label: 'Gクラス出走経験', q: 'GⅠ・GⅡ・GⅢに出走経験がある馬は？' },
  { label: '前走人気を裏切った馬', q: '前走で人気を裏切った馬は？' },
  { label: '巻き返し候補', q: '巻き返し候補は？' },
  { label: '人気落ち妙味', q: '人気落ち妙味がある馬は？' },
  { label: '2着軸候補', q: '2着軸に向く馬は？' },
  { label: '3着穴候補', q: '3着穴で拾うならどれ？' },
  { label: '人気以上に走る馬', q: '人気以上に走るタイプは？' },
  { label: '軽視したい人気馬', q: '軽視してよさそうな馬は？' },
  { label: '過去に上位人気経験', q: '過去5走で1〜3人気になったことがある馬は？' },
]

// クラス文字列から G/L 判定
const detectGradeFromRaceName = (raceName) => {
  if (!raceName) return null
  const r = String(raceName)
  if (/G[ⅠⅰI１1](?![ⅡⅢⅰⅱⅲI2 3])/i.test(r) || /GI(?!I)/.test(r)) return 'GⅠ'
  if (/G[ⅡⅱII２2]/.test(r)) return 'GⅡ'
  if (/G[ⅢⅲIII３3]/.test(r)) return 'GⅢ'
  if (/^L$|Lクラス|^L\s|リステッド/i.test(r)) return 'L'
  if (/重賞|オープン/.test(r)) return 'OP'
  return null
}

// 質問を分類する
const classifyAiQuery = (q) => {
  if (!q || !q.trim()) return { type: 'empty' }
  // G クラス / 重賞 系
  if (/[GgＧ][ⅠⅡⅢⅰⅱⅲIii123１２３]|重賞|Gクラス|gクラス|G1|G2|G3|GI|GII|GIII/.test(q)) {
    return { type: 'gclass', label: 'Gクラス・L出走経験' }
  }
  // 前走人気を裏切った
  if (/前走.*裏切|前走.*負|前走.*凡走|前走大敗.*人気/.test(q)) {
    return { type: 'betray_last', label: '前走で人気を裏切った馬' }
  }
  // 過去5走で上位人気
  if (/過去.*1[〜~\-－]?3人気|上位人気.*経験|過去.*上位人気/.test(q)) {
    return { type: 'past_top_pop', label: '過去5走で 1〜3 人気の経験あり' }
  }
  if (/巻き返し|巻返し/.test(q)) {
    return { type: 'comeback', label: '巻き返し候補' }
  }
  if (/人気落ち.*妙味|妙味/.test(q)) {
    return { type: 'value_drop', label: '人気落ち妙味のある馬' }
  }
  if (/2着軸|２着軸|2着.*軸/.test(q)) {
    return { type: 'axis2', label: '2着軸に向く馬' }
  }
  if (/3着穴|３着穴|3着.*穴|穴で拾|3着.*軸/.test(q)) {
    return { type: 'axis3', label: '3着穴に向く馬' }
  }
  if (/人気以上|穴を開け|人気薄.*好走/.test(q)) {
    return { type: 'over_perform', label: '人気以上に走るタイプ' }
  }
  if (/軽視|消し|過信注意/.test(q)) {
    return { type: 'avoid', label: '軽視したい馬' }
  }
  return { type: 'unknown', label: '該当する条件を判定できず' }
}

// カテゴリ別の馬券アドバイス
const BETTING_ADVICE_BY_CATEGORY = {
  '巻き返し軸': '勝ち切り固定よりも、2着軸・3着軸での巻き返し狙いが有効。',
  '人気落ち妙味': '人気が落ちるなら相手候補。人気化するなら過信注意。',
  '穴候補': 'ワイド・三連複の3列目に置く穴候補。',
  '人気安定型': '人気想定通りの走りで、馬連・三連複の軸として整理。',
  '人気以上走る型': '相手・2着固定で狙いたい。',
  '人気裏切り型': '軸固定は避け、買い目からは外す方向。',
  '前走過剰人気': '今回も人気なら過信注意、人気落ちなら押さえ程度。',
  '判断保留': '他指標と合わせて補完判断したい。',
}

// 各 horse に対し reason 文字列を生成して並べる
const runAiQuery = (q, horses) => {
  const cls = classifyAiQuery(q)
  if (cls.type === 'empty') {
    return { type: 'empty', label: '入力してください', matches: [] }
  }
  if (cls.type === 'unknown') {
    return {
      type: 'unknown',
      label: cls.label,
      note: '対応できる質問は左上のサンプルチップを参考にしてください。',
      matches: [],
    }
  }

  const matches = []
  for (const h of horses) {
    const past = h.pastRuns || []
    const gap = h.popularityGap || {}
    let reason = null

    switch (cls.type) {
      case 'gclass': {
        const grades = new Set()
        for (const run of past) {
          const g = detectGradeFromRaceName(run.race)
          if (g) grades.add(g)
        }
        if (grades.size > 0) {
          const order = ['GⅠ', 'GⅡ', 'GⅢ', 'L', 'OP']
          const found = order.filter((g) => grades.has(g))
          reason = `過去走に ${found.join('・')} 出走あり`
        }
        break
      }
      case 'betray_last': {
        const lp = gap.last_pop, lr = gap.last_rank, lg = gap.last_gap
        if (lp != null && lr != null && lp <= 4 && lg != null && lg <= -3) {
          reason = `前走 ${lp}人気${lr}着（ギャップ ${lg}）と人気を裏切った`
        }
        break
      }
      case 'past_top_pop': {
        const tops = (gap.pop_trend || []).filter((p) => p && p <= 3)
        if (tops.length > 0) {
          // 上位人気時の着順を見せる
          const detail = []
          ;(gap.pop_trend || []).forEach((p, i) => {
            if (p && p <= 3) detail.push(`${p}人${gap.rank_trend[i]}着`)
          })
          reason = `過去5走で上位人気が ${tops.length} 回（${detail.join(' / ')}）`
        }
        break
      }
      case 'comeback': {
        if ((gap.comeback_index || 0) >= 45 || h.gapCategory === '巻き返し軸') {
          reason = `巻き返し指数 ${gap.comeback_index || 0}（前走 ${gap.last_pop}人${gap.last_rank}着、過去の市場評価は高い）`
        }
        break
      }
      case 'value_drop': {
        if ((gap.value_drop_score || 0) >= 35 || h.gapCategory === '人気落ち妙味') {
          reason = `人気落ち妙味度 ${gap.value_drop_score || 0}（過去に上位人気で好走の実績あり）`
        }
        break
      }
      case 'axis2': {
        if ((gap.axis2_score || 0) >= 40 || h.betRole === '2着軸') {
          reason = `2着軸適性 ${gap.axis2_score || 0}（過去走で2-3着が多い／上位人気での複勝圏入り経験）`
        }
        break
      }
      case 'axis3': {
        if ((gap.axis3_score || 0) >= 30 || h.betRole === '3着軸' || h.gapCategory === '穴候補') {
          reason = `3着穴適性 ${gap.axis3_score || 0}（3着または人気薄で複勝圏に入った経験あり）`
        }
        break
      }
      case 'over_perform': {
        if ((gap.over_perform_score || 0) >= 35 || h.gapCategory === '人気以上走る型') {
          reason = `人気以上好走度 ${gap.over_perform_score || 0}（過去走で人気以上の好走が続いている）`
        }
        break
      }
      case 'avoid': {
        if (h.betRole === '軽視' || h.gapCategory === '人気裏切り型' || h.gapCategory === '前走過剰人気') {
          reason = `${h.gapCategory}・${h.betRole}（軸固定は避ける）`
        }
        break
      }
      default: break
    }

    if (reason) {
      matches.push({ horse: h, reason })
    }
  }

  // 並び順: 該当馬の総合予想スコア降順（同じ場合は馬番）
  const CAT_PRIO = { '巻き返し軸': 90, '人気落ち妙味': 80, '人気以上走る型': 75, '人気安定型': 72, '穴候補': 55, '判断保留': 32, '前走過剰人気': 18, '人気裏切り型': 10 }
  matches.sort((a, b) => {
    const sa = (CAT_PRIO[a.horse.gapCategory] || 30) + (a.horse.abilityScore || 0) * 0.3
    const sb = (CAT_PRIO[b.horse.gapCategory] || 30) + (b.horse.abilityScore || 0) * 0.3
    return sb - sa
  })

  return { type: cls.type, label: cls.label, matches }
}

// ================================================================
// データアクセスラッパー (sql.js)
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
      race_count: r.race_count, horse_count: r.horse_count, result_count: r.result_count,
      date_range: { earliest: r.earliest, latest: r.latest },
    }
  },
  getDates(db) {
    return queryAll(db,
      'SELECT race_date AS date, COUNT(*) AS race_count FROM jrdb_races GROUP BY race_date ORDER BY race_date DESC LIMIT 60')
  },
  // 本日注目レース画面用: jrdb_races と race_summaries を結合した軽量一覧
  getDaySummaries(db, date) {
    const hasSummary = queryAll(db,
      "SELECT name FROM sqlite_master WHERE type='table' AND name='race_summaries'").length > 0
    const rows = queryAll(db, `
      SELECT r.race_key, r.place_code, r.race_no, r.post_time, r.distance, r.surface_code,
             r.grade, r.field_size, r.race_name${hasSummary ? ', s.summary_json' : ''}
      FROM jrdb_races r
      ${hasSummary ? 'LEFT JOIN race_summaries s ON r.race_key = s.race_key' : ''}
      WHERE r.race_date = ?
      ORDER BY r.place_code, r.race_no`, [date])
    return rows.map((r) => {
      let summary = null
      if (r.summary_json) { try { summary = JSON.parse(r.summary_json) } catch { summary = null } }
      return {
        ...r,
        place: PLACE_NAMES[r.place_code] || r.place_code,
        surface: SURFACE_NAMES[r.surface_code] || r.surface_code,
        summary,
      }
    })
  },
  getRacesOfDate(db, date) {
    const rows = queryAll(db,
      `SELECT race_key, place_code, race_no, post_time, distance, surface_code, grade, field_size, race_name
       FROM jrdb_races WHERE race_date = ? ORDER BY place_code, race_no`, [date])
    return rows.map((r) => ({
      ...r, place: PLACE_NAMES[r.place_code] || r.place_code, surface: SURFACE_NAMES[r.surface_code] || r.surface_code,
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
    e.preventDefault(); setLoading(true); setError('')
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
      onLogin(data.session)
    } catch (err) { setError(err?.message || 'ログインに失敗しました') }
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
              <p className="text-[10px] font-medium text-slate-500 tracking-wider mt-1">PROTOTYPE v0.2 / 個人専用</p>
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
// 小物
// ================================================================
const Pill = ({ children, className = '' }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold border whitespace-nowrap ${className}`}>{children}</span>
)
const fmtDate = (yyyymmdd) => {
  if (!yyyymmdd || yyyymmdd.length < 8) return ''
  const w = ['日', '月', '火', '水', '木', '金', '土']
  const d = new Date(`${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}T00:00:00`)
  const wd = isNaN(d) ? '' : ` (${w[d.getDay()]})`
  return `${yyyymmdd.slice(0, 4)}/${yyyymmdd.slice(4, 6)}/${yyyymmdd.slice(6, 8)}${wd}`
}

// ================================================================
// メインアプリ
// ================================================================
function MainApp({ session, onLogout }) {
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
    setDb(null); setDbError(''); setDbProgress({ loaded: 0, total: 0, fromCache: false })
    try { setDb(await loadDb({ forceRefresh: true, onProgress: setDbProgress })) }
    catch (err) { setDbError(err?.message || 'DB再取得失敗') }
  }

  // 選択中レース
  const [raceInfo, setRaceInfo] = useState(null)
  const [horses, setHorses] = useState([])
  const [summary, setSummary] = useState({})
  const [currentRaceKey, setCurrentRaceKey] = useState(null)

  // 本日の日付・一覧
  const [selectedDate, setSelectedDate] = useState(null)
  const [dates, setDates] = useState([])

  const [tab, setTab] = useState('today')
  const [selectedId, setSelectedId] = useState(null)
  const [sortKey, setSortKey] = useState('ability')
  const [roleFilter, setRoleFilter] = useState('all')
  const [search, setSearch] = useState('')
  // AI 候補抽出（自然文 → 構造化検索 + 説明文生成）
  const [aiQuery, setAiQuery] = useState('')
  const [aiResult, setAiResult] = useState(null)

  const selectedHorse = useMemo(() => horses.find((h) => h.id === selectedId), [horses, selectedId])

  // ---- 診断情報（バージョン表示） ----
  const diag = useMemo(() => {
    if (!db) return null
    const one = (sql) => { try { return queryAll(db, sql)[0] } catch { return null } }
    const ev = one('SELECT evaluator_version AS v, COUNT(*) AS n, MAX(evaluated_at) AS at FROM race_evaluations GROUP BY evaluator_version ORDER BY n DESC LIMIT 1')
    const sum = one('SELECT COUNT(*) AS n FROM race_summaries')
    const latest = one('SELECT MAX(race_date) AS d FROM jrdb_races')
    return {
      evaluator: ev?.v || '—',
      evaluatedAt: ev?.at || null,
      summaries: sum?.n ?? '—',
      latestDate: latest?.d || null,
    }
  }, [db])

  // 日付リスト初期化（最新日をデフォルト）
  useEffect(() => {
    if (!db) return
    try {
      const ds = dataApi.getDates(db)
      setDates(ds)
      if (ds.length > 0) setSelectedDate((cur) => cur || ds[0].date)
    } catch (err) { console.error(err) }
  }, [db])

  // ---- リサイザー ----
  const LIST_WIDTH_KEY = 'race-analyzer:listWidthPct'
  const [listWidthPct, setListWidthPct] = useState(() => {
    const s = Number(localStorage.getItem(LIST_WIDTH_KEY))
    return s >= 25 && s <= 75 ? s : 46
  })
  const listWidthRef = useRef(listWidthPct)
  useEffect(() => { listWidthRef.current = listWidthPct }, [listWidthPct])
  const splitContainerRef = useRef(null)
  const startResize = (e) => {
    e.preventDefault()
    const startX = e.clientX, startPct = listWidthRef.current
    const cw = splitContainerRef.current?.offsetWidth || 1200
    const onMove = (ev) => setListWidthPct(Math.max(25, Math.min(75, startPct + ((ev.clientX - startX) / cw) * 100)))
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''; document.body.style.userSelect = ''
      localStorage.setItem(LIST_WIDTH_KEY, String(Math.round(listWidthRef.current)))
    }
    document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none'
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp)
  }
  const resetWidth = () => { setListWidthPct(46); localStorage.setItem(LIST_WIDTH_KEY, '46') }

  // レース選択 → 評価ロード → 出走馬分析へ
  const loadAsTarget = (raceKey, goTab = 'analysis') => {
    if (!db) return
    try {
      const data = dataApi.getEvaluation(db, raceKey)
      if (!data) { alert('このレースには評価データがありません（evaluate_all.py の再実行が必要かも）'); return }
      setRaceInfo(data.race); setHorses(data.horses); setSummary(data.summary)
      setCurrentRaceKey(raceKey); setSelectedId(data.horses[0]?.id || null)
      setRoleFilter('all'); setSortKey('overall'); setTab(goTab)
    } catch (err) { console.error(err); alert('評価データの読み込みに失敗: ' + err.message) }
  }

  // ---- 出走馬一覧の表示用ソート/フィルタ ----
  const displayHorses = useMemo(() => {
    let list = [...horses]
    const matchRole = (h, f) => {
      const cat = h.gapCategory
      const role = h.betRole
      switch (f) {
        case 'axis':     return role === '1着軸' || role === '2着軸' || role === '相手軸'
        case 'comeback': return cat === '巻き返し軸'
        case 'value':    return cat === '人気落ち妙味' || cat === '人気以上走る型'
        case 'hole':     return cat === '穴候補' || role === '3着軸'
        case 'stable':   return cat === '人気安定型'
        case 'avoid':    return role === '軽視' || cat === '人気裏切り型' || cat === '前走過剰人気'
        default: return true
      }
    }
    if (roleFilter !== 'all') list = list.filter((h) => matchRole(h, roleFilter))
    if (search) {
      const s = search.toLowerCase()
      list = list.filter((h) => (h.name || '').toLowerCase().includes(s) || (h.jockey || '').toLowerCase().includes(s))
    }
    const roleOrder = {
      '妙味軸': 9, '昇級妙味': 8, '昇級後通用': 8, '2着妙味': 7, '昇級確認': 6, '3着穴': 5,
      '危険人気': 4, '昇級注意': 3, '注意': 2, '初出走注意': 1, '地方注意': 1, 'データ不足': 0, '見送り': 0,
    }
    const popOrder = { '人気薄好走型': 3, '人気上位凡走型': 2, '人気先行注意': 2 }
    const recentOrder = {
      '昇級後初好走': 7, '調教上向き': 6, '同級好走': 5, '昇級初戦': 5, '同級安定': 4,
      '昇級後凡走': 3, '前走大敗': 2, '地方実績': 2, '比較難': 1, '初出走': 0,
    }
    const upgradeOrder = { '昇級後通用': 5, '昇級妙味': 4, '昇級確認': 3, '昇級2戦目': 2, '昇級初戦': 2, '昇級苦戦': 1 }
    const classScore = (h) => {
      const m = (h.classRecordSummary || '').match(/^(\d+)-(\d+)-(\d+)-(\d+)$/)
      if (!m) return 0
      return Number(m[1]) * 4 + Number(m[2]) * 2 + Number(m[3])
    }
    const upScore = (h) => (h.upgradeProfile ? (upgradeOrder[h.upgradeProfile.category] || 1) : -1)
    const evalMap = { '◎': 4, '○': 3, '△': 2, '×': 1 }
    const gap = (h, key) => (h.popularityGap && h.popularityGap[key]) || 0
    // 各種優先度マップ（評価が高い順）
    const CAT_PRIO = { '巻き返し軸': 90, '人気落ち妙味': 80, '人気以上走る型': 75, '人気安定型': 72, '穴候補': 55, '判断保留': 32, '前走過剰人気': 18, '人気裏切り型': 10 }
    const BETROLE_PRIO = { '1着軸': 95, '2着軸': 80, '相手軸': 70, '3着軸': 52, '押さえ': 30, '軽視': 8 }
    const RANGE_PRIO = { '1〜3着候補': 90, '2〜5着候補': 72, '3〜7着候補': 52, '5〜10着候補': 28, '8着以下想定': 8 }
    // 総合予想スコア: カテゴリ・軸タイプ・好走レンジ・能力・勝ち切り度・巻き返し指数 を加重平均
    const overallScore = (h) => (
      (CAT_PRIO[h.gapCategory] || 30) * 0.28 +
      (BETROLE_PRIO[h.betRole] || 30) * 0.20 +
      (RANGE_PRIO[h.gapFinishRange] || 30) * 0.15 +
      (h.abilityScore || 0) * 0.12 +
      (h.winScore || 0) * 0.15 +
      gap(h, 'comeback_index') * 0.10
    )
    // ティブレーカー: 同点時に総合予想を二次基準にする
    const tieBreak = (a, b) => overallScore(b) - overallScore(a)
    list.sort((a, b) => {
      switch (sortKey) {
        case 'no':       return a.no - b.no
        case 'ability':  return (b.abilityScore || 0) - (a.abilityScore || 0) || tieBreak(a, b)
        case 'winScore': return (b.winScore || 0) - (a.winScore || 0) || tieBreak(a, b)
        case 'comeback': return gap(b, 'comeback_index') - gap(a, 'comeback_index') || tieBreak(a, b)
        case 'axis2':    return gap(b, 'axis2_score') - gap(a, 'axis2_score') || tieBreak(a, b)
        case 'axis3':    return gap(b, 'axis3_score') - gap(a, 'axis3_score') || tieBreak(a, b)
        case 'category': return (CAT_PRIO[b.gapCategory] || 0) - (CAT_PRIO[a.gapCategory] || 0) || tieBreak(a, b)
        case 'betRole':  return (BETROLE_PRIO[b.betRole] || 0) - (BETROLE_PRIO[a.betRole] || 0) || tieBreak(a, b)
        case 'range':    return (RANGE_PRIO[b.gapFinishRange] || 0) - (RANGE_PRIO[a.gapFinishRange] || 0) || tieBreak(a, b)
        case 'valueDrop':return gap(b, 'value_drop_score') - gap(a, 'value_drop_score') || tieBreak(a, b)
        case 'overall':
        default:
          return overallScore(b) - overallScore(a)
      }
    })
    return list
  }, [roleFilter, sortKey, search, horses])

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
              <button onClick={refreshDb} className="text-xs bg-[#0B2545] text-white px-4 py-2 rounded font-bold">再試行</button>
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
                {mb(dbProgress.loaded)} MB{dbProgress.total ? ` / ${mb(dbProgress.total)} MB (${pct}%)` : ''}
              </p>
            </>
          )}
        </div>
      </div>
    )
  }

  // ================================================================
  // タブ: 本日注目レース
  // ================================================================
  const TabToday = () => {
    const [daySummaries, setDaySummaries] = useState([])
    const [dayFilter, setDayFilter] = useState('all')

    useEffect(() => {
      if (!selectedDate) return
      try { setDaySummaries(dataApi.getDaySummaries(db, selectedDate)) } catch (e) { console.error(e) }
    }, [selectedDate])

    const prio = (r) => r.summary?.racePriority || 'C'
    const prioRank = { A: 4, B: 3, C: 2, D: 1 }

    // サマリーカード集計
    const counts = useMemo(() => {
      let notable = 0, valueAxis = 0, maiden = 0, local = 0
      for (const r of daySummaries) {
        const s = r.summary
        if (!s) continue
        if (s.racePriority === 'A' || s.racePriority === 'B') notable++
        if ((s.counts?.valueAxis || 0) >= 1) valueAxis++
        if ((s.raceScenarioTags || []).includes('未勝利・初出走注意')) maiden++
        if ((s.counts?.localCaution || 0) >= 1) local++
      }
      return { notable, valueAxis, maiden, local }
    }, [daySummaries])

    // フィルタ（会場別・まず見るべき 共通で連動）
    const filtered = useMemo(() => {
      let list = [...daySummaries]
      switch (dayFilter) {
        case 'notable': list = list.filter((r) => ['A', 'B'].includes(prio(r))); break
        case 'value': list = list.filter((r) => (r.summary?.counts?.valueAxis || 0) >= 1); break
        case 'maiden': list = list.filter((r) => (r.summary?.raceScenarioTags || []).includes('未勝利・初出走注意')); break
        case 'local': list = list.filter((r) => (r.summary?.counts?.localCaution || 0) >= 1); break
        case 'exclude': list = list.filter((r) => prio(r) !== 'D' && !r.summary?.isShinba); break
        default: break
      }
      return list
    }, [daySummaries, dayFilter])

    // まず見るべきレース（フィルタ連動・優先度＋注目数で上位）
    const topRaces = useMemo(() => {
      return [...filtered]
        .filter((r) => r.summary && !r.summary.isShinba && prio(r) !== 'D')
        .sort((a, b) => {
          const pr = prioRank[prio(b)] - prioRank[prio(a)]
          if (pr) return pr
          return (b.summary?.counts?.notable || 0) - (a.summary?.counts?.notable || 0)
        }).slice(0, 6)
    }, [filtered])

    // 会場別グループ
    const groups = []
    const idx = new Map()
    for (const r of filtered) {
      const key = r.place_code
      if (!idx.has(key)) { idx.set(key, groups.length); groups.push({ place: r.place, place_code: key, items: [] }) }
      groups[idx.get(key)].items.push(r)
    }

    // KPIカード → フィルタ連動（クリックで該当条件に絞り込み）
    const SummaryCard = ({ icon: Icon, color, label, value, filterKey }) => {
      const active = dayFilter === filterKey
      return (
        <button onClick={() => setDayFilter(active ? 'all' : filterKey)}
          className={`bg-white border rounded-2xl p-4 shadow-sm flex items-center gap-3 text-left transition-all hover:shadow ${
            active ? 'border-[#0B2545] ring-1 ring-[#0B2545]/20' : 'border-slate-200/80 hover:border-[#4A90E2]/50'}`}>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center ${color}`}><Icon className="w-5 h-5" /></div>
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500 font-medium truncate">{label}</div>
            <div className="text-2xl font-black tabular-nums text-[#0B2545] leading-none mt-0.5">{value}</div>
          </div>
        </button>
      )
    }

    // 行/カード内のバッジ → クリックでフィルタ（行クリックの遷移とは分離）
    // 親が <button> のため span(role=button) を使い、ボタンのネストを避ける
    const FilterPill = ({ tag, className }) => {
      const fk = tagToDayFilter(tag)
      if (!fk) return <Pill className={className}>{tag}</Pill>
      const onClick = (e) => { e.stopPropagation(); setDayFilter(dayFilter === fk ? 'all' : fk) }
      return (
        <span role="button" tabIndex={0} onClick={onClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onClick(e) }}
          className="hover:brightness-95 transition cursor-pointer" title={`${tag}で絞り込み`}>
          <Pill className={className}>{tag}</Pill>
        </span>
      )
    }

    const DAY_FILTERS = [
      ['all', 'すべて'], ['notable', '注目のみ'], ['value', '人気落ち実力馬あり'],
      ['maiden', '未勝利注意'], ['local', '地方馬注意'], ['exclude', '見送り除外'],
    ]

    return (
      <div className="space-y-6 pb-16">
        {/* ヘッダ */}
        <div className="flex items-end justify-between flex-wrap gap-3">
          <div>
            <div className="text-sm font-bold text-[#4A90E2] tracking-wide tabular-nums">{fmtDate(selectedDate)}</div>
            <h1 className="text-3xl font-black text-[#0B2545] mt-1">本日のレース一覧</h1>
            <p className="text-sm text-slate-500 mt-1">朝の時点で、見るべきレースを絞り込む</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500">開催日</span>
            <select value={selectedDate || ''} onChange={(e) => setSelectedDate(e.target.value)}
              className="bg-white border border-slate-200 text-sm font-medium text-slate-800 py-1.5 px-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4A90E2]">
              {dates.map((d) => (
                <option key={d.date} value={d.date}>{fmtDate(d.date)} ({d.race_count}R)</option>
              ))}
            </select>
          </div>
        </div>

        {/* サマリーカード（クリックで絞り込み） */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryCard icon={Star} color="bg-rose-50 text-rose-600" label="注目レース" value={counts.notable} filterKey="notable" />
          <SummaryCard icon={Flame} color="bg-orange-50 text-orange-600" label="人気落ち実力馬あり" value={counts.valueAxis} filterKey="value" />
          <SummaryCard icon={AlertTriangle} color="bg-emerald-50 text-emerald-600" label="未勝利・初出走注意" value={counts.maiden} filterKey="maiden" />
          <SummaryCard icon={MapPin} color="bg-purple-50 text-purple-600" label="地方馬注意" value={counts.local} filterKey="local" />
        </div>

        <div className="bg-[#4A90E2]/5 border border-[#4A90E2]/20 rounded-xl px-4 py-2.5 text-xs text-[#2B6CB0] flex items-center gap-2">
          <Info className="w-4 h-4 shrink-0" /> AIは買い目を断定せず、妙味が出そうな構造を整理します。当日オッズは別アプリで最終確認してください。
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6">
          <div className="space-y-6">
            {/* まず見るべきレース */}
            <div>
              <h2 className="text-lg font-bold text-[#0B2545] mb-3 flex items-center gap-2"><Eye className="w-5 h-5 text-[#4A90E2]" /> まず見るべきレース</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {topRaces.length === 0 && (
                  <div className="col-span-full text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl p-6 text-center">
                    注目レースの評価がまだありません（evaluate_all.py の再計算が必要かも）。
                  </div>
                )}
                {topRaces.map((r) => {
                  const s = r.summary || {}
                  const p = PRIORITY_STYLES[s.racePriority] || PRIORITY_STYLES.C
                  const headTag = (s.raceScenarioTags || []).find((t) => SCENARIO_TAG_STYLES[t]) || (s.raceScenarioTags || [])[0]
                  return (
                    <button key={r.race_key} onClick={() => loadAsTarget(r.race_key)}
                      className="text-left bg-white border border-slate-200/80 rounded-xl p-4 shadow-sm hover:border-[#4A90E2]/50 hover:shadow transition-all group">
                      <div className="flex items-center gap-2 text-xs font-bold text-slate-500 mb-2">
                        <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-700">{r.place}</span>
                        <span className="text-[#0B2545] tabular-nums">{r.race_no}R</span>
                        <span className="text-slate-400 font-medium truncate">{s.classLabel || ''}</span>
                        <ChevronRight className="w-4 h-4 text-slate-300 ml-auto group-hover:text-[#4A90E2]" />
                      </div>
                      <div className="flex flex-wrap gap-1 mb-2">
                        <FilterPill tag={p.label} className={p.cls} />
                        {headTag && <FilterPill tag={headTag} className={tagStyle(headTag)} />}
                      </div>
                      <div className="text-sm font-bold text-slate-900 truncate">{r.race_name}</div>
                      <p className="text-[11px] text-slate-500 mt-1 line-clamp-2">{s.raceScenarioComment || '—'}</p>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* フィルタ */}
            <div className="flex items-center gap-2 flex-wrap">
              <ListFilter className="w-4 h-4 text-slate-400" />
              {DAY_FILTERS.map(([k, label]) => (
                <button key={k} onClick={() => setDayFilter(k)}
                  className={`px-3 py-1 text-xs font-bold rounded-full border transition-all ${
                    dayFilter === k ? 'bg-[#0B2545] text-white border-[#0B2545]' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {label}
                </button>
              ))}
              <span className="ml-auto text-xs text-slate-400">並び順: 優先度順</span>
            </div>

            {/* 会場別レース一覧 */}
            <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, minmax(0, 1fr))` }}>
              {groups.map((g) => {
                const items = [...g.items].sort((a, b) => a.race_no - b.race_no)
                return (
                  <div key={g.place_code} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                    <div className="px-4 py-2.5 bg-[#0B2545] text-white flex items-center justify-between">
                      <span className="font-bold tracking-wide">{g.place}</span>
                      <span className="text-xs font-medium text-slate-300">{items.length}R</span>
                    </div>
                    <div className="divide-y divide-slate-100">
                      {items.map((r) => {
                        const s = r.summary || {}
                        const p = s.racePriority
                        const isHot = p === 'A'
                        const excluded = s.isShinba || p === 'D'
                        const tags = (s.raceScenarioTags || []).filter((t) => SCENARIO_TAG_STYLES[t]).slice(0, 2)
                        return (
                          <button key={r.race_key} onClick={() => loadAsTarget(r.race_key)}
                            className={`w-full text-left px-3 py-2.5 flex items-start gap-2.5 transition-colors ${
                              isHot ? 'bg-rose-50/40 hover:bg-rose-50' : 'hover:bg-slate-50'}`}>
                            <div className="shrink-0 w-9 text-center">
                              <div className="text-sm font-bold text-[#0B2545] tabular-nums">{r.race_no}R</div>
                              <div className="text-[10px] text-slate-400 tabular-nums">{fmtTime(r.post_time)}</div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-slate-800 truncate flex items-center gap-1.5">
                                {r.grade && <Pill className="bg-rose-50 text-rose-700 border-rose-100">{r.grade === '1' ? 'G1' : r.grade === '2' ? 'G2' : r.grade === '3' ? 'G3' : r.grade === '5' ? '特' : 'L'}</Pill>}
                                <span className="truncate">{r.race_name}</span>
                              </div>
                              <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">{r.surface}{r.distance}m ・ {r.field_size}頭</div>
                              <div className="flex flex-wrap items-center gap-1 mt-1">
                                {excluded ? (
                                  <Pill className="bg-slate-100 text-slate-400 border-slate-200">{s.isShinba ? '除外対象' : '見送り'}</Pill>
                                ) : tags.map((t) => <FilterPill key={t} tag={t} className={tagStyle(t)} />)}
                              </div>
                              {s.raceScenarioComment && (
                                <p className="text-[10px] text-slate-400 mt-1 line-clamp-1">{s.excludeReason || s.raceScenarioComment}</p>
                              )}
                            </div>
                            <div className="shrink-0 self-center flex flex-col items-end gap-1">
                              {p && <FilterPill tag={(PRIORITY_STYLES[p] || PRIORITY_STYLES.C).label} className={(PRIORITY_STYLES[p] || PRIORITY_STYLES.C).cls} />}
                              <ChevronRight className="w-4 h-4 text-slate-300" />
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {groups.length === 0 && (
                <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
                  該当するレースがありません。
                </div>
              )}
            </div>
          </div>

          {/* 今日の見方 */}
          <aside className="space-y-4">
            <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm sticky top-24">
              <h3 className="text-sm font-bold text-[#0B2545] mb-3 flex items-center gap-2"><Lightbulb className="w-4 h-4 text-amber-500" /> 今日の見方</h3>
              <ul className="space-y-2.5 text-xs text-slate-600 leading-relaxed">
                {[
                  '能力順は入口。最終判断はクラス・人気履歴・着順で確認',
                  '調教・騎手相性は補正材料',
                  '新馬戦は基本除外、未勝利の初出走は要注意',
                  '地方実績は中央換算の参考評価',
                  '当日オッズは別アプリで最終確認',
                ].map((t, i) => (
                  <li key={i} className="flex gap-2"><CheckCircle2 className="w-3.5 h-3.5 text-[#4A90E2] shrink-0 mt-0.5" /><span>{t}</span></li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    )
  }

  // ================================================================
  // タブ: レース一覧（シンプルな全レース開閉）
  // ================================================================
  const TabRaces = () => {
    const [races, setRaces] = useState([])
    const [stats, setStats] = useState(null)
    useEffect(() => {
      if (!selectedDate) return
      try { setRaces(dataApi.getRacesOfDate(db, selectedDate)); setStats(dataApi.getStats(db)) } catch (e) { console.error(e) }
    }, [selectedDate])

    const groups = []
    const idx = new Map()
    for (const r of races) {
      const key = r.place_code
      if (!idx.has(key)) { idx.set(key, groups.length); groups.push({ place: r.place, place_code: key, items: [] }) }
      groups[idx.get(key)].items.push(r)
    }
    return (
      <div className="space-y-6 pb-12">
        {stats && (
          <div className="bg-white border border-slate-200/80 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <span className="text-xs font-bold tracking-widest text-[#4A90E2] uppercase">JRDB 取り込みデータ</span>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-500">開催日</span>
                <select value={selectedDate || ''} onChange={(e) => setSelectedDate(e.target.value)}
                  className="bg-white border border-slate-200 text-sm font-medium text-slate-800 py-1.5 px-3 rounded-lg focus:outline-none focus:ring-1 focus:ring-[#4A90E2]">
                  {dates.map((d) => <option key={d.date} value={d.date}>{fmtDate(d.date)} ({d.race_count}R)</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {[['レース総数', stats.race_count.toLocaleString()], ['登録馬数', stats.horse_count.toLocaleString()],
                ['過去走レコード', stats.result_count.toLocaleString()]].map(([l, v]) => (
                <div key={l}><div className="text-xs text-slate-500 font-medium mb-1">{l}</div><div className="text-2xl font-bold tabular-nums text-[#0B2545]">{v}</div></div>
              ))}
              <div><div className="text-xs text-slate-500 font-medium mb-1">対象期間</div>
                <div className="text-sm font-bold tabular-nums text-slate-700 mt-1">{stats.date_range.earliest} 〜 {stats.date_range.latest}</div></div>
            </div>
          </div>
        )}
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${Math.max(groups.length, 1)}, minmax(0, 1fr))` }}>
          {groups.map((g) => (
            <div key={g.place_code} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-[#0B2545] text-white flex items-center justify-between">
                <span className="font-bold tracking-wide">{g.place}</span><span className="text-xs text-slate-300">{g.items.length}R</span>
              </div>
              <div className="divide-y divide-slate-100">
                {g.items.map((r) => (
                  <button key={r.race_key} onClick={() => loadAsTarget(r.race_key)} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 flex items-start gap-2.5">
                    <div className="shrink-0 w-9 text-center">
                      <div className="text-sm font-bold text-[#0B2545] tabular-nums">{r.race_no}R</div>
                      <div className="text-[10px] text-slate-400 tabular-nums">{fmtTime(r.post_time)}</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{r.race_name}</div>
                      <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">{r.surface}{r.distance}m ・ {r.field_size}頭</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-300 self-center" />
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ================================================================
  // タブ: 出走馬分析
  // ================================================================
  // 一覧のフィルタチップ（軸タイプ × 予想カテゴリのよくある絞り込み）
  const ROLE_FILTERS = [
    ['all', 'すべて'],
    ['axis', '軸候補'],         // 1着軸 / 2着軸 / 相手軸
    ['comeback', '巻き返し'],   // 巻き返し軸
    ['value', '人気落ち妙味'],   // 人気落ち妙味
    ['hole', '穴候補'],         // 穴候補 / 3着軸
    ['stable', '人気安定'],     // 人気安定型
    ['avoid', '評価下げ'],      // 軽視 / 人気裏切り / 前走過剰人気
  ]
  const TabAnalysis = () => {
    if (!raceInfo || horses.length === 0) {
      return <EmptyRace />
    }
    const onAiSubmit = (q) => {
      const text = (q ?? aiQuery).trim()
      if (!text) return
      setAiQuery(text)
      setAiResult(runAiQuery(text, horses))
    }
    return (
      <div ref={splitContainerRef} className="flex items-start pb-16 relative">
        {/* 左: AI候補抽出 + 出走馬一覧 */}
        <div style={{ width: `calc(${listWidthPct}% - 10px)` }} className="flex-shrink-0 space-y-4">
        {/* AI 候補抽出パネル */}
        <div className="bg-gradient-to-r from-[#0B2545]/5 to-[#4A90E2]/5 border border-[#4A90E2]/20 rounded-2xl p-4 shadow-sm">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="w-4 h-4 text-[#4A90E2]" />
            <span className="text-sm font-bold text-[#0B2545]">AI候補抽出</span>
            <span className="text-[10px] text-slate-400 ml-auto">構造化データから条件に合う馬を抽出</span>
          </div>
          {/* 入力欄 */}
          <div className="flex gap-2 mb-2">
            <input
              type="text"
              value={aiQuery}
              onChange={(e) => setAiQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') onAiSubmit() }}
              placeholder="例）GⅢ以上に出走経験がある馬を教えて"
              className="flex-1 bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-900 focus:outline-none focus:ring-1 focus:ring-[#4A90E2] focus:border-[#4A90E2]"
            />
            <button
              onClick={() => onAiSubmit()}
              className="px-4 py-1.5 bg-[#0B2545] hover:bg-[#0B2545]/90 text-white rounded-lg text-sm font-bold shrink-0"
            >
              候補抽出
            </button>
            {aiResult && (
              <button
                onClick={() => { setAiQuery(''); setAiResult(null) }}
                className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg text-xs font-bold shrink-0 hover:bg-slate-50"
              >
                クリア
              </button>
            )}
          </div>
          {/* サンプルチップ */}
          <div className="flex gap-1.5 flex-wrap">
            {AI_QUESTION_CHIPS.map((c) => (
              <button
                key={c.label}
                onClick={() => { setAiQuery(c.q); onAiSubmit(c.q) }}
                className="px-2.5 py-1 text-[11px] font-bold rounded-full border border-slate-200 bg-white text-slate-600 hover:border-[#4A90E2] hover:text-[#0B2545] transition-colors"
              >
                {c.label}
              </button>
            ))}
          </div>
          {/* 結果カード */}
          {aiResult && <AiResultCard result={aiResult} onSelect={(id) => setSelectedId(id)} selectedId={selectedId} />}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="flex justify-between items-center mb-3">
              <h3 className="font-bold text-slate-800 flex items-center gap-2">出走馬一覧 <span className="text-xs font-normal text-slate-500">({displayHorses.length}頭)</span></h3>
              <div className="relative">
                <select className="appearance-none bg-white border border-slate-200 text-xs font-bold text-slate-700 py-1.5 pl-3 pr-8 rounded-full focus:outline-none focus:ring-1 focus:ring-[#4A90E2]"
                  value={sortKey} onChange={(e) => setSortKey(e.target.value)}>
                  <option value="overall">総合予想順（おすすめ）</option>
                  <optgroup label="── 予想分類で並べる ──">
                    <option value="betRole">軸タイプ順（1着軸→軽視）</option>
                    <option value="category">予想カテゴリ順</option>
                    <option value="range">好走レンジ順（上位→下位）</option>
                  </optgroup>
                  <optgroup label="── 指数で並べる ──">
                    <option value="ability">能力順</option>
                    <option value="winScore">勝ち切り度順</option>
                    <option value="comeback">巻き返し指数順</option>
                    <option value="valueDrop">人気落ち妙味順</option>
                    <option value="axis2">2着軸適性順</option>
                    <option value="axis3">3着穴適性順</option>
                  </optgroup>
                  <optgroup label="── その他 ──">
                    <option value="no">馬番順</option>
                  </optgroup>
                </select>
                <ArrowUpDown className="w-3 h-3 text-slate-400 absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              </div>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {ROLE_FILTERS.map(([k, label]) => (
                <button key={k} onClick={() => setRoleFilter(k)}
                  className={`px-2.5 py-1 text-[11px] font-bold rounded-full border transition-all ${
                    roleFilter === k ? 'bg-[#0B2545] text-white border-[#0B2545]' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500 text-[11px] border-b border-slate-200">
                <tr>
                  <th className="py-3 px-2 font-semibold text-center w-10">馬番</th>
                  <th className="py-3 px-2 font-semibold">馬名 / 騎手</th>
                  <th className="py-3 px-2 font-semibold text-center w-10">能力</th>
                  <th className="py-3 px-2 font-semibold w-28">クラス実績</th>
                  <th className="py-3 px-2 font-semibold text-center w-16">勝ち切り度</th>
                  <th className="py-3 px-2 font-semibold w-20">直近</th>
                  <th className="py-3 px-2 font-semibold w-28">予想カテゴリ<br/><span className="text-[9px] font-normal text-slate-400">/ 好走レンジ</span></th>
                  <th className="py-3 px-2 font-semibold text-center w-16">軸タイプ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {displayHorses.map((h) => (
                  <tr key={h.id} onClick={() => setSelectedId(h.id)}
                    className={`cursor-pointer transition-colors ${selectedId === h.id ? 'bg-[#4A90E2]/5' : 'hover:bg-slate-50'}`}>
                    {/* 馬番 */}
                    <td className="py-3 px-2 text-center">
                      <div className={`w-7 h-7 mx-auto rounded flex items-center justify-center font-bold text-slate-700 text-xs ${selectedId === h.id ? 'bg-white shadow-sm' : 'bg-slate-100'}`}>{h.no}</div>
                    </td>
                    {/* 馬名 / 騎手 */}
                    <td className="py-3 px-2">
                      <div className="font-bold text-slate-900 text-[13px] leading-tight truncate">{h.name}</div>
                      <div className="text-[11px] text-slate-500 truncate">{h.jockey || '—'}</div>
                    </td>
                    {/* 能力 */}
                    <td className="py-3 px-2 text-center">
                      <span className={`text-base ${ABILITY_COLORS[h.abilityRank] || 'text-slate-400'}`}>{h.abilityRank}</span>
                    </td>
                    {/* クラス実績（昇級なら昇級区分を、それ以外は同級+成績） */}
                    <td className="py-3 px-2">
                      {h.upgradeProfile ? (
                        <>
                          <div className="text-[11px] font-bold text-orange-700 leading-tight">{h.upgradeProfile.category}</div>
                          <div className="text-[10px] text-orange-600/80 mt-0.5 leading-tight">{h.upgradeProfile.prevClass} {h.upgradeProfile.prevWinSummary}</div>
                        </>
                      ) : (
                        <>
                          <div className="text-[11px] font-bold text-slate-700 leading-tight">{h.classSummary || '—'}</div>
                          {h.classRecordSummary && <div className="text-[10px] text-slate-500 tabular-nums leading-tight">{h.classRecordSummary}</div>}
                        </>
                      )}
                    </td>
                    {/* 勝ち切り度 */}
                    <MiniScoreCell score={h.winScore} tone="navy" sortHighlight={sortKey === 'winScore'} />
                    {/* 直近（recentStatus + popularityType） */}
                    <td className="py-3 px-2">
                      <div className="text-[11px] font-bold text-slate-700 leading-tight">{h.recentStatusSummary || '—'}</div>
                      {h.popularityType && <div className="text-[10px] text-orange-600 font-bold mt-0.5 leading-tight">{h.popularityType}</div>}
                    </td>
                    {/* 予想カテゴリ + 好走レンジ */}
                    <td className="py-3 px-2">
                      {h.gapCategory ? (
                        <>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${gapCategoryStyle(h.gapCategory)}`}>{h.gapCategory}</span>
                          {h.gapFinishRange && (
                            <div className="text-[10px] text-slate-500 mt-1 leading-tight">{h.gapFinishRange}</div>
                          )}
                        </>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                    {/* 軸タイプ */}
                    <td className="py-3 px-2 text-center">
                      {h.betRole ? (
                        <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-bold border ${betRoleStyle(h.betRole)}`}>{h.betRole}</span>
                      ) : <span className="text-slate-300 text-xs">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-2 text-[10px] text-slate-400 border-t border-slate-100">
              {horses.length}頭中 {displayHorses.length}件表示 ・ 総合予想順 = 予想カテゴリ・軸タイプ・好走レンジ・能力・勝ち切り度・巻き返し指数 を加重平均
            </div>
          </div>
        </div>
        </div>

        {/* リサイザー */}
        <div onMouseDown={startResize} onDoubleClick={resetWidth}
          className="w-5 self-stretch flex items-center justify-center cursor-col-resize group flex-shrink-0" title="ドラッグで幅調整 / ダブルクリックでリセット">
          <div className="w-1 h-16 rounded-full bg-slate-200 group-hover:bg-[#4A90E2] transition-colors" />
        </div>

        {/* 右: 馬詳細 */}
        <div style={{ width: `calc(${100 - listWidthPct}% - 10px)` }} className="sticky top-24 flex-shrink-0">
          {selectedHorse ? <HorseDetail h={selectedHorse} /> : (
            <div className="h-64 rounded-2xl border-2 border-dashed border-slate-200 flex flex-col items-center justify-center text-slate-400 bg-white">
              <Search className="w-8 h-8 mb-2 opacity-50" /><p className="text-sm font-medium">左の一覧から馬を選択してください</p>
            </div>
          )}
        </div>
      </div>
    )
  }

  // ---- 馬詳細パネル ----
  const HorseDetail = ({ h }) => {
    const today_level = null
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col max-h-[calc(100vh-120px)]">
        {/* 上部情報 */}
        <div className="p-5 border-b border-slate-100 bg-gradient-to-br from-white to-slate-50">
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#0B2545] text-white flex items-center justify-center font-black text-xl shrink-0">{h.no}</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-xl font-black text-slate-900 leading-tight">{h.name}
                <span className="text-xs font-medium text-slate-500 ml-2">{h.sex}{h.age || '?'} {h.hairColor}</span>
              </h2>
              <div className="text-sm text-slate-600 mt-0.5">騎手: {h.jockey || '—'} <span className="text-slate-300 mx-1">|</span> 厩舎: {h.trainer || '—'}</div>
            </div>
            <div className="text-right shrink-0">
              <div className="text-[9px] text-slate-400">参考</div>
              <div className={`text-lg tabular-nums leading-none ${ABILITY_COLORS[h.abilityRank] || 'text-slate-400'}`}>能力 {h.abilityRank}</div>
              <div className="text-[9px] text-slate-400 tabular-nums">Score {h.abilityScore}</div>
            </div>
          </div>
          <div className="mt-3 flex gap-1.5 flex-wrap items-center">
            {h.gapCategory && (
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-black ${gapCategoryStyle(h.gapCategory)}`}>{h.gapCategory}</span>
            )}
            {h.betRole && (
              <span className={`px-2 py-0.5 rounded text-[11px] font-bold border ${betRoleStyle(h.betRole)}`}>{h.betRole}</span>
            )}
            {h.gapFinishRange && <span className="text-[11px] font-bold text-slate-700">{h.gapFinishRange}</span>}
            {h.classSummary && <Pill className="bg-slate-100 text-slate-600 border-slate-200">{h.classSummary}</Pill>}
            {h.localHorseEvaluation?.is_local && <Pill className="bg-purple-50 text-purple-700 border-purple-200">地方注意</Pill>}
            {h.maidenCaution && <Pill className="bg-sky-50 text-sky-700 border-sky-200">{h.maidenCaution.label}</Pill>}
          </div>
        </div>

        <div className="overflow-y-auto p-5 space-y-5">
          {/* ① 直近5走成績（人気×着順ギャップ列を含む） */}
          <div>
            <h4 className="text-[11px] font-bold text-slate-700 mb-2 flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> 直近5走成績</h4>
            <div className="border border-slate-200 rounded-lg overflow-hidden">
              <table className="w-full text-left">
                <thead className="bg-slate-50 text-slate-500 border-b border-slate-200 text-[10px]">
                  <tr>
                    <th className="py-2 pl-3 pr-2 font-semibold">日付</th>
                    <th className="py-2 px-2 font-semibold">クラス</th>
                    <th className="py-2 px-2 font-semibold">条件</th>
                    <th className="py-2 px-2 font-semibold text-center">人気</th>
                    <th className="py-2 px-2 font-semibold text-center">着順</th>
                    <th className="py-2 px-2 font-semibold text-center">ギャップ</th>
                    <th className="py-2 pl-2 pr-3 font-semibold">騎手</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(h.pastRuns || []).map((run, i) => {
                    const rankColor = run.rank === 1 ? 'text-[#0B2545]' : run.rank <= 3 && run.rank > 0 ? 'text-[#4A90E2]' : run.rank <= 5 && run.rank > 0 ? 'text-slate-700' : 'text-slate-400'
                    const g = run.popularity_gap
                    return (
                      <tr key={i} className="hover:bg-slate-50/70">
                        <td className="py-2 pl-3 pr-2 text-[10px] text-slate-400 tabular-nums">{run.date}</td>
                        <td className="py-2 px-2 text-[11px] font-semibold text-slate-800">{run.race || '—'}</td>
                        <td className="py-2 px-2 text-[10px] text-slate-500 whitespace-nowrap">{run.dist || '—'}<br />{run.going || ''}</td>
                        <td className="py-2 px-2 text-center text-[11px] text-slate-600 tabular-nums">{run.popularity ? `${run.popularity}人` : '-'}</td>
                        <td className="py-2 px-2 text-center"><span className={`text-[15px] font-black tabular-nums ${rankColor}`}>{run.rank > 0 ? run.rank : '-'}</span>{run.field_size ? <span className="text-[9px] text-slate-400">/{run.field_size}</span> : null}</td>
                        <td className="py-2 px-2 text-center">
                          {g != null ? (
                            <span className={`text-[12px] font-bold tabular-nums ${gapColor(g)}`}>{g > 0 ? `+${g}` : g}</span>
                          ) : <span className="text-slate-300 text-[10px]">—</span>}
                        </td>
                        <td className="py-2 pl-2 pr-3 text-[10px] text-slate-500 truncate max-w-[70px]">{run.jockey || '-'}</td>
                      </tr>
                    )
                  })}
                  {(!h.pastRuns || h.pastRuns.length === 0) && <tr><td colSpan={7} className="py-3 text-center text-slate-400 text-xs">過去走データなし（初出走・比較不可）</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* ② 好材料 / 不安材料（前回までの評価サマリ） */}
          {h.structuredComment && (
            <div className="border border-slate-200 rounded-xl p-3.5 bg-white">
              <div className="text-[11px] font-bold text-slate-700 mb-2 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> 前回までの評価
              </div>
              {/* 評価理由（一行サマリ） */}
              {h.structuredComment.reason && (
                <div className="mb-3 text-[12px] text-slate-700 leading-relaxed">{h.structuredComment.reason}</div>
              )}
              {/* 好材料 / 不安材料 を 2 列で並べる */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-emerald-50/70 border border-emerald-100 rounded-lg p-2.5">
                  <div className="text-[10px] font-bold text-emerald-700 mb-1.5 flex items-center gap-1">◎ 好材料</div>
                  <ul className="text-[11px] space-y-1">
                    {(h.structuredComment.positives || []).length > 0
                      ? h.structuredComment.positives.map((p, i) => (
                        <li key={i} className="text-slate-700 leading-snug">・{p}</li>
                      ))
                      : <li className="text-slate-400 leading-snug">特筆すべき好材料は乏しい</li>}
                  </ul>
                </div>
                <div className="bg-rose-50/70 border border-rose-100 rounded-lg p-2.5">
                  <div className="text-[10px] font-bold text-rose-700 mb-1.5 flex items-center gap-1">▲ 不安材料</div>
                  <ul className="text-[11px] space-y-1">
                    {(h.structuredComment.concerns || []).length > 0
                      ? h.structuredComment.concerns.map((c, i) => (
                        <li key={i} className="text-slate-700 leading-snug">・{c}</li>
                      ))
                      : <li className="text-slate-400 leading-snug">明確な不安材料は確認できず</li>}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* ③ 予想カテゴリ + 好走レンジ + 軸タイプ + 補助指数 */}
          {h.gapCategory && (
            <div className="border border-slate-200 rounded-xl p-3.5 bg-gradient-to-r from-white to-slate-50/60">
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <div className="text-[10px] font-bold text-slate-500 mb-1">予想カテゴリ</div>
                  <span className={`inline-block px-2.5 py-1 rounded-full text-[12px] font-black ${gapCategoryStyle(h.gapCategory)}`}>{h.gapCategory}</span>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-500 mb-1">好走レンジ</div>
                  <span className="text-[13px] font-bold text-slate-800">{h.gapFinishRange || '—'}</span>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-500 mb-1">軸タイプ</div>
                  {h.betRole ? (
                    <span className={`inline-block px-2 py-0.5 rounded text-[12px] font-bold border ${betRoleStyle(h.betRole)}`}>{h.betRole}</span>
                  ) : <span className="text-slate-300 text-xs">—</span>}
                </div>
              </div>
              {/* 指数ミニ表示（ソート理解用、補助） */}
              {h.popularityGap && (
                <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-4 gap-2 text-[10px]">
                  <MiniMetric label="巻き返し" v={h.popularityGap.comeback_index} />
                  <MiniMetric label="人気落ち妙味" v={h.popularityGap.value_drop_score} />
                  <MiniMetric label="2着軸適性" v={h.popularityGap.axis2_score} />
                  <MiniMetric label="3着穴適性" v={h.popularityGap.axis3_score} />
                </div>
              )}
            </div>
          )}

          {/* ④ AI構造化評価（人気×着順 / クラス / 同級実績 / 得意条件 / 傾向メモ） */}
          {h.gapStructuredEval && (
            <div className="bg-gradient-to-r from-[#0B2545]/5 to-[#4A90E2]/5 border border-[#4A90E2]/20 rounded-xl p-4">
              <div className="flex items-center gap-1.5 mb-3"><Sparkles className="w-4 h-4 text-[#4A90E2]" /><span className="text-xs font-bold text-[#0B2545]">AI 構造化評価</span></div>
              <dl className="space-y-1.5 text-[12px]">
                <EvalRow k="人気×着順" v={h.gapStructuredEval.pop_rank} />
                <EvalRow k="クラス" v={h.gapStructuredEval.class} />
                <EvalRow k="同級実績" v={h.gapStructuredEval.same_class_record} />
                <EvalRow k="得意条件" v={h.gapStructuredEval.favorite_condition} />
                <EvalRow k="傾向メモ" v={h.gapStructuredEval.memo} />
              </dl>
            </div>
          )}

          {/* ⑤ 今回補正 */}
          <div className="border border-slate-200 rounded-xl p-3 bg-slate-50/40">
            <div className="text-[11px] font-bold text-[#0B2545] mb-2 flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> 今回補正</div>
            <dl className="space-y-1.5 text-[11px]">
              <Row k="調教" v={h.trainingCorrection || '判定不可'} up={h.trainingCorrection === '立て直し気配' || h.trainingCorrection === '高水準仕上げ'} />
              <Row k="陣営本気度" v={h.stableMotivation || '判定不可'} up={h.stableMotivation === '勝負気配'} />
              <Row k="騎手相性" v={h.jockeyCompatibility || '判定不可'} up={h.jockeyCompatibility === '好走騎手戻り'} />
              <Row k="乗り替わり" v={h.jockeyChange || '判定不可'} />
            </dl>
          </div>

          {/* ⑥ 高配当シナリオ（人気×着順の流れから文章） */}
          <div className="border border-[#4A90E2]/30 rounded-xl p-4 bg-[#4A90E2]/5">
            <div className="text-[12px] font-bold text-[#2B6CB0] mb-2 flex items-center gap-1"><Wand2 className="w-4 h-4" /> 高配当シナリオ</div>
            {h.gapNarrative ? (
              <div className="text-[12px] text-slate-800 leading-relaxed whitespace-pre-line">{h.gapNarrative}</div>
            ) : <p className="text-[11px] text-slate-400">判定不可</p>}
            <div className="mt-2 text-[10px] text-slate-400">※ 条件整理に基づく仮説です。買い目は断定しません。最終判断は人間が行います。</div>
          </div>
        </div>
      </div>
    )
  }

  const AiResultCard = ({ result, onSelect, selectedId }) => {
    if (!result) return null
    if (result.type === 'empty') return null
    if (result.type === 'unknown') {
      return (
        <div className="mt-3 bg-white border border-amber-200 rounded-xl p-3">
          <div className="text-[12px] font-bold text-amber-700 mb-1">条件を判定できませんでした</div>
          <div className="text-[11px] text-slate-600">{result.note}</div>
        </div>
      )
    }
    return (
      <div className="mt-3 bg-white border border-[#4A90E2]/30 rounded-xl overflow-hidden">
        <div className="px-3 py-2 bg-[#4A90E2]/10 border-b border-[#4A90E2]/20 flex items-center justify-between">
          <div className="text-[12px] font-bold text-[#0B2545]">
            条件：{result.label}
          </div>
          <div className="text-[11px] font-bold text-slate-600">
            該当 <span className="text-[#0B2545]">{result.matches.length}</span> 頭
          </div>
        </div>
        {result.matches.length === 0 ? (
          <div className="p-4 text-[12px] text-slate-500 text-center">該当馬なし</div>
        ) : (
          <ul className="divide-y divide-slate-100 max-h-72 overflow-y-auto">
            {result.matches.map(({ horse, reason }) => (
              <li
                key={horse.id}
                onClick={() => onSelect(horse.id)}
                className={`px-3 py-2.5 cursor-pointer hover:bg-slate-50 ${selectedId === horse.id ? 'bg-[#4A90E2]/5' : ''}`}
              >
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded bg-[#0B2545] text-white flex items-center justify-center text-[11px] font-bold shrink-0">
                    {horse.no}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-bold text-[13px] text-slate-900">{horse.name}</span>
                      {horse.gapCategory && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${gapCategoryStyle(horse.gapCategory)}`}>{horse.gapCategory}</span>
                      )}
                      {horse.gapFinishRange && <span className="text-[10px] text-slate-500">{horse.gapFinishRange}</span>}
                      {horse.betRole && (
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${betRoleStyle(horse.betRole)}`}>{horse.betRole}</span>
                      )}
                    </div>
                    <div className="text-[11px] text-slate-700 mt-1 leading-snug">
                      <span className="font-bold text-[#0B2545]">該当理由：</span>{reason}
                    </div>
                    <div className="text-[11px] text-slate-600 mt-0.5 leading-snug">
                      <span className="font-bold text-emerald-700">馬券上の扱い：</span>
                      {BETTING_ADVICE_BY_CATEGORY[horse.gapCategory] || '他指標と合わせて検討。'}
                    </div>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        <div className="px-3 py-2 bg-slate-50 border-t border-slate-100 text-[10px] text-slate-400">
          ※ 構造化データに基づく抽出です。未来の結果を保証するものではありません。検討材料としてご活用ください。
        </div>
      </div>
    )
  }

  const EvalRow = ({ k, v }) => (
    <div className="flex items-start gap-3 border-b border-slate-100/60 last:border-0 pb-1.5">
      <dt className="text-slate-500 font-bold w-24 shrink-0">{k}</dt>
      <dd className="text-slate-800 font-medium flex-1">{v || '—'}</dd>
    </div>
  )

  const MiniMetric = ({ label, v }) => {
    const n = Number(v) || 0
    return (
      <div className="text-center">
        <div className="text-[9px] text-slate-500 font-bold">{label}</div>
        <div className={`text-[13px] font-black tabular-nums ${n >= 60 ? 'text-[#0B2545]' : n >= 35 ? 'text-slate-700' : 'text-slate-400'}`}>{n || '—'}</div>
      </div>
    )
  }

  const Row = ({ k, v, up }) => (
    <div className="flex justify-between items-center border-b border-slate-100 last:border-0 pb-1">
      <dt className="text-slate-400 font-medium">{k}</dt>
      <dd className={`font-bold text-right pl-2 flex items-center gap-1 ${up ? 'text-emerald-600' : 'text-slate-800'}`}>
        {v}{up && <TrendingUp className="w-3 h-3" />}
      </dd>
    </div>
  )

  // ================================================================
  // タブ: レースシナリオ
  // ================================================================
  const TabScenario = () => {
    if (!raceInfo || horses.length === 0) return <EmptyRace />
    const byRole = (role) => horses.filter((h) => h.primaryRole === role)
    const roleGroups = [
      ['妙味軸', '妙味軸候補'], ['2着妙味', '2着妙味'], ['3着穴', '3着穴候補'],
      ['危険人気', '危険人気'], ['初出走注意', '初出走・経験浅'],
    ]
    return (
      <div className="space-y-6 pb-16">
        {/* シナリオ概要 */}
        <div className="bg-white border border-slate-200/80 rounded-2xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Pill className={(PRIORITY_STYLES[raceInfo.racePriority] || PRIORITY_STYLES.C).cls}>{(PRIORITY_STYLES[raceInfo.racePriority] || PRIORITY_STYLES.C).label}</Pill>
            <span className="text-xs font-bold text-slate-500">シナリオ想定</span>
          </div>
          <div className="flex flex-wrap gap-1.5 mb-3">
            {(raceInfo.raceScenarioTags || []).map((t) => <Pill key={t} className={tagStyle(t)}>{t}</Pill>)}
            {(!raceInfo.raceScenarioTags || raceInfo.raceScenarioTags.length === 0) && <span className="text-xs text-slate-400">シナリオタグなし</span>}
          </div>
          <p className="text-sm text-slate-700 leading-relaxed">{raceInfo.raceScenarioComment || '—'}</p>
          {raceInfo.excludeReason && <p className="text-xs text-slate-400 mt-2">※ {raceInfo.excludeReason}</p>}
          {raceInfo.raceType && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
              <Pill className="bg-amber-50 text-amber-700 border-amber-200">{raceInfo.raceType.icon} {raceInfo.raceType.label}</Pill>
              <span className="text-xs text-slate-600">{raceInfo.raceType.detail}</span>
              {raceInfo.raceType.advice && <span className="text-xs text-slate-400 italic">≫ {raceInfo.raceType.advice}</span>}
            </div>
          )}
        </div>

        {/* 役割別 */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {roleGroups.map(([role, title]) => {
            const list = byRole(role)
            return (
              <div key={role} className="bg-white border border-slate-200/80 rounded-2xl shadow-sm overflow-hidden">
                <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                  <span className={`text-sm font-bold ${role === '妙味軸' ? 'text-orange-700' : role === '危険人気' ? 'text-rose-600' : 'text-[#0B2545]'}`}>{title}</span>
                  <span className="text-xs text-slate-400 tabular-nums">{list.length}頭</span>
                </div>
                <div className="divide-y divide-slate-100">
                  {list.length > 0 ? list.map((h) => (
                    <button key={h.id} onClick={() => { setSelectedId(h.id); setTab('analysis') }} className="w-full text-left px-4 py-2.5 hover:bg-slate-50 flex items-center gap-2">
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-mono">{h.no}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">{h.name}</div>
                        <div className="text-[10px] text-slate-500 truncate">{h.classSummary} {h.classRecordSummary || ''} ・ {h.recentStatusSummary}</div>
                      </div>
                      <ChevronRight className="w-4 h-4 text-slate-300" />
                    </button>
                  )) : <div className="px-4 py-3 text-xs text-slate-400">該当馬なし</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const EmptyRace = () => (
    <div className="bg-white border-2 border-dashed border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
      上部の「本日注目レース」または「レース一覧」からレースを選んでください。
    </div>
  )

  // ================================================================
  // タブ: AI の位置づけ
  // ================================================================
  const TabPhilosophy = () => (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 pb-12 items-stretch">
      <div className="bg-gradient-to-br from-[#0B2545] to-[#1a365d] rounded-2xl p-8 text-white shadow-md relative overflow-hidden">
        <Zap className="absolute -right-8 -bottom-8 w-48 h-48 text-white/5" />
        <h2 className="text-2xl font-black mb-4 relative z-10">AIは予想者ではない</h2>
        <p className="text-slate-300 text-sm leading-relaxed mb-8 relative z-10">
          当システムは「当たるAI」を目指していません。買い目は断定せず、当日オッズも取り込みません。
          クラス実績・過去人気・着順・直近状態・調教・騎手相性を整理し、朝の時点で見るべきレースと妙味が出そうな馬を抽出する判断支援コックピットです。
        </p>
        <div className="space-y-4 relative z-10">
          {['能力順は入口。最終判断はクラス・人気履歴・着順で確認', '調教・騎手相性は補正材料', '新馬戦は基本除外、未勝利の初出走は要注意', '当日オッズは別アプリで人間が最終判断'].map((t, i) => (
            <div key={i} className="flex items-center gap-3 bg-white/10 p-3 rounded-lg border border-white/5">
              <CheckCircle2 className="w-5 h-5 text-[#4A90E2] shrink-0" /><span className="font-medium text-sm">{t}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="bg-white rounded-2xl p-8 border border-slate-200/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-800 mb-6 flex items-center gap-2"><Activity className="w-5 h-5 text-[#4A90E2]" /> 拡張機能 (Coming Soon)</h2>
        <div className="grid grid-cols-2 gap-4">
          {['当日オッズ連携', '馬体重変化追跡', '天候連動シミュレート', 'EV(期待値)計算', '買い目(フォーメーション)提案', '当日トラックバイアス補正'].map((t, i) => (
            <div key={i} className="border border-slate-200 rounded-xl p-4 flex flex-col justify-between h-24 bg-slate-50/50">
              <span className="font-bold text-slate-700 text-sm">{t}</span>
              <div className="text-right"><span className="text-[9px] font-black tracking-wider text-slate-400 bg-slate-200 px-2 py-0.5 rounded-sm">SOON</span></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  // ================================================================
  // ヘッダ・レース概要・タブナビ
  // ================================================================
  const GlobalHeader = () => (
    <header className="sticky top-0 z-50 bg-white border-b border-slate-200 shadow-sm px-8 py-3 flex justify-between items-center">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#0B2545] to-[#4A90E2] flex items-center justify-center"><Target className="w-5 h-5 text-white" /></div>
        <div><h1 className="text-lg font-bold text-[#0B2545] leading-tight">Race Condition Analyzer</h1><p className="text-[10px] font-medium text-slate-500 tracking-wider">PROTOTYPE v0.2</p></div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input type="text" placeholder="馬名・騎手で検索..." className="pl-9 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-full text-sm w-56 focus:outline-none focus:ring-2 focus:ring-[#4A90E2]/30"
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <button onClick={() => setTab('today')} className="text-sm font-medium text-slate-600 px-4 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50">本日のレース</button>
        <button onClick={refreshDb} title="race.db を Supabase から再取得" className="text-xs font-medium text-slate-500 px-3 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50">DB再取得</button>
        <button onClick={onLogout} title="ログアウト" className="text-xs font-medium text-slate-500 px-3 py-1.5 border border-slate-200 rounded-full hover:bg-slate-50 flex items-center gap-1"><LogOut className="w-3 h-3" /> {session.user?.email?.split('@')[0]}</button>
      </div>
    </header>
  )

  const KpiCard = ({ icon: Icon, label, value, role }) => (
    <button onClick={() => { setRoleFilter(role); setTab('analysis') }}
      className="bg-white border border-slate-200/80 rounded-xl px-4 py-3 shadow-sm text-left hover:border-[#4A90E2]/50 transition-all min-w-[120px]">
      <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-500"><Icon className="w-3.5 h-3.5" /> {label}</div>
      <div className="text-2xl font-black tabular-nums text-[#0B2545] mt-1">{value ?? 0}</div>
      <div className="text-[10px] text-[#4A90E2] font-bold mt-0.5">該当馬を見る →</div>
    </button>
  )

  const RaceInfoHeader = () => {
    if (!raceInfo) return null
    return (
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm mb-6">
        <div className="flex justify-between items-start gap-4 flex-wrap">
          <div className="space-y-2">
            <div className="text-sm font-bold text-[#4A90E2] tracking-wide tabular-nums">{fmtDate(raceInfo.raceDate)}</div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="w-8 h-8 rounded bg-[#0B2545] text-white flex items-center justify-center font-black tabular-nums">{raceInfo.raceNo}</span>
              <h2 className="text-2xl font-black text-slate-900">{raceInfo.name || '—'}</h2>
              {raceInfo.grade && <Pill className="bg-rose-50 text-rose-700 border-rose-200">{raceInfo.classLabel}</Pill>}
            </div>
            <div className="flex items-center gap-2 text-sm font-medium text-slate-600 flex-wrap">
              <span>{raceInfo.course}</span><span className="text-slate-300">•</span>
              <span>{raceInfo.distance}</span>{raceInfo.lr && <><span className="text-slate-300">•</span><span>{raceInfo.lr}</span></>}
              <span className="text-slate-300">•</span><span>{raceInfo.weather} ・ {raceInfo.going}</span>
              <span className="text-slate-300">•</span><span>{raceInfo.fieldSize}頭</span>
            </div>
          </div>
          <div className="flex gap-2 flex-wrap">
            <KpiCard icon={Star} label="注目馬" value={summary.notable} role="value" />
            <KpiCard icon={Flame} label="妙味軸候補" value={summary.valueAxis} role="value" />
            <KpiCard icon={Layers2} label="2着妙味" value={summary.secondValue} role="second" />
            <KpiCard icon={AlertTriangle} label="注意馬" value={summary.caution} role="all" />
          </div>
        </div>
        {/* シナリオバッジ */}
        <div className="mt-4 pt-3 border-t border-slate-100 flex items-center gap-2 flex-wrap">
          <Pill className={(PRIORITY_STYLES[raceInfo.racePriority] || PRIORITY_STYLES.C).cls}>{(PRIORITY_STYLES[raceInfo.racePriority] || PRIORITY_STYLES.C).label}</Pill>
          {(raceInfo.raceScenarioTags || []).map((t) => <Pill key={t} className={tagStyle(t)}>{t}</Pill>)}
          <span className="text-xs text-slate-500 ml-1">{raceInfo.raceScenarioComment}</span>
        </div>
      </div>
    )
  }

  const TabNav = () => {
    const tabs = [
      { id: 'today', label: '本日注目レース', icon: Star },
      { id: 'races', label: 'レース一覧', icon: Layers },
      { id: 'analysis', label: '出走馬分析', icon: Users },
      { id: 'scenario', label: 'レースシナリオ', icon: Flag },
      { id: 'philosophy', label: 'AIの位置づけ', icon: Info },
    ]
    return (
      <div className="flex gap-6 border-b border-slate-200 mb-6 overflow-x-auto">
        {tabs.map((t) => {
          const Icon = t.icon, isActive = tab === t.id
          return (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex items-center gap-2 pb-3 px-1 border-b-2 font-bold transition-colors text-sm whitespace-nowrap ${
                isActive ? 'border-[#0B2545] text-[#0B2545]' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              <Icon className="w-4 h-4" /> {t.label}
            </button>
          )
        })}
      </div>
    )
  }

  const showRaceHeader = (tab === 'analysis' || tab === 'scenario') && raceInfo

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 pb-8"
      style={{ fontFamily: "'Noto Sans JP', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif" }}>
      <GlobalHeader />
      <main className="max-w-[1480px] mx-auto px-8 pt-8">
        {showRaceHeader && <RaceInfoHeader />}
        <TabNav />
        <div>
          {tab === 'today' && <TabToday />}
          {tab === 'races' && <TabRaces />}
          {tab === 'analysis' && <TabAnalysis />}
          {tab === 'scenario' && <TabScenario />}
          {tab === 'philosophy' && <TabPhilosophy />}
        </div>
      </main>
      <footer className="fixed bottom-0 w-full bg-white border-t border-slate-200 px-8 py-2 text-[10px] text-slate-500 flex justify-between items-center z-40 gap-4">
        <div className="truncate">朝の時点で注目レースを選定し、当日オッズは別アプリで最終確認。</div>
        <div className="flex items-center gap-3 shrink-0 tabular-nums text-slate-400">
          <span title="フロントUIバージョン / commit">UI {UI_VERSION} · {COMMIT_HASH}</span>
          {diag && <>
            <span className="text-slate-300">|</span>
            <span title="評価ロジックのバージョン">evaluator {diag.evaluator}</span>
            <span className="text-slate-300">|</span>
            <span title="race.db の最新開催日">DB {diag.latestDate ? fmtDate(diag.latestDate).slice(0, 10) : '—'}</span>
            <span className="text-slate-300">|</span>
            <span title="race_summaries 件数">summaries {diag.summaries}</span>
            <span className="text-slate-300">|</span>
            <span title="ブラウザがrace.dbを取得した日時">
              取得 {dbMeta.fetchedAt ? new Date(dbMeta.fetchedAt).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}{dbMeta.fromCache ? '(cache)' : ''}
            </span>
          </>}
          <span className="text-slate-300">|</span>
          <span className="flex items-center gap-1">
            <span className="relative flex h-2 w-2"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" /><span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" /></span>
            稼働中
          </span>
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
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => subscription.unsubscribe()
  }, [])
  const logout = async () => { await supabase.auth.signOut(); setSession(null) }
  if (loading) return <div className="min-h-screen bg-[#F8FAFC] flex items-center justify-center"><div className="w-10 h-10 border-4 border-[#4A90E2] border-t-transparent rounded-full animate-spin" /></div>
  return session ? <MainApp session={session} onLogout={logout} /> : <LoginPage onLogin={setSession} />
}
