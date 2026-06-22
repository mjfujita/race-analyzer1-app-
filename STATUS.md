# race-analyzer-app — 現状ステータス

> 最終更新: 2026-06-22（v0.2 改修: 朝の判断支援コックピット化）
> 本番URL: https://race-analyzer-app.vercel.app/

## v0.2 改修サマリー（2026-06-22）

能力順中心の閲覧アプリから、「クラス実績 × 過去人気 × 着順」で妙味を探す判断支援コックピットへ再設計。

**タブ構成**: 本日注目レース / レース一覧 / 出走馬分析 / レースシナリオ / AIの位置づけ（初期=本日注目レース）

- **本日注目レース**: 日付サマリーカード（注目/人気落ち実力馬/未勝利・初出走/地方馬）、まず見るべきレース（優先度A/B/C/D＋シナリオ）、会場別一覧（分類バッジ＋理由＋優先度強調）、フィルタ、今日の見方カード
- **出走馬分析**: レース概要＋KPI（注目馬/妙味軸/2着妙味/注意馬・クリックで絞込）、シナリオバッジ、出走馬一覧の列を「クラス実績/人気履歴/直近/役割」中心へ刷新、馬詳細パネル（AI状況コメント・クラス×人気×着順カード・今回補正カード・高配当シナリオカード・直近5走＋判定ラベル）
- **レースシナリオ**: 優先度・シナリオタグ・コメント・レース意味分類・役割別の馬グルーピング
- **能力順は初期ソートとして維持**。◎○△×フィルタ・本気度/一致度/フェーズソート・全体評価タブはサブ化（削除）。

**評価ロジック（backend）**: `enrich.py` 新設でルールベース生成。payload に役割タグ・クラス実績(2-1-1-3)・人気履歴・AI状況コメント・調教/陣営/騎手相性補正・高配当シナリオ・地方馬/未勝利初出走の扱いを追加。レース単位で優先度A/B/C/D・シナリオタグ・各種件数を付与。`race_summaries` 軽量テーブルで本日一覧を高速描画。`evaluator_version=v2.0`。今回騎手は KYI 再取込（`jrdb_entries.jockey_name`）で有効化。当日オッズは取得せず、人気は過去人気＋IDM順位からの仮説として扱う。

## 概要

藤田さん個人専用の競馬データ閲覧Webアプリ。バックエンドサーバなしの SPA で、Supabase Storage から `race.db` を取得し、ブラウザの sql.js で直接読んで表示する。データ生成は `~/projects/backend` の Python パイプラインが担当。

## 構成

| 項目 | 内容 |
|---|---|
| フロント | React 19 + Vite + Tailwind v4 |
| 認証 | Supabase Auth（メール/パスワード、Auto Confirm） |
| データ配信 | Supabase Storage バケット `race-db` の `race.db` |
| クライアントDB | sql.js（ブラウザ）+ Cache API で永続化 |
| ホスティング | Vercel（GitHub プライベートリポジトリから自動デプロイ） |
| アイコン | lucide-react |

## 完成している機能

### 認証・データ読込み
- [x] Supabase メール/パスワードログイン
- [x] `race.db` を Storage から DL、進捗バー表示
- [x] Cache API で永続キャッシュ → 2回目以降は高速起動
- [x] ヘッダの「DB再取得」で強制リフレッシュ
- [x] Supabase の公開設定をコードに埋め込み済み（Vercel側に環境変数設定不要）

### タブ1: JRDB実データ
- [x] DB 統計表示（レース総数 / 登録馬数 / 過去走レコード / 対象期間）
- [x] 開催日セレクタ（直近60日）
- [x] 開催場ごとにレース一覧（グレード / レース名 / 距離 / 頭数 / 発走時刻）
- [x] レースクリックで評価データロード → 一覧タブへ遷移

### タブ2: 一覧 & 詳細
- [x] 出走馬一覧テーブル（馬番 / 馬名 / 騎手 / 能力ランク / 本気度 / 一致度 / 評価記号）
- [x] フィルタ（全て / ◎ / ○ / △ / ×）
- [x] ソート（評価 / 馬番 / 能力 / 一致度 / フェーズ / 本気度）
- [x] 馬名・騎手検索
- [x] バッジ表示
  - フェーズ判定（上昇 / 安定 / 条件再設定 / ムラ / 下降 / 休養明け / 経験浅）
  - 昇級判定 / クラス挑戦 / 賞金追走
  - 王冠（4指標1位の集約バッジ）
  - レース内1位タグ（能力 / 本気 / 追切 / 終い）
- [x] 詳細ペイン：AI短評、勝つ条件 / 負ける条件、過去走テーブル
- [x] 過去走の SED フル項目（タイム、上り3F、人気、馬体重±、騎手）
- [x] 上り3F の閾値カラーリング（≤33.5 / ≤34.5 / ≤36.0 / それ以上）
- [x] 左右ペインのドラッグリサイザー（localStorage で保存、ダブルクリックでリセット）

### タブ3: 全体評価
- [x] 評価別（◎/○/△/×）カウントと上位3頭
- [x] 能力上位馬 Top3
- [x] 条件一致度上位馬 Top3
- [x] リスク馬（能力高・一致度低）リスト

### タブ4: AIの位置づけ
- [x] システム哲学の表示（AIは予想者ではない / 4原則）
- [x] 拡張機能の Coming Soon 一覧

## 未完成・進行中

なし（現状リリース済みフェーズの実装は完了）

## ロードマップ（Coming Soon）

- [ ] 当日オッズ連携
- [ ] 馬体重変化追跡
- [ ] 天候連動シミュレート
- [ ] EV（期待値）計算
- [ ] 買い目（フォーメーション）提案
- [ ] 当日トラックバイアス補正

## 運用

```bash
# 週次データ更新
cd ~/projects/backend && ./venv/bin/python import_jrdb.py
cd ~/projects/backend && ./venv/bin/python evaluate_all.py    # 評価プレ計算
cd ~/projects/race-analyzer-app && bash scripts/push_db.sh   # Storage に PUT
# ブラウザ右上「DB再取得」で反映
```

## 直近のコミット履歴

```
8d5513a add draggable resizer to adjust horse-list / detail panel widths
334bcd2 improve horse detail panel readability
d6d3618 expand past-runs table with SED full fields (time, last 3F, popularity, weight)
6095987 add update.sh — one-liner weekly JRDB update wrapper
f14cd5c port full local UI (4 tabs, race info header, side detail panel, lucide-react icons)
1ba1617 phase 2: race detail view with badges (precomputed evaluations)
c6618c6 embed supabase public config so vercel deploy needs no env setup
1959217 initial: race-analyzer PWA on Vercel + Supabase
```
