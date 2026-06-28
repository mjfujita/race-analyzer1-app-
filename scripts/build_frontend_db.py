#!/usr/bin/env python3
"""フロント不要テーブルを落とした軽量 race.db.frontend を生成する。

フロントが直接 SQL するのは jrdb_races / race_evaluations / race_summaries のみ。
jrdb_horses / jrdb_results は COUNT(*) 表示用にしか使われないので、
id カラムだけ残したダミー版に置き換える。

実行:
    python3 scripts/build_frontend_db.py
    bash scripts/update.sh  または node scripts/push_db.js
"""
import os
import shutil
import sqlite3
import sys
from pathlib import Path


SRC = Path(os.environ.get("RACE_DB_PATH", str(Path.home() / "projects/backend/race.db")))
DST = SRC.with_name(SRC.name + ".frontend")


def main():
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

    c.commit()
    c.execute("VACUUM")
    c.close()

    mb = DST.stat().st_size / 1024 / 1024
    print(f"✅ {DST} 生成完了: {mb:.1f} MB")


if __name__ == "__main__":
    main()
