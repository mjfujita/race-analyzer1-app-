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

    # 公開用の軽量DBには、能力画面で使う集計値だけを残す。
    c.execute("""
        CREATE TABLE race_ability (
            race_key TEXT NOT NULL, horse_no INTEGER NOT NULL, idm REAL, running_style TEXT,
            distance_runs INTEGER NOT NULL, distance_top3 INTEGER NOT NULL,
            venue_runs INTEGER NOT NULL, venue_top3 INTEGER NOT NULL,
            course_runs INTEGER NOT NULL, course_top3 INTEGER NOT NULL,
            PRIMARY KEY (race_key, horse_no)
        ) WITHOUT ROWID
    """)
    c.execute("""
        WITH entries AS (
            SELECT r.race_key, r.race_date, r.place_code, r.surface_code, r.distance,
                   e.horse_no, e.ketto_id, e.idm, e.running_style
            FROM jrdb_races r
            JOIN race_evaluations v ON v.race_key = r.race_key
            JOIN jrdb_entries e ON e.race_key = r.race_key
            WHERE r.race_date >= ?
        ), recent AS (
            SELECT e.race_key, e.horse_no, p.rank,
                   p.surface_code = e.surface_code AND abs(p.distance - e.distance) <= 200 AS near_distance,
                   p.surface_code = e.surface_code AND substr(p.race_key, 1, 2) = e.place_code AS same_venue,
                   p.surface_code = e.surface_code AND substr(p.race_key, 1, 2) = e.place_code
                       AND p.distance = e.distance AS same_course_distance,
                   row_number() OVER (
                       PARTITION BY e.race_key, e.horse_no
                       ORDER BY p.race_date DESC, p.race_key DESC
                   ) AS seq
            FROM entries e
            JOIN jrdb_results p ON p.ketto_id = e.ketto_id
                 AND p.race_date < e.race_date
                 AND p.rank BETWEEN 1 AND p.field_size
        )
        INSERT INTO race_ability
        SELECT e.race_key, e.horse_no, CASE WHEN e.idm > 0 THEN e.idm END, e.running_style,
               coalesce(sum(p.near_distance), 0), coalesce(sum(p.near_distance AND p.rank <= 3), 0),
               coalesce(sum(p.same_venue), 0), coalesce(sum(p.same_venue AND p.rank <= 3), 0),
               coalesce(sum(p.same_course_distance), 0), coalesce(sum(p.same_course_distance AND p.rank <= 3), 0)
        FROM entries e
        LEFT JOIN recent p ON p.race_key = e.race_key AND p.horse_no = e.horse_no AND p.seq <= 5
        GROUP BY e.race_key, e.horse_no, e.idm, e.running_style
    """, (since or "",))

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
            "jrdb_horses", "jrdb_results", "race_ability", "sqlite_sequence"}
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
