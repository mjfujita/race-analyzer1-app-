"""Validated append-only observations. No original database writes or network I/O.

Fixed-width offsets verified against official JRDB HJC 4a and TYB 4b specs.
https://www.jrdb.com/program/Hjc/hjcdata_doc.txt
https://jrdb.com/program/Tyb/tyb_doc.txt
"""
from __future__ import annotations

import hashlib
import json
import math
import re
import sqlite3
import zipfile
from contextlib import nullcontext
from datetime import datetime, timezone, timedelta
from pathlib import Path

JST = timezone(timedelta(hours=9))
MAX_BYTES = 50_000_000
TYPES = {'単勝': 1, '複勝': 1, '枠連': 2, '馬連': 2, 'ワイド': 2, '馬単': 2, '3連複': 3, '3連単': 3}


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    raw = value if isinstance(value, bytes) else canonical(value).encode()
    return hashlib.sha256(raw).hexdigest()


def iso(value):
    if not isinstance(value, str):
        raise ValueError('Timezone-aware ISO timestamp is required')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None:
        raise ValueError('Timezone-aware ISO timestamp is required')
    return result


def race_date(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d{8}', value):
        raise ValueError('raceDate must be YYYYMMDD')
    return datetime.strptime(value, '%Y%m%d').strftime('%Y%m%d')


def field_number(raw, integer=False):
    text = raw.decode('ascii').strip()
    if not text:
        return None
    text = re.sub(r'^([+-])\s+', r'\1', text)
    if not re.fullmatch(r'[+-]?\d+(?:\.\d+)?', text):
        raise ValueError('Malformed fixed-width numeric field')
    value = float(text)
    if not math.isfinite(value) or (integer and value != int(value)):
        raise ValueError('Invalid numeric value')
    return int(value) if integer else value


def race_key(raw):
    text = raw.decode('ascii')
    if not re.fullmatch(r'\d{5}[0-9a-fA-F]\d{2}', text):
        raise ValueError('Invalid JRDB race key')
    if not 1 <= int(text[-2:]) <= 12:
        raise ValueError('Invalid race number')
    return text


def ticket_key(bet_type, numbers):
    if bet_type not in TYPES or len(numbers) != TYPES[bet_type]:
        raise ValueError('Invalid bet type or selection count')
    upper = 8 if bet_type == '枠連' else 18
    if any(type(n) is not int or not 1 <= n <= upper for n in numbers):
        raise ValueError('Invalid horse/frame number')
    if bet_type != '枠連' and len(set(numbers)) != len(numbers):
        raise ValueError('Duplicate horse number')
    if bet_type not in ('馬単', '3連単'):
        numbers = sorted(numbers)
    return f"{bet_type}:{'-'.join(map(str, numbers))}"


def parse_hjc(line, date):
    """Parse the 442 payload bytes (444 including CRLF). No refund field exists."""
    if len(line) != 442:
        raise ValueError(f'HJC requires 442 payload bytes, got {len(line)}')
    key = race_key(line[:8])
    if key[2:4] != date[2:4]:
        raise ValueError('HJC race year and filename date differ')
    groups = [('単勝', 8, 3, 2, 7), ('複勝', 35, 5, 2, 7),
              ('枠連', 80, 3, 2, 7), ('馬連', 107, 3, 4, 8),
              ('ワイド', 143, 7, 4, 8), ('馬単', 227, 6, 4, 8),
              ('3連複', 299, 3, 6, 8), ('3連単', 341, 6, 6, 9)]
    payouts = []
    seen = set()
    for bet_type, offset, count, selection_len, payout_len in groups:
        width = selection_len + payout_len
        for n in range(count):
            chunk = line[offset + n * width:offset + (n + 1) * width]
            selection = chunk[:selection_len].decode('ascii').strip()
            payout = field_number(chunk[selection_len:], integer=True)
            if not selection or set(selection) <= {'0'}:
                if payout not in (None, 0):
                    raise ValueError('Payout amount without selection')
                continue
            if not selection.isdigit() or len(selection) != selection_len:
                raise ValueError('Malformed payout selection')
            step = 1 if bet_type == '枠連' else 2
            picks = [int(selection[i:i + step]) for i in range(0, selection_len, step)]
            canonical_key = ticket_key(bet_type, picks)
            if canonical_key in seen or payout is None or payout <= 0:
                raise ValueError('Duplicate or missing payout')
            seen.add(canonical_key)
            payouts.append({'key': canonical_key, 'type': bet_type, 'numbers': picks, 'per100': payout})
    return {'raceId': key, 'raceDate': date, 'format': 'HJC-4a', 'payouts': payouts,
            'status': 'published' if any(p['type'] == '単勝' for p in payouts) else 'pending',
            'refunds': None, 'refundStatus': 'not-provided-by-HJC'}


def parse_tyb(line, date):
    if len(line) != 126:
        raise ValueError(f'TYB requires 126 payload bytes, got {len(line)}')
    key = race_key(line[:8])
    if key[2:4] != date[2:4]:
        raise ValueError('TYB race year and filename date differ')
    horse = field_number(line[8:10], True)
    if horse is None or not 1 <= horse <= 18:
        raise ValueError('Invalid TYB horse number')
    fields = {'idm': (10, 15), 'jockeyIndex': (15, 20), 'informationIndex': (20, 25),
              'oddsIndex': (25, 30), 'paddockIndex': (30, 35), 'totalIndex': (40, 45),
              'winOdds': (72, 78), 'placeOddsLower': (78, 84)}
    result = {name: field_number(line[a:b]) for name, (a, b) in fields.items()}
    for name in ('winOdds', 'placeOddsLower'):
        if result[name] is not None and result[name] < 0:
            raise ValueError('Negative odds')
        if result[name] == 0:
            result[name] = None
    observed_time = line[84:88].decode('ascii').strip()
    post_time = line[99:103].decode('ascii').strip()
    observed_at = None
    for t in (observed_time, post_time):
        if t and (not re.fullmatch(r'\d{4}', t) or int(t[:2]) > 23 or int(t[2:]) > 59):
            raise ValueError('Invalid TYB clock')
    if observed_time:
        observed_at = datetime.strptime(date + observed_time, '%Y%m%d%H%M').replace(tzinfo=JST).isoformat()
    result.update({'raceId': key, 'raceDate': date, 'horseNo': horse, 'format': 'TYB-4b',
                   'cancelFlag': line[47:48].decode('ascii').strip(),
                   'goingCode': line[69:71].decode('ascii').strip(),
                   'weatherCode': line[71:72].decode('ascii').strip(),
                   'horseWeight': field_number(line[88:91], True),
                   'horseWeightDelta': field_number(line[91:94], True),
                   'bodyCode': line[97:98].decode('ascii').strip(),
                   'conditionCode': line[98:99].decode('ascii').strip(),
                   'oddsObservedAt': observed_at, 'postTime': post_time or None,
                   'sourcePublishedAt': None, 'timingStatus': 'publication-time-unverified'})
    return result


def read_zip(path):
    """Read in memory, never extract paths from untrusted archives."""
    output = []
    with zipfile.ZipFile(path) as archive:
        members = archive.infolist()
        if sum(m.file_size for m in members) > MAX_BYTES or len(members) > 1000:
            raise ValueError('Archive exceeds size limit')
        for member in members:
            name = Path(member.filename).name
            match = re.fullmatch(r'(TYB|HJC)(\d{6})\.txt', name, re.I)
            if not match:
                continue
            if member.file_size > MAX_BYTES or member.file_size / max(1, member.compress_size) > 500:
                raise ValueError('Archive expansion ratio exceeds limit')
            kind, suffix = match.groups()
            date = race_date('20' + suffix)
            data = archive.read(member)
            parser = parse_hjc if kind.upper() == 'HJC' else parse_tyb
            for index, line in enumerate(data.splitlines(), 1):
                if not line.strip():
                    continue
                try:
                    payload = parser(line, date)
                except (ValueError, UnicodeError) as exc:
                    raise ValueError(f'{name}: line {index}: {exc}') from exc
                output.append((kind.upper(), payload, digest(line), name))
    if not output:
        raise ValueError('No supported TYB/HJC dated file found in ZIP')
    return output


def open_store(path):
    path = Path(path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.execute('PRAGMA foreign_keys=ON')
    connection.executescript('''
      CREATE TABLE IF NOT EXISTS observations (
        event_id TEXT PRIMARY KEY, kind TEXT NOT NULL, race_id TEXT NOT NULL,
        race_date TEXT NOT NULL, horse_no INTEGER, source_time TEXT,
        retrieved_at TEXT NOT NULL, source_hash TEXT NOT NULL,
        payload TEXT NOT NULL, source_name TEXT,
        UNIQUE(kind, race_id, horse_no, source_hash)
      );
      CREATE INDEX IF NOT EXISTS ix_observation_race ON observations(race_id, retrieved_at);
    ''')
    return connection


def append_observations(connection, items, retrieved_at=None, *, manage_transaction=True):
    retrieved_at = retrieved_at or now_iso()
    iso(retrieved_at)
    count = 0
    with connection if manage_transaction else nullcontext():
        for kind, payload, source_hash, source_name in items:
            event_id = digest([kind, payload['raceId'], payload.get('horseNo'), source_hash])
            cursor = connection.execute('''INSERT OR IGNORE INTO observations
              (event_id,kind,race_id,race_date,horse_no,source_time,retrieved_at,source_hash,payload,source_name)
              VALUES(?,?,?,?,?,?,?,?,?,?)''', (event_id, kind, payload['raceId'], payload['raceDate'],
              payload.get('horseNo'), payload.get('sourcePublishedAt') or payload.get('oddsObservedAt'),
              retrieved_at, source_hash, canonical(payload), source_name))
            count += cursor.rowcount
    return count


def validate_snapshot(snapshot, expected_numbers):
    if not isinstance(snapshot, dict) or snapshot.get('schemaVersion') != 2:
        raise ValueError('Snapshot schemaVersion must be 2')
    if not isinstance(snapshot.get('raceId'), str) or not snapshot['raceId']:
        raise ValueError('Missing raceId')
    if not isinstance(snapshot.get('id'), str) or not snapshot['id']:
        raise ValueError('Missing immutable snapshot id')
    race_date(snapshot.get('raceDate'))
    if snapshot.get('kind') not in ('observed', 'baseline'):
        raise ValueError('Invalid snapshot kind')
    observed = iso(snapshot.get('observedAt'))
    retrieved = iso(snapshot.get('retrievedAt'))
    visible = snapshot.get('timingEvidence') == 'observed-visible-at' and snapshot.get('availabilityAt') == snapshot.get('retrievedAt')
    published = iso(snapshot['sourcePublishedAt']) if snapshot.get('sourcePublishedAt') is not None else None
    if published is None and not visible:
        raise ValueError('Publication time or verified visible-at evidence is required')
    if (published is not None and published > observed) or observed > retrieved:
        raise ValueError('Observation/publication cannot follow retrieval')
    if snapshot.get('kind') == 'observed' and observed.astimezone(JST).strftime('%Y%m%d') != snapshot['raceDate']:
        raise ValueError('Observation date and race date differ')
    if observed.astimezone(JST).strftime('%H:%M') != snapshot.get('time'):
        raise ValueError('Clock and observedAt differ')
    if not isinstance(expected_numbers, list):
        raise ValueError('Expected horse numbers must be an array')
    expected = set(expected_numbers)
    if len(expected) != len(expected_numbers) or len(expected) < 2 or any(type(n) is not int or not 1 <= n <= 18 for n in expected):
        raise ValueError('Official expected horse numbers are required')
    odds = snapshot.get('odds')
    if not isinstance(odds, dict) or set(odds) != set(map(str, expected)):
        raise ValueError('Odds must contain exactly the official active field')
    if any(type(v) not in (int, float) or not math.isfinite(v) or v < 1 for v in odds.values()):
        raise ValueError('Invalid odds')
    return json.loads(canonical(snapshot))


def import_snapshots(connection, document, fields):
    snapshots = document if isinstance(document, list) else document.get('snapshots') if isinstance(document, dict) else None
    if not isinstance(snapshots, list) or len(snapshots) > 10000:
        raise ValueError('snapshots array required (maximum 10000)')
    items = []
    known = {}
    for row in connection.execute("SELECT payload FROM observations WHERE kind='ODDS'"):
        old = json.loads(row[0])
        known[(old['raceId'], old['id'])] = canonical(old)
    for snapshot in snapshots:
        expected = fields.get(snapshot.get('raceId')) if isinstance(snapshot, dict) else None
        payload = validate_snapshot(snapshot, expected or [])
        key = (payload['raceId'], payload['id'])
        if key in known and known[key] != canonical(payload):
            raise ValueError('Immutable snapshot id was reused with different data')
        if payload.get('revisionOf') and (payload['raceId'], payload['revisionOf']) not in known:
            raise ValueError('Snapshot revision must refer to an existing earlier snapshot')
        known[key] = canonical(payload)
        items.append(('ODDS', payload, digest(payload), 'snapshot-json'))
    return append_observations(connection, items)


def export_store(connection):
    connection.row_factory = sqlite3.Row
    observations = []
    for row in connection.execute('SELECT * FROM observations ORDER BY retrieved_at,event_id'):
        observations.append({'eventId': row['event_id'], 'kind': row['kind'],
                             'retrievedAt': row['retrieved_at'], 'sourceHash': row['source_hash'],
                             'payload': json.loads(row['payload'])})
    return {'schemaVersion': 1, 'kind': 'race-market-observations', 'exportedAt': now_iso(),
            'observations': observations}
