#!/usr/bin/env bash
# Prepare the next database without altering ~/projects/backend/race.db.
# Add --publish to upload the verified frontend DB to the existing private Storage.
set -euo pipefail
TASK_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
PUBLISH=0
if [[ "${1:-}" == "--publish" ]]; then PUBLISH=1; shift; fi
cd "$TASK_ROOT"
python3 -m collector.prepare "$@" --output "$TASK_ROOT/collector/state/derived"
PREPARED_DB="$TASK_ROOT/collector/state/derived/race.db"
RACE_DB_PATH="$PREPARED_DB" python3 scripts/build_frontend_db.py --days "${FRONTEND_DB_DAYS:-28}"
python3 -m pipeline.run run --source-db "$PREPARED_DB" --inbox "$HOME/Downloads"
if [[ "$PUBLISH" == 1 ]]; then
  RACE_DB_PATH="$PREPARED_DB" node scripts/push_db.js
else
  echo '準備が完了しました。本番へ同期する場合は --publish を付けて実行してください。'
fi
