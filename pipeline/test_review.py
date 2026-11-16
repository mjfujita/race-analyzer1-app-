from datetime import datetime, timedelta, timezone
import tempfile
from pathlib import Path
from unittest import TestCase
from zipfile import ZipFile

from .ingest import append_observations, digest, open_store, read_zip
from .ledger import import_ledger
from .review import collect, eligible_training, import_receipts, race_outcome, run_review, update_stack
from .test_pipeline import ledger_fixture

UTC = timezone.utc
START = datetime(2026, 1, 1, 6, 20, tzinfo=UTC)
STACK = '["synthetic-v1",null,[],null]'


def sample_rows(days, bad_from=999):
    return [{'date': (START + timedelta(days=day)).strftime('%Y%m%d'), 'cutoff': START + timedelta(days=day),
             'available': START + timedelta(days=day, hours=1), 'stack': STACK, 'id': f'{day}/{race}',
             'raceKey': f'{day}/{race}', 'fingerprint': f'{day}/{race}',
             'p': [.8, .2], 'winner': 0 if day >= bad_from else race % 2}
            for day in days for race in range(4)]


def event(kind, payload, at):
    return {'kind': kind, 'retrievedAt': at.isoformat(), 'payload': payload}


def results(ranks=(1, 2), abnormal='0'):
    return {'records': [{'horseNo': i, 'rank': rank, 'fieldSize': len(ranks), 'abnormalCode': abnormal}
                        for i, rank in enumerate(ranks, 1)]}


def payout(*winners):
    return {'payouts': [{'type': '単勝', 'numbers': [winner], 'per100': 240} for winner in winners]}


class ReviewTests(TestCase):
    def test_fixed_width_zip_and_result_corrections(self):
        key, day = b'08260111', b'20260101'
        def records(length):
            lines = []
            for n in (1, 2):
                row = bytearray(b' ' * length)
                row[:10] = key + f'{n:02d}'.encode()
                row[18:26] = day
                row[130:132] = b'02'
                row[140:143] = f'{n:02d}0'.encode()
                lines.append(bytes(row))
            return b'\r\n'.join(lines) + b'\r\n'
        with tempfile.TemporaryDirectory() as temp:
            archive = Path(temp) / 'result.zip'
            with ZipFile(archive, 'w') as zip_file:
                zip_file.writestr('nested/SEC260101.txt', records(344))
                zip_file.writestr('SED260101.txt', records(374))
            loaded = read_zip(archive)
        self.assertEqual([row[0] for row in loaded], ['SEC', 'SED'])
        post = START + timedelta(minutes=10)
        first, second = post + timedelta(hours=1), post + timedelta(hours=2)
        events = [event(loaded[0][0], loaded[0][1], first), event('HJC', payout(1), first)]
        self.assertEqual(race_outcome(events, [1, 2], post, second), ('matched', [[1, 1], [2, 2]], first, 'SEC'))
        conflicting = events + [event('SED', results((2, 1)), second)]
        self.assertEqual(race_outcome(conflicting, [1, 2], post, second)[0], 'result-conflict')
        self.assertEqual(race_outcome(events, [1, 2], post, first - timedelta(seconds=1))[0], 'awaiting-results')
        self.assertEqual(race_outcome(events, [1, 3], post, second)[0], 'incomplete-or-abnormal')
        self.assertEqual(race_outcome([event('SED', results(abnormal='1'), first)], [1, 2], post, second)[0], 'incomplete-or-abnormal')
        multiple = [events[0], event('HJC', payout(1, 2), first)]
        self.assertEqual(race_outcome(multiple, [1, 2], post, second)[0], 'result-conflict')

    def test_only_first_receipted_original_is_eligible_and_result_retrieval_is_not_backdated(self):
        doc = ledger_fixture()
        scope = doc['scope']
        race = scope['raceId']
        day = scope['raceDate']
        first = doc['forecasts'][0]
        created = datetime.strptime(day, '%Y%m%d').replace(hour=6, minute=20, tzinfo=UTC)
        cutoff, result_time = created + timedelta(minutes=10), created + timedelta(hours=2)
        first.update(mode='live', createdAt=created.isoformat(), cutoffAt=cutoff.isoformat())
        first['inputs'].update(probabilityStack=STACK, sourceId='synthetic-odds', sourcePublishedAt=created.isoformat(),
                               observedAt=created.isoformat(), retrievedAt=created.isoformat())
        first['field'] = [{'no': 1, 'pStar': .8, 'probability': .8}, {'no': 2, 'pStar': .2, 'probability': .2}]
        doc['purchases'], doc['settlements'] = [], []
        receipt = {'schemaVersion': 1, 'ownerId': scope['userId'], 'raceId': race, 'raceDate': day,
                   'forecastId': first['id'], 'cutoffAt': cutoff.isoformat(), 'receivedAt': created.isoformat(), 'sourceId': 'synthetic-odds'}
        labelled = [event('SED', {**results(), 'raceId': race, 'raceDate': day}, result_time),
                    event('HJC', {**payout(1), 'raceId': race, 'raceDate': day}, result_time)]
        self.assertEqual(len(collect([doc], labelled, result_time)[1]), 0)
        with tempfile.TemporaryDirectory() as temp:
            with open_store(Path(temp) / 'review.sqlite') as store:
                import_ledger(store, doc)
                self.assertEqual(import_receipts(store, doc, [receipt]), 1)
                self.assertEqual(import_receipts(store, doc, [receipt]), 0)
                with self.assertRaises(ValueError):
                    import_receipts(store, doc, [{**receipt, 'receivedAt': result_time.isoformat()}])
                append_observations(store, [(e['kind'], e['payload'], digest(e['payload']), 'fixture') for e in labelled], result_time.isoformat())
                report = run_review(store, result_time.isoformat())
        self.assertEqual(report['eligibleRaces'], 1)
        self.assertEqual(report['states'], {'matched': 1})
        self.assertEqual(report['actual']['topPickRate'], 1)
        attested = [*labelled, event('FORECAST_RECEIPT', receipt, result_time)]
        display, samples, _ = collect([doc], attested, result_time)
        self.assertEqual(display[0]['winnerNo'], 1)
        self.assertEqual(samples[0]['available'], result_time)
        self.assertEqual(eligible_training(samples, [{'date': '20991231', 'cutoff': result_time}]), [])

    def test_walk_forward_gate_and_stop_on_later_regression_or_correction(self):
        training = sample_rows(range(15))
        activation = (START + timedelta(days=15)).isoformat()
        state, version = update_stack({}, training, activation)
        self.assertEqual(version['decision'], 'adopted')
        self.assertLess(version['evaluation']['after']['logLoss'], version['evaluation']['before']['logLoss'])
        self.assertLess(version['evaluation']['after']['brier'], version['evaluation']['before']['brier'])
        self.assertTrue(version['walkForward']['folds'])
        self.assertEqual(version['trainedThrough'], '20260110')
        self.assertEqual(version['testedThrough'], '20260115')
        self.assertIsNone(update_stack(state, training, activation)[1])
        for day in version['walkForward']['folds']:
            self.assertLess(day['date'], '20260111')
        adverse = sample_rows(range(16, 19), bad_from=16)
        after = (START + timedelta(days=20)).isoformat()
        paused, challenger = update_stack(state, training + adverse, after)
        self.assertIsNone(paused['active'])
        self.assertEqual(paused['status'], 'paused-degradation')
        self.assertIsNone(challenger)
        corrected = [{**training[0], 'fingerprint': 'correction'}, *training[1:]]
        self.assertEqual(update_stack(state, corrected, after)[0]['status'], 'paused-correction')

    def test_holdout_does_not_select_temperature_and_consumed_gate_cannot_be_reused(self):
        rows = sample_rows(range(15), bad_from=10)
        timestamp = (START + timedelta(days=15)).isoformat()
        rejected, version = update_stack({}, rows, timestamp)
        self.assertEqual(version['temperature'], 2)
        self.assertEqual(version['decision'], 'rejected')
        self.assertIsNone(rejected.get('active'))
        favourable = sample_rows(range(15))
        self.assertIsNone(update_stack(rejected, favourable, timestamp)[1])
