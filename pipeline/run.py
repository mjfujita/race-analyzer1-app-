"""Usage: python3 -m pipeline.run run --source-db /path/race.db"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
import zipfile
from contextlib import closing
from pathlib import Path

from .ingest import append_observations, digest, export_store, import_snapshots, now_iso, open_store, read_zip
from .ledger import import_ledger, payout_suggestions, saved_ledgers, summarize_ledger
from .train import load_complete_races, open_source, train_conditions, train_model
from .prediction import train_runtime_models


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n')
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def read_json(path):
    path = Path(path)
    if path.stat().st_size > 50_000_000:
        raise ValueError('JSON input exceeds 50 MB')
    return json.loads(path.read_text(), parse_constant=lambda value: (_ for _ in ()).throw(ValueError(f'Invalid JSON number {value}')))


def default_source():
    return str(Path.home() / 'projects/backend/race.db')


def input_zips(explicit, inbox=None):
    """Only the named directory, no recursion or followed inbox symlinks."""
    paths = [Path(value).expanduser() for value in explicit]
    if inbox:
        directory = Path(inbox).expanduser()
        if directory.is_symlink() or not directory.is_dir():
            raise ValueError('Inbox must be an existing non-symlink directory')
        for path in sorted(directory.iterdir()):
            if (not path.is_symlink() and path.is_file()
                    and re.fullmatch(r'(?:TYB|HJC)\d{6}[^/]*\.zip', path.name, re.I)):
                paths.append(path)
    unique = list(dict.fromkeys(path.resolve(strict=True) for path in paths))
    if len(unique) > 1000:
        raise ValueError('At most 1000 ZIP files can be processed in one run')
    return unique


def main(argv=None):
    parser = argparse.ArgumentParser(description='Local JRDB append-only data and research pipeline (no production writes)')
    parser.add_argument('action', choices=['run', 'audit', 'train', 'import-zip', 'import-snapshots', 'import-ledger', 'export'])
    parser.add_argument('--source-db', default=default_source())
    parser.add_argument('--output', default=str(Path(__file__).parent / 'output'))
    parser.add_argument('--zip', action='append', default=[])
    parser.add_argument('--inbox', help='Scan this directory only for dated TYB/HJC ZIP files (no recursive or symlink traversal)')
    parser.add_argument('--snapshots', action='append', default=[])
    parser.add_argument('--manifest', help='JSON object mapping raceId to official active horse numbers')
    parser.add_argument('--ledger', action='append', default=[])
    args = parser.parse_args(argv)
    output = Path(args.output).expanduser().resolve()
    source = Path(args.source_db).expanduser().resolve()
    store_path = output / 'market.sqlite'
    if source == store_path:
        parser.error('Source and derived database must differ')
    if args.action == 'import-zip' and not args.zip and not args.inbox:
        parser.error('import-zip requires --zip or --inbox')
    if args.action == 'import-snapshots' and not args.snapshots:
        parser.error('import-snapshots requires --snapshots')
    if args.action == 'import-ledger' and not args.ledger:
        parser.error('import-ledger requires --ledger')
    try:
        output.mkdir(parents=True, exist_ok=True)
        report = {'schemaVersion': 1, 'generatedAt': now_iso(), 'mode': 'local-research', 'imports': {}}
        # All ZIP parsing is validated before any archive records are committed.
        items = []
        zip_paths = input_zips(args.zip, args.inbox)
        report['imports']['zipFiles'] = len(zip_paths)
        for zip_path in zip_paths:
            items.extend(read_zip(zip_path))
        with closing(open_store(store_path)) as store:
            os.chmod(store_path, 0o600)
            report['imports']['zipRecords'] = append_observations(store, items)
            fields = read_json(args.manifest) if args.manifest else {}
            if args.snapshots and not fields:
                with closing(open_source(source)) as connection:
                    sizes = {row['race_key']: row['field_size'] for row in connection.execute('SELECT race_key,field_size FROM jrdb_races')}
                    for row in connection.execute('SELECT race_key,horse_no FROM jrdb_entries'):
                        fields.setdefault(row['race_key'], []).append(row['horse_no'])
                fields = {k: v for k, v in fields.items() if len(v) == len(set(v)) and len(v) == sizes.get(k)}
            report['imports']['snapshots'] = sum(import_snapshots(store, read_json(p), fields) for p in args.snapshots)
            ledgers = [read_json(p) for p in args.ledger]
            report['imports']['ledgers'] = sum(import_ledger(store, ledger) for ledger in ledgers)
            ledgers = saved_ledgers(store)
            report['ledgerSummaries'] = [summarize_ledger(ledger) for ledger in ledgers]
            if ledgers:
                write_json(output / 'payout-suggestions.json', {'schemaVersion': 1,
                           'ledgers': [payout_suggestions(store, ledger) for ledger in ledgers]})
            if args.action in ('run', 'audit', 'train'):
                with closing(open_source(source)) as connection:
                    races, audit = load_complete_races(connection)
                report['audit'] = audit
                write_json(output / 'audit.json', audit)
                if args.action in ('run', 'train'):
                    model = train_model(races, audit)
                    experiment = output / 'experiments' / f"{model['id']}.json"
                    if not experiment.exists():
                        write_json(experiment, model)
                    write_json(output / 'model.latest.json', model)
                    conditions = train_conditions(races, model)
                    condition_experiment = output / 'experiments' / f"{conditions['id']}.json"
                    if not condition_experiment.exists():
                        write_json(condition_experiment, conditions)
                    write_json(output / 'model.conditions.json', conditions)
                    # Keep the forward baseline fixed as observations accumulate.
                    # A newly trained ability challenger must not erase the earlier T-10 evaluation window.
                    runtime_base_path = output / 'model.runtime-base.json'
                    if not runtime_base_path.exists():
                        write_json(runtime_base_path, conditions)
                    runtime_base = read_json(runtime_base_path)
                    with closing(open_source(source)) as runtime_source:
                        runtime = train_runtime_models(runtime_source, export_store(store), runtime_base)
                    write_json(output / 'model.runtime.json', runtime)
                    runtime_experiment = output / 'experiments' / f"{runtime['id']}.json"
                    if not runtime_experiment.exists():
                        write_json(runtime_experiment, runtime)
                    report['runtimeModels'] = {name: runtime[name]['status'] for name in ('contextModel', 'marketModel', 'closingOddsModel')}
                    report['model'] = {'id': model['id'], 'temperature': model['temperature'],
                                       'trainedThrough': model['trainedThrough'], 'status': model['status'],
                                       'holdoutRaces': model['validation']['periods']['holdout']['races']}
                    report['conditionModel'] = {'id': conditions['id'], 'selection': conditions['selection'],
                                               'coefficients': conditions['coefficients']}
            if args.action in ('run', 'export'):
                write_json(output / 'observations.json', export_store(store))
                for ledger in ledgers:
                    write_json(output / 'ledgers' / f"{digest(ledger['scope'])[:16]}.json", ledger)
        write_json(output / 'report.latest.json', report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, OSError, sqlite3.Error, zipfile.BadZipFile, TypeError, KeyError, RecursionError) as exc:
        print(f'Pipeline failed: {exc}', file=sys.stderr)
        return 1

if __name__ == '__main__':
    raise SystemExit(main())
