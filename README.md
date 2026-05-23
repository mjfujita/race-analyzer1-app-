# Race Condition Analyzer (Vercel + Supabase 版)

藤田さん個人専用の race-analyzer。  
ローカル PC で取込んだ `race.db` を Supabase Storage に push し、ブラウザ (sql.js) で読む構成。

- バックエンドなし（純クライアントサイド + Supabase Auth + Storage）
- データの真は `~/projects/backend/race.db`（既存の Python パイプラインで更新）
- 取込み後に `scripts/push_db.sh` を 1 発叩けば反映

---

## 藤田さんが最初にやる手順

### ① Supabase プロジェクト作成（5分）

1. https://supabase.com にログイン（個人 GitHub でログイン推奨）
2. 「New project」→ Name: `race-analyzer`、Region: `Northeast Asia (Tokyo)` あたり
3. パスワード（DB password）はランダム生成して 1Password 等に保存
4. プロジェクト作成完了後、左メニュー **Project Settings → API** から以下をコピー
   - Project URL  (例: `https://abcde12345.supabase.co`)
   - `anon` public key (フロントエンド用、ブラウザに出る)
   - `service_role` key (アップロード用、サーバー/CLI 専用、**公開禁止**)

### ② Storage バケット作成 + race.db アップロード

1. 左メニュー **Storage → New bucket**
   - Name: `race-db`
   - Public bucket: **オフのまま**（プライベート）
2. このリポジトリの `.env.example` をコピーして `.env.local` を作る:
   ```
   VITE_SUPABASE_URL=<上記 Project URL>
   VITE_SUPABASE_ANON_KEY=<上記 anon key>
   VITE_RACE_DB_BUCKET=race-db
   VITE_RACE_DB_OBJECT=race.db

   # push_db.sh 用（サーバー専用、公開禁止）
   SUPABASE_PROJECT_URL=<上記 Project URL>
   SUPABASE_SERVICE_ROLE_KEY=<上記 service_role key>
   RACE_DB_PATH=/Users/fujitamasaru/projects/backend/race.db
   ```
3. アップロード:
   ```bash
   bash scripts/push_db.sh
   ```

### ③ Auth でアカウント作成

1. 左メニュー **Authentication → Users → Add user → Create new user**
2. 自分のメールアドレス + 任意パスワードを設定（"Auto Confirm User" を ON）

### ④ ローカル動作確認

```bash
cd ~/projects/race-analyzer-app
npm install
npm run dev
```

`http://localhost:5173/` を開いてログイン → race.db が読み込まれて最新日のレース一覧が表示されればOK。

### ⑤ Vercel デプロイ

1. GitHub にプライベートリポジトリ `race-analyzer-app` を作成
2. このディレクトリを push（`.env.local` は `.gitignore` で除外済み）
3. https://vercel.com で **New Project → Import** からリポジトリを選択
4. **Environment Variables** に `.env.local` のうち `VITE_*` だけを設定:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_RACE_DB_BUCKET` (任意)
   - `VITE_RACE_DB_OBJECT` (任意)
5. Deploy → 数分後に `https://race-analyzer-app.vercel.app/` などで公開

---

## 週次運用

```bash
# 1. JRDB データ取込み（既存）
cd ~/projects/backend && ./venv/bin/python import_jrdb.py

# 2. race.db を Supabase に push
cd ~/projects/race-analyzer-app && bash scripts/push_db.sh

# 3. ブラウザ右上「DB再取得」ボタン or ハードリロードで反映
```

---

## ファイル構成

- `src/App.jsx` — ログイン + ダッシュボード (最小: 最新日レース一覧)
- `src/supabase.js` — Supabase クライアント
- `src/lib/db.js` — sql.js + race.db ローダー（Cache API で永続キャッシュ）
- `scripts/push_db.sh` — ローカル race.db を Supabase Storage に PUT する curl スクリプト
- `vite.config.js` — Vite + React + Tailwind v4 + sql.js 用設定

## ロードマップ

- **Phase 1（現在）**: ログイン + 最新日レース一覧
- **Phase 2**: `evaluate_all.py` で評価結果をプレ計算して race.db に追加、UI で各種バッジ表示
- **Phase 3**: レース詳細、馬一覧、フェーズ/本気度/昇級判定の UI 再現
