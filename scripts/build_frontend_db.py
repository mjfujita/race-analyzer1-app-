#!/usr/bin/env python3
"""フロント不要テーブルを落とした軽量 race.db.frontend を生成する。

フロントが直接 SQL するのは jrdb_races / race_evaluations / race_summaries のみ。
jrdb_horses / jrdb_results は COUNT(*) 表示用にしか使われないので、
id カラムだけ残したダミー版に置き換える。

実行:
    python3 scripts/build_frontend_db.py               # 全期間
    python3 scripts/build_frontend_db.py --days 28     # 直近28日分のみ（送信サイズ削減）
    python3 scripts/build_frontend_db.py --since 20260901
    bash scripts/update.sh  または node scripts/push_db.js

環境変数 FRONTEND_DB_DAYS / FRONTEND_DB_SINCE でも指定可（引数優先）。
期間で絞っても元の race.db には一切手を付けない（軽量版だけを絞る）。
"""
import argparse
import os
import shutil
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path


SRC = Path(os.environ.get("RACE_DB_PATH", str(Path.home() / "projects/backend/race.db")))
DST = SRC.with_name(SRC.name + ".frontend")


def parse_args():
    ap = argparse.ArgumentParser(description="フロント用軽量 race.db.frontend を生成")
    ap.add_argument("--days", type=int, default=os.environ.get("FRONTEND_DB_DAYS"),
                    help="直近N日分のレースだけを残す")
    ap.add_argument("--since", default=os.environ.get("FRONTEND_DB_SINCE"),
                    help="この日付(YYYYMMDD)以降のレースだけを残す")
    return ap.parse_args()


def main():
    args = parse_args()
    since = None
    if args.since:
        since = str(args.since)
    elif args.days:
        since = (date.today() - timedelta(days=int(args.days))).strftime("%Y%m%d")
    if since is not None and (len(since) != 8 or not since.isdigit()):
        print(f"❌ --since は YYYYMMDD 形式で指定してください: {since}", file=sys.stderr)
        sys.exit(1)

    if not SRC.exists():
        print(f"❌ {SRC} が見つかりません", file=sys.stderr)
        sys.exit(1)

    if DST.exists():
        DST.unlink()
    shutil.copy(SRC, DST)
    print(f"📋 コピー: {SRC} → {DST}")

    c = sqlite3.connect(DST)

    # フロント COUNT 用にカウントだけ確保（削減のためサイズの大きい SED 列を捨てる）
    c.executescript("""
        CREATE TABLE jrdb_results_min (id INTEGER PRIMARY KEY);
        INSERT INTO jrdb_results_min SELECT id FROM jrdb_results;
        DROP TABLE jrdb_results;
        ALTER TABLE jrdb_results_min RENAME TO jrdb_results;

        CREATE TABLE jrdb_horses_min (ketto_id TEXT PRIMARY KEY);
        INSERT INTO jrdb_horses_min SELECT ketto_id FROM jrdb_horses;
        DROP TABLE jrdb_horses;
        ALTER TABLE jrdb_horses_min RENAME TO jrdb_horses;
    """)

    # フロント未参照テーブルを落とす
    keep = {"jrdb_races", "race_evaluations", "race_summaries",
            "jrdb_horses", "jrdb_results", "sqlite_sequence"}
    all_tables = [r[0] for r in c.execute(
        "SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    for t in all_tables:
        if t not in keep:
            c.execute(f"DROP TABLE IF EXISTS {t}")

    # 期間フィルタ（軽量版のみ。元 DB は不変）
    if since is not None:
        before = c.execute("SELECT COUNT(*) FROM jrdb_races").fetchone()[0]
        c.execute("DELETE FROM race_evaluations WHERE race_key IN (SELECT race_key FROM jrdb_races WHERE race_date < ?)", (since,))
        c.execute("DELETE FROM race_summaries WHERE race_date < ?", (since,))
        c.execute("DELETE FROM jrdb_races WHERE race_date < ?", (since,))
        after = c.execute("SELECT COUNT(*) FROM jrdb_races").fetchone()[0]
        print(f"✂️  {since} 以降に絞り込み: {before} → {after} レース")

    c.commit()
    c.execute("VACUUM")
    c.close()

    mb = DST.stat().st_size / 1024 / 1024
    print(f"✅ {DST} 生成完了: {mb:.1f} MB")


if __name__ == "__main__":
    main()
