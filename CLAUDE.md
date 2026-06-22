# Race Analyzer App（フロントエンド） - プロジェクトガイド

> このファイルは Claude Code 用のプロジェクト指示書です。
> **最新の実装状況は必ず [STATUS.md](./STATUS.md) を参照すること**（このファイルは思想・規約・ドメイン定義などの安定情報を担う）。

## プロジェクト概要

**プロダクト名**: Race Condition Analyzer
**目的**: 前日までの情報で構造化指標を提供し、当日のオッズ・パドックは人間判断
**利用範囲**: 個人利用のみ（JRDB規約遵守）

## システム全体構成（2フォルダ構成）

このプロダクトは2つのフォルダに分かれている。役割を混同しないこと。

| フォルダ | 役割 | 技術 |
|---|---|---|
| `~/projects/race-analyzer-app`（このフォルダ） | フロントエンドSPA・表示 | React 19 + Vite + Tailwind v4 + Supabase + sql.js |
| `~/projects/backend` | JRDBデータ取込み・評価ロジック・`race.db`生成 | Python（SQLAlchemy / SQLite） |

データの流れ:
```
backend（Python）でJRDB取込み＆評価プレ計算 → race.db 生成
  → Supabase Storage バケット race-db に PUT
    → race-analyzer-app がブラウザで race.db を sql.js で直接読んで表示
```

**バックエンドサーバは常駐しない。** フロントは Supabase Storage から `race.db` を取得し、ブラウザ内（sql.js + Cache API）で完結する SPA。

## このフォルダ（フロント）の要点

- 認証: Supabase Auth（メール/パスワード）
- データ: Supabase Storage `race-db` の `race.db` を取得、Cache API で永続キャッシュ
- ホスティング: Vercel（GitHubプライベートリポジトリから自動デプロイ）
- 本番URL: https://race-analyzer-app.vercel.app/
- 主要ファイル: `src/App.jsx`（メインUI）, `src/lib/db.js`（sql.js読込）, `src/supabase.js`
- 機能の詳細（4タブ構成・バッジ・フィルタ等）は [STATUS.md](./STATUS.md) を見ること

```bash
# 開発起動
cd ~/projects/race-analyzer-app && npm run dev
```

## ドメイン定義（フロント・バックエンド共通の言葉）

### 馬フェーズ判定（6+分類）
- 🔼 上昇 / ➡️ 安定 / 🔀 条件再設定 / 🔄 ムラ / 🔽 下降 / 🛌 休養明け / 🆕 経験浅

### レース意味分類
- 🛌 休養明け多発 / 🔼 上昇馬選別 / ➡️ 滞留馬決着 / 🔀 条件替わり検証 / 🌪 荒れ吸収

### 本気度判定
- 仕上がり万全 / 標準的に良好 / 普通 / 物足りず

### 評価記号
- ◎ / ○ / △ / ×（能力スコア・条件一致度から算出。算出ロジックは backend `main.py::compute_race_evaluation`）

> 判定ロジックの実体は `~/projects/backend` 側にある。フロントは backend が `race.db` に書いた結果を表示するだけ。

## ユーザー情報

- 藤田将（株式会社MJ代表）
- WEBシステム開発（保育・教育ICT）が本業 / 競馬は個人の楽しみ
- 思考特性: 本質志向、時間効率重視、構造重視

## システムの哲学（AIの位置づけ）

- AIは予想者ではない。前日までの構造化指標を提供する役。
- 当日朝のオッズ・直前情報・パドックは人間が統合判断する。

## JRDB規約の制約

- 個人利用OK（藤田個人のPCで本人のID/パスワード）
- 商用利用NG（MJ社事業に組み込み不可）/ アカウント共有NG / 再配布NG

## 開発スタイル

- 個人利用なので制限最小限 / 完璧設計より試行錯誤 / 時間優先 / 作って修正

## 関連

- バックエンド: `~/projects/backend`（`STATUS.md` あり）
