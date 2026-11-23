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

## パドック・返し馬情報

コメントの取得状態、締切後の参考表示、取得ワーカーの配置・復旧については [パドック情報の仕様](docs/paddock-information.md) を参照。

## 画面を改良するときのローカル確認

```sh
npm run dev:review
```

[ローカル確認画面](http://127.0.0.1:5173/market-preview.html?state=groups-local-review) を開くと、グループ内の推定確率を含む確認画面から始まる。架空の8頭・日付を確認できる過去走・時刻付きオッズを使用する。ログインやJRDBの取得用Macは不要で、本番API・本番DBには接続しない。

上のメニューから能力・適性、軸候補、私の予想、オッズ、展開などへ移動できる。操作した内容は、このローカルURL専用のブラウザ領域に保存する。本番の予想・購入記録は変更しない。コードを保存すると画面へ自動反映される。本番への反映は別の工程として扱う。

サーバーを止めた後は同じコマンドで再開する。ポート5173が使用中の場合は、既存サーバーを確認してから起動する（別プロセスを自動停止しない）。スマホ版の表示はPCブラウザのレスポンシブ表示で確認する。このURLは同じMac上でのみ開ける。
