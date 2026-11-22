import copy
import json
import sqlite3
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from contextlib import closing, redirect_stdout
from io import StringIO
from datetime import date, timedelta
from pathlib import Path

from pipeline.ingest import (append_observations, digest, import_snapshots, open_store,
                             parse_hjc, parse_tyb, read_zip, validate_snapshot)
from pipeline.ledger import import_ledger, payout_suggestions, saved_ledgers, summarize_ledger, validate_ledger
from pipeline.train import load_complete_races, open_source, split_races, train_conditions, train_model
from pipeline.run import input_zips, main


def hjc_fixture():
    data = bytearray(b' ' * 442)
    data[:8] = b'05261101'
    data[8:17] = b'01    250'
    data[35:44] = b'01    120'
    data[44:53] = b'02    160'
    data[53:62] = b'03    210'
    data[80:89] = b'12    330'
    data[107:119] = b'0102     780'
    data[143:155] = b'0102     380'
    data[227:239] = b'0102    1210'
    data[299:313] = b'010203    2100'
    data[341:356] = b'010203123456789'
    return bytes(data)


def tyb_fixture():
    data = bytearray(b' ' * 126)
    data[:10] = b'0526110101'
    data[10:15] = b' 65.0'
    data[30:35] = b'  2.5'
    data[47:48] = b'0'
    data[53:65] = '仮の騎手'.encode('cp932').ljust(12, b' ')
    data[72:78] = b'   8.0'
    data[78:84] = b'   2.1'
    data[84:88] = b'1510'
    data[88:91] = b'480'
    data[91:94] = b'+ 4'
    data[99:103] = b'1520'
    return bytes(data)


def snapshot_fixture():
    return {'schemaVersion': 2, 'id': 'snap1', 'raceId': '05261101', 'raceDate': '20261115',
            'kind': 'observed', 'time': '15:10', 'observedAt': '2026-11-15T15:10:00+09:00',
            'sourcePublishedAt': '2026-11-15T15:10:00+09:00', 'retrievedAt': '2026-11-15T15:10:20+09:00',
            'source': 'synthetic-test', 'odds': {'1': 2.5, '2': 4.0}, 'revisionOf': None}


def ledger_fixture():
    snapshot = snapshot_fixture()
    return {'schemaVersion': 1, 'scope': {'userId': 'synthetic-user', 'raceId': '05261101', 'raceDate': '20261115'},
            'forecasts': [{'id': 'f1', 'createdAt': '2026-11-15T15:10:30+09:00', 'kind': 'ace', 'mode': 'live',
                           'cutoffAt': '2026-11-15T15:11:00+09:00', 'inputs': snapshot, 'parentId': None,
                           'modelVersion': 'synthetic', 'parameters': {'budget': 1000, 'profile': 'balanced',
                                                                    'oddsFactor': .9, 'minHit': 0, 'anchor': None},
                           'field': [{'no': 1, 'probability': .6}, {'no': 2, 'probability': .4}],
                           'allocations': [], 'metrics': {'invested': 0, 'unspent': 1000, 'expectedPayout': 0,
                                                         'expectedProfit': 0, 'maxLoss': 0, 'hitProbability': None,
                                                         'profitProbability': None, 'lossProbability': None,
                                                         'allMissProbability': None, 'expectedReturn': None}}],
            'purchases': [{'id': 'p1', 'createdAt': '2026-11-15T15:12:00+09:00', 'forecastId': 'f1',
                           'tickets': [{'key': '単勝:1', 'type': '単勝', 'numbers': [1], 'stake': 200}], 'replacesId': None}],
            'settlements': [{'id': 's1', 'createdAt': '2026-11-15T15:30:00+09:00', 'purchaseId': 'p1',
                             'payouts': {'単勝:1': 250}, 'replacesId': None}]}


def make_source(path):
    c = sqlite3.connect(path)
    c.executescript('''
      CREATE TABLE jrdb_races(race_key TEXT PRIMARY KEY,race_date TEXT,field_size INTEGER,post_time TEXT,place_code TEXT,surface_code TEXT,distance INTEGER);
      CREATE TABLE jrdb_entries(race_key TEXT,horse_no INTEGER,ketto_id TEXT,idm REAL);
      CREATE TABLE jrdb_results(race_key TEXT,race_date TEXT,horse_no INTEGER,ketto_id TEXT,rank INTEGER,win_odds REAL,field_size INTEGER,surface_code TEXT,distance INTEGER);
    ''')
    for day in range(24):
        d = (date(2025, 1, 1) + timedelta(days=day)).strftime('%Y%m%d')
        for r in range(4):
            key = f'r{day:03d}{r}'
            c.execute('INSERT INTO jrdb_races VALUES(?,?,?,?,?,?,?)', (key, d, 5, '1500', 'r0', '1', 1600))
            winner = (day + r) % 5
            order = [winner] + [n for n in range(5) if n != winner]
            for n in range(5):
                horse_id = f'h{n}'
                c.execute('INSERT INTO jrdb_entries VALUES(?,?,?,?)', (key, n+1, horse_id, 60-n*3))
                c.execute('INSERT INTO jrdb_results VALUES(?,?,?,?,?,?,?,?,?)', (key, d, n+1, horse_id, order.index(n)+1, 3.0+n, 5, '1', 1600))
    c.commit()
    c.close()


class ParsingTests(unittest.TestCase):
    def test_hjc_all_eight_bet_types_and_nine_digit_trifecta(self):
        record = parse_hjc(hjc_fixture(), '20261115')
        self.assertEqual(len({p['type'] for p in record['payouts']}), 8)
        self.assertEqual(record['payouts'][-1]['per100'], 123456789)
        self.assertIsNone(record['refunds'])

    def test_tyb_byte_offsets_with_multibyte_name(self):
        record = parse_tyb(tyb_fixture(), '20261115')
        self.assertEqual(record['horseWeightDelta'], 4)
        self.assertEqual(record['winOdds'], 8)
        self.assertEqual(record['oddsObservedAt'], '2026-11-15T15:10:00+09:00')
        self.assertIsNone(record['sourcePublishedAt'])

    def test_malformed_or_wrong_year_is_rejected(self):
        with self.assertRaises(ValueError):
            parse_hjc(hjc_fixture()[:-1], '20261115')
        with self.assertRaises(ValueError):
            parse_tyb(tyb_fixture(), '20251115')

    def test_zip_transaction_and_idempotent_import(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'input.zip'
            with zipfile.ZipFile(path, 'w') as z:
                z.writestr('HJC261115.txt', hjc_fixture()+b'\r\n')
                z.writestr('TYB261115.txt', tyb_fixture()+b'\r\n')
            items = read_zip(path)
            with closing(open_store(Path(folder)/'derived.sqlite')) as c:
                self.assertEqual(append_observations(c, items), 2)
                self.assertEqual(append_observations(c, items), 0)

    def test_inbox_duplicate_downloads_no_recursive_or_symlink_reads(self):
        with tempfile.TemporaryDirectory() as folder:
            inbox = Path(folder)/'inbox'
            inbox.mkdir()
            for name in ['TYB261115.zip', 'TYB261115 (1).zip']:
                with zipfile.ZipFile(inbox/name, 'w') as z:
                    z.writestr('TYB261115.txt', tyb_fixture()+b'\r\n')
            (inbox/'PACI261115.zip').write_bytes(b'not read')
            (inbox/'nested').mkdir()
            (inbox/'nested'/'HJC261115.zip').write_bytes(b'not read')
            (inbox/'HJC261115-link.zip').symlink_to(inbox/'PACI261115.zip')
            paths = input_zips([str(inbox/'TYB261115.zip')], str(inbox))
            self.assertEqual(len(paths), 2)
            with redirect_stdout(StringIO()):
                result = main(['import-zip', '--inbox', str(inbox), '--zip', str(inbox/'TYB261115.zip'),
                               '--output', str(Path(folder)/'output')])
            self.assertEqual(result, 0)
            report = json.loads((Path(folder)/'output/report.latest.json').read_text())
            self.assertEqual(report['imports']['zipRecords'], 1)
            self.assertEqual(report['imports']['zipFiles'], 2)
            with redirect_stdout(StringIO()):
                main(['import-zip', '--inbox', str(inbox), '--output', str(Path(folder)/'output')])
            report = json.loads((Path(folder)/'output/report.latest.json').read_text())
            self.assertEqual(report['imports']['zipRecords'], 0)


class SnapshotTests(unittest.TestCase):
    def test_full_field_required(self):
        validate_snapshot(snapshot_fixture(), [1, 2])
        with self.assertRaises(ValueError):
            validate_snapshot(snapshot_fixture(), [1, 2, 3])

    def test_future_timestamp_and_nan_rejected(self):
        s = snapshot_fixture()
        s['sourcePublishedAt'] = '2026-11-15T15:12:00+09:00'
        with self.assertRaises(ValueError):
            validate_snapshot(s, [1, 2])
        s = snapshot_fixture()
        s['odds']['1'] = float('nan')
        with self.assertRaises(ValueError):
            validate_snapshot(s, [1, 2])

    def test_invalid_batch_is_atomic(self):
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
            s = snapshot_fixture()
            bad = copy.deepcopy(s)
            bad['odds'].pop('2')
            with self.assertRaises(ValueError):
                import_snapshots(c, [s, bad], {'05261101': [1, 2]})
            self.assertEqual(c.execute('SELECT COUNT(*) FROM observations').fetchone()[0], 0)

    def test_snapshot_id_cannot_be_reused_for_changed_odds(self):
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
            snapshot = snapshot_fixture()
            import_snapshots(c, [snapshot], {'05261101': [1, 2]})
            snapshot['odds']['1'] = 3.0
            with self.assertRaises(ValueError):
                import_snapshots(c, [snapshot], {'05261101': [1, 2]})


class LedgerTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'Node optional for browser schema roundtrip')
    def test_single_axis_place_value_and_skip_cross_language_roundtrip(self):
        ledger = ledger_fixture()
        record = ledger['forecasts'][0]
        record['field'] = [{'no': n, 'probability': .2} for n in range(1, 6)]
        record['parameters'].update(budget=0)
        record['metrics']['unspent'] = 0
        record['inputs'].update(winOdds={str(n): 2 for n in range(1, 6)}, releaseFieldSize=5,
                                quotes=[{'type': '複勝', 'numbers': [1], 'odds': 3, 'upper': 5}])
        record['inputs']['quoteObservedAt'] = record['inputs']['observedAt']
        record['inputs']['quoteRetrievedAt'] = record['inputs']['retrievedAt']
        record['inputs']['anchorTrendReference'] = {
            **snapshot_fixture(), 'id': 'older-observation', 'time': '15:00',
            'observedAt': '2026-11-15T15:00:00+09:00', 'retrievedAt': '2026-11-15T15:00:20+09:00',
            'sourcePublishedAt': '2026-11-15T15:00:00+09:00', 'odds': {str(n): 3 for n in range(1, 6)}}
        ledger['purchases'], ledger['settlements'] = [], []
        script = """
import {assessAnchorCandidates,SINGLE_ANCHOR_METHOD} from './src/anchorAssessment.js';
import {validateLedger} from './src/forecastLedger.js';
let s='';for await(const c of process.stdin)s+=c;const l=JSON.parse(s),r=l.forecasts[0];
const a=assessAnchorCandidates({field:r.field,odds:r.inputs.winOdds,placeQuotes:r.inputs.quotes});
r.parameters.anchorSelection={method:SINGLE_ANCHOR_METHOD,minTop3:.5,suggested:a.suggested,selected:null,decision:'pending'};
for(const [decision,selected] of [['selected',1],['skip',null]])l.forecasts.push({...r,id:decision,kind:'user',parentId:r.id,
parameters:{...r.parameters,anchorSelection:{...r.parameters.anchorSelection,decision,selected}}});
validateLedger(l,l.scope);process.stdout.write(JSON.stringify(l));
"""
        result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(ledger), text=True,
                                cwd=Path(__file__).resolve().parents[1], capture_output=True, check=True)
        ledger = json.loads(result.stdout)
        self.assertEqual(ledger['forecasts'][0]['parameters']['anchorSelection']['suggested'], [1])
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as connection:
            self.assertEqual(import_ledger(connection, ledger), 1)
            self.assertEqual(saved_ledgers(connection)[0]['forecasts'][1]['parameters']['anchorSelection']['selected'], 1)
        for overrides in ({'suggested': [1, 2]}, {'selected': [1, 2]}, {'selected': 2}, {'minTop3': 1.5}):
            wrong = copy.deepcopy(ledger)
            wrong['forecasts'][1]['parameters']['anchorSelection'].update(overrides)
            with self.assertRaises(ValueError):
                validate_ledger(wrong)
        wrong = copy.deepcopy(ledger)
        wrong['forecasts'][0]['inputs']['anchorTrendReference']['retrievedAt'] = '2026-11-15T15:20:00+09:00'
        with self.assertRaises(ValueError):
            validate_ledger(wrong)

    @unittest.skipUnless(shutil.which('node'), 'Node optional for browser schema roundtrip')
    def test_two_anchor_choice_roundtrip_and_invalid_duplicate(self):
        ledger = ledger_fixture()
        record = ledger['forecasts'][0]
        record['parameters'].update(budget=0, anchorSelection={
            'method': 'win-value-two-v1', 'suggested': [1, 2], 'selected': [1, 2]})
        record['metrics']['unspent'] = 0
        record['inputs']['winOdds'] = {'1': 2.5, '2': 4.0}
        ledger['purchases'], ledger['settlements'] = [], []
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as connection:
            self.assertEqual(import_ledger(connection, ledger), 1)
            restored = saved_ledgers(connection)[0]
            script = "import {validateLedger} from './src/forecastLedger.js';let s='';for await(const chunk of process.stdin)s+=chunk;const l=JSON.parse(s);validateLedger(l,l.scope);process.stdout.write('ok');"
            result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(restored), text=True,
                                    cwd=Path(__file__).resolve().parents[1], capture_output=True, check=True)
            self.assertEqual(result.stdout, 'ok')
            self.assertEqual(restored['forecasts'][0]['parameters']['anchorSelection']['selected'], [1, 2])
            record['parameters']['anchorSelection']['selected'] = [1, 1]
            with self.assertRaises(ValueError):
                validate_ledger(ledger)

    @unittest.skipUnless(shutil.which('node'), 'Node optional for browser schema roundtrip')
    def test_browser_ledger_roundtrip(self):
        ledger = ledger_fixture()
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
            import_ledger(c, ledger)
            restored = saved_ledgers(c)[0]
            script = "import {validateLedger} from './src/forecastLedger.js';let s='';for await(const chunk of process.stdin)s+=chunk;const l=JSON.parse(s);validateLedger(l,l.scope);process.stdout.write('ok');"
            result = subprocess.run(['node', '--input-type=module', '-e', script], input=json.dumps(restored), text=True,
                                    cwd=Path(__file__).resolve().parents[1], capture_output=True, check=True)
            self.assertEqual(result.stdout, 'ok')

    def test_replay_unknown_times_preserved_but_live_requires_them(self):
        ledger = ledger_fixture()
        ledger['forecasts'][0]['inputs']['sourcePublishedAt'] = None
        with self.assertRaises(ValueError):
            validate_ledger(ledger)
        ledger['forecasts'][0]['mode'] = 'replay'
        validate_ledger(ledger)

    def test_proposal_not_purchase_and_refund_accounting(self):
        ledger = ledger_fixture()
        summary = summarize_ledger(ledger)
        self.assertEqual(summary['profit'], 300)
        ledger['settlements'][0]['payouts']['単勝:1'] = 100
        self.assertEqual(summarize_ledger(ledger)['profit'], 0)
        ledger['purchases'], ledger['settlements'] = [], []
        self.assertIsNone(summarize_ledger(ledger)['returnRate'])

    def test_append_corrections_and_reject_mutation(self):
        ledger = ledger_fixture()
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
            self.assertEqual(import_ledger(c, ledger), 1)
            self.assertEqual(import_ledger(c, ledger), 0)
            edited = copy.deepcopy(ledger)
            edited['settlements'][0]['payouts']['単勝:1'] = 0
            with self.assertRaises(ValueError):
                import_ledger(c, edited)
            correction = copy.deepcopy(edited['settlements'][0])
            correction.update(id='s2', replacesId='s1', createdAt='2026-11-15T15:40:00+09:00')
            ledger['settlements'].append(correction)
            self.assertEqual(import_ledger(c, ledger), 1)
            self.assertEqual(summarize_ledger(ledger)['profit'], -200)

    def test_hjc_is_suggestion_not_automatic_refund(self):
        with tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
            record = parse_hjc(hjc_fixture(), '20261115')
            append_observations(c, [('HJC', record, digest(record), 'synthetic')])
            suggestions = payout_suggestions(c, ledger_fixture())
            self.assertEqual(suggestions['purchases'][0]['payouts']['単勝:1'], 250)
            self.assertTrue(suggestions['purchases'][0]['confirmationRequired'])

    def test_corrections_require_prior_records_and_cannot_branch(self):
        for group in ('purchases', 'settlements'):
            for failure in ('self', 'forward', 'branch', 'cross-scope'):
                with self.subTest(group=group, failure=failure):
                    ledger = ledger_fixture()
                    original = ledger[group][0]
                    correction = copy.deepcopy(original)
                    correction.update(id='correction', replacesId=original['id'])
                    if failure == 'self':
                        original['replacesId'] = original['id']
                    elif failure == 'forward':
                        ledger[group] = [correction, original]
                    elif failure == 'branch':
                        branch = copy.deepcopy(correction)
                        branch['id'] = 'branch'
                        ledger[group].extend([correction, branch])
                    else:
                        if group == 'purchases':
                            forecast = copy.deepcopy(ledger['forecasts'][0])
                            forecast['id'] = 'f2'
                            ledger['forecasts'].append(forecast)
                            correction['forecastId'] = 'f2'
                        else:
                            purchase = copy.deepcopy(ledger['purchases'][0])
                            purchase['id'] = 'p2'
                            ledger['purchases'].append(purchase)
                            correction['purchaseId'] = 'p2'
                        ledger[group].append(correction)
                    with self.assertRaises(ValueError):
                        validate_ledger(ledger)

    def test_sequential_corrections_count_only_active_purchase_and_settlement(self):
        ledger = ledger_fixture()
        for ident, previous, stake in [('p2', 'p1', 300), ('p3', 'p2', 400)]:
            purchase = copy.deepcopy(ledger['purchases'][0])
            purchase.update(id=ident, replacesId=previous)
            purchase['tickets'][0]['stake'] = stake
            ledger['purchases'].append(purchase)
        settlement = copy.deepcopy(ledger['settlements'][0])
        settlement.update(id='s2', purchaseId='p3')
        correction = copy.deepcopy(settlement)
        correction.update(id='s3', replacesId='s2', payouts={'単勝:1': 100})
        ledger['settlements'].extend([settlement, correction])
        summary = summarize_ledger(ledger)
        self.assertEqual(summary['purchaseStake'], 400)
        self.assertEqual(summary['settledPurchases'], 1)
        self.assertEqual(summary['returned'], 400)
        self.assertEqual(summary['profit'], 0)

    def test_duplicate_initial_settlement_requires_explicit_correction(self):
        ledger = ledger_fixture()
        duplicate = copy.deepcopy(ledger['settlements'][0])
        duplicate['id'] = 's2'
        ledger['settlements'].append(duplicate)
        with self.assertRaises(ValueError):
            validate_ledger(ledger)

    def test_import_rejects_cross_file_correction_branches_atomically(self):
        for group in ('purchases', 'settlements'):
            with self.subTest(group=group), tempfile.TemporaryDirectory() as folder, closing(open_store(Path(folder)/'derived.sqlite')) as c:
                original = ledger_fixture()
                first, second = copy.deepcopy(original), copy.deepcopy(original)
                for ledger, ident in [(first, 'correction1'), (second, 'correction2')]:
                    correction = copy.deepcopy(ledger[group][0])
                    correction.update(id=ident, replacesId=correction['id'])
                    ledger[group].append(correction)
                    validate_ledger(ledger)  # Each document is valid by itself.
                self.assertEqual(import_ledger(c, first), 1)
                before = c.execute('SELECT COUNT(*) FROM observations').fetchone()[0]
                with self.assertRaises(ValueError):
                    import_ledger(c, second)
                self.assertFalse(c.in_transaction)
                self.assertEqual(c.execute('SELECT COUNT(*) FROM observations').fetchone()[0], before)
                restored = saved_ledgers(c)[0]
                self.assertEqual([record['id'] for record in restored[group]], [original[group][0]['id'], 'correction1'])
                self.assertEqual(import_ledger(c, original), 1)
                self.assertEqual(saved_ledgers(c), [restored])

    def test_frame_tickets_require_official_existing_frames_and_two_horses_for_same_frame(self):
        for target in ('allocations', 'tickets'):
            for frames, numbers, valid in [([None, 2], [1, 2], False),
                                            ([True, 2], [1, 2], False),
                                            ([1, 2], [1, 3], False),
                                            ([1, 2], [1, 1], False),
                                            ([1, 2], [1, 2], True),
                                            ([1, 1], [1, 1], True)]:
                with self.subTest(target=target, frames=frames, numbers=numbers):
                    ledger = ledger_fixture()
                    ledger['settlements'] = []
                    for horse, frame in zip(ledger['forecasts'][0]['field'], frames):
                        horse['frameNo'] = frame
                    ticket = {'key': '枠連:' + '-'.join(map(str, numbers)), 'type': '枠連', 'numbers': numbers, 'stake': 100}
                    if target == 'allocations':
                        ledger['forecasts'][0]['allocations'] = [ticket]
                    else:
                        ledger['purchases'][0]['tickets'] = [ticket]
                    if valid:
                        validate_ledger(ledger)
                    else:
                        with self.assertRaises(ValueError):
                            validate_ledger(ledger)


class TrainingTests(unittest.TestCase):
    def test_readonly_full_race_validation_and_chronological_model(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'source.sqlite'
            make_source(path)
            with closing(open_source(path)) as c:
                with self.assertRaises(sqlite3.OperationalError):
                    c.execute('DELETE FROM jrdb_races')
                races, audit = load_complete_races(c)
            self.assertEqual(len(races), 96)
            train, calibration, holdout = split_races(races)
            self.assertLess(train[-1]['date'], calibration[0]['date'])
            self.assertLess(calibration[-1]['date'], holdout[0]['date'])
            model = train_model(races, audit)
            self.assertEqual(model['status'], 'research')
            self.assertFalse(model['marketResearch']['usableForT10'])
            self.assertLess(model['trainedThrough'].replace('-', ''), holdout[0]['date'])
            conditions = train_conditions(races, model)
            self.assertEqual(conditions['featureSchema'], 'race-ability-last5-v1')
            self.assertEqual(conditions['selection']['method'], 'calibration-only')
            self.assertEqual(races[0]['conditionCounts'][0]['history_runs'], 0)
            self.assertEqual(races[4]['conditionCounts'][0]['history_runs'], 4)
            self.assertEqual(races[8]['conditionCounts'][0]['history_runs'], 5)

    def test_missing_result_excludes_entire_race(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'source.sqlite'
            make_source(path)
            with closing(sqlite3.connect(path)) as c, c:
                c.execute("DELETE FROM jrdb_results WHERE race_key='r0000' AND horse_no=5")
            with closing(open_source(path)) as c:
                races, audit = load_complete_races(c)
            self.assertEqual(len(races), 95)
            self.assertEqual(audit['excluded']['incomplete-field'], 1)

    def test_holdout_cannot_select_condition_coefficients(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'source.sqlite'
            make_source(path)
            with closing(open_source(path)) as c:
                races, audit = load_complete_races(c)
            baseline = train_model(races, audit)
            original = train_conditions(races, baseline)
            changed = copy.deepcopy(races)
            holdout_start = split_races(changed)[2][0]['date']
            for race in changed:
                if race['date'] >= holdout_start:
                    race['winner'] = (race['winner'] + 2) % len(race['idms'])
                    race['idms'] = list(reversed(race['idms']))
            altered = train_conditions(changed, baseline)
            self.assertEqual(original['coefficients'], altered['coefficients'])
            self.assertEqual(original['selection'], altered['selection'])

    def test_one_command_exports_model_and_audit(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder)/'source.sqlite'
            make_source(source)
            with redirect_stdout(StringIO()):
                self.assertEqual(main(['run', '--source-db', str(source), '--output', str(Path(folder)/'output')]), 0)
            model = json.loads((Path(folder)/'output/model.latest.json').read_text())
            self.assertEqual(model['modelType'], 'idm-temperature')


if __name__ == '__main__':
    unittest.main()
