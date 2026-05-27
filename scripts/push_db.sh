#!/usr/bin/env bash
# race.db を Supabase Storage にアップロードするスクリプト。
# 事前準備:
#   1. .env.local に下記を設定（Supabase ダッシュボード > Project Settings > API）
#        SUPABASE_PROJECT_URL=https://YOUR_PROJECT.supabase.co
#        SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...     # ← service_role キー（公開禁止）
#        RACE_DB_PATH=/Users/fujitamasaru/projects/backend/race.db
#        RACE_DB_BUCKET=race-db
#        RACE_DB_OBJECT=race.db
#   2. Supabase Storage に bucket を作成（プライベート）
#
# 使い方:
#   cd ~/projects/race-analyzer-app
#   bash scripts/push_db.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env.local"

if [ ! -f "$ENV_FILE" ]; then
  echo "❌ .env.local が見つかりません: $ENV_FILE" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${SUPABASE_PROJECT_URL:?SUPABASE_PROJECT_URL が未設定}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY が未設定}"
: "${RACE_DB_PATH:?RACE_DB_PATH が未設定}"

RACE_DB_BUCKET="${RACE_DB_BUCKET:-race-db}"
RACE_DB_OBJECT="${RACE_DB_OBJECT:-race.db}"

if [ ! -f "$RACE_DB_PATH" ]; then
  echo "❌ race.db が見つかりません: $RACE_DB_PATH" >&2
  exit 1
fi

SIZE_BYTES=$(stat -f%z "$RACE_DB_PATH" 2>/dev/null || stat -c%s "$RACE_DB_PATH")
SIZE_MB=$(awk "BEGIN { printf \"%.1f\", $SIZE_BYTES/1024/1024 }")

echo "📤 アップロード開始"
echo "   from: $RACE_DB_PATH ($SIZE_MB MB)"
echo "   to:   $SUPABASE_PROJECT_URL / $RACE_DB_BUCKET / $RACE_DB_OBJECT"

UPLOAD_URL="$SUPABASE_PROJECT_URL/storage/v1/object/$RACE_DB_BUCKET/$RACE_DB_OBJECT"

HTTP_CODE=$(curl -sS -o /tmp/push_db_resp.txt -w "%{http_code}" \
  -X PUT "$UPLOAD_URL" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "x-upsert: true" \
  -H "Content-Type: application/octet-stream" \
  --data-binary "@$RACE_DB_PATH")

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
  echo "✅ アップロード成功 (HTTP $HTTP_CODE)"
  cat /tmp/push_db_resp.txt
  echo
else
  echo "❌ アップロード失敗 (HTTP $HTTP_CODE)" >&2
  cat /tmp/push_db_resp.txt >&2
  echo >&2
  exit 1
fi
