#!/usr/bin/env bash
# update.sh — 週次 JRDB 更新ワンライナー
#
# 使い方:
#   bash ~/projects/race-analyzer-app/scripts/update.sh
#
# やること:
#   0. ~/Downloads/PACI260*.zip があれば解凍
#   1. ~/Downloads/PACI260*/ 配下の .txt を ~/projects/backend/jrdb_data/extracted/ にコピー
#   2. JRDB 取込み      (import_jrdb.py)
#   3. 評価プレ計算    (evaluate_all.py)
#   4. Supabase に push (push_db.js)
#
# 全部終わったらブラウザで https://race-analyzer-app.vercel.app/ を開いて
# 右上「DB再取得」ボタンを押すだけ。

set -e

BACKEND=~/projects/backend
FRONTEND=~/projects/race-analyzer-app
EXTRACTED="$BACKEND/jrdb_data/extracted"

echo "🚦 race-analyzer 更新を開始します"

# ---- 0. ZIP を解凍 ------------------------------------------------
shopt -s nullglob
for zip in ~/Downloads/PACI260*.zip; do
  dir="${zip%.zip}"
  if [ ! -d "$dir" ]; then
    echo "📦 解凍: $(basename "$zip")"
    unzip -q "$zip" -d "$dir"
  fi
done
shopt -u nullglob

# ---- 1. .txt を extracted/ にコピー -------------------------------
copied=0
for dir in ~/Downloads/PACI260*/; do
  if [ -d "$dir" ]; then
    for f in "$dir"*.txt; do
      if [ -f "$f" ]; then
        cp "$f" "$EXTRACTED/" 2>/dev/null && copied=$((copied + 1)) || true
      fi
    done
  fi
done
echo "📂 extracted/ にコピー: $copied ファイル (重複は上書き)"

# ---- 2. JRDB 取込み -----------------------------------------------
echo "🏇 JRDB データ取込み中..."
cd "$BACKEND"
./venv/bin/python import_jrdb.py | tail -15

# ---- 3. 評価プレ計算 ----------------------------------------------
echo "📊 評価プレ計算中 (増分のみ)..."
./venv/bin/python evaluate_all.py | tail -10

# ---- 3.5 フロント軽量DB を再生成 (Supabase 50MB/ファイル上限対策) --
# race.db は生JRDBテーブルで肥大化する。フロントが使う
# jrdb_races / race_evaluations / race_summaries だけに絞った軽量版を作り、
# それを push する（これを省くとフル DB を push して 50MB 超で失敗する）。
echo "🪶 フロント軽量DB を再生成中..."
cd "$FRONTEND"
RACE_DB_PATH="$BACKEND/race.db" python3 scripts/build_frontend_db.py | tail -3

# ---- 4. Supabase に push ------------------------------------------
echo "📤 Supabase Storage にアップロード中..."
cd "$FRONTEND"
node scripts/push_db.js

echo ""
echo "🎉 全部完了!"
echo "   ブラウザで右上「DB再取得」を押すと最新データに切り替わります:"
echo "   👉 https://race-analyzer-app.vercel.app/"
