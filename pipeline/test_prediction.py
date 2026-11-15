import copy
import json
import math
import tempfile
import sqlite3
import unittest
from contextlib import closing
from datetime import date, timedelta
from pathlib import Path

from pipeline.prediction import (FEATURES, available_at, context_features, train_prediction_models,
                                 training_rows, price_features, train_runtime_models)
from pipeline.train import open_source
from pipeline.ingest import iso
from pipeline.test_pipeline import make_source

BASE = {'id': 'synthetic-base', 'modelType': 'idm-temperature', 'temperature': 8, 'trainedThrough': '2024-01-01'}


def rows_fixture():
    rows = []
    for day in range(30):
        d = (date(2025, 1, 1) + timedelta(days=day)).strftime('%Y%m%d')
        for r in range(4):
            odds = [3., 4., 5., 6.]
            context = [{**dict.fromkeys(FEATURES), 'paddock': float(1 if i == 0 else -1), 'paceFit': .2 * (i - 1)} for i in range(4)]
            xs = [[1, math.log(o), .05 * (i + r - 1), 1, 1] for i, o in enumerate(odds)]
            rows.append({'raceId': f'synthetic-{day}-{r}', 'date': d, 'winner': 0 if r < 3 else (day % 3) + 1,
                         'baseProbability': [.25] * 4, 'decisionOdds': odds, 'context': context, 'priceFeatures': xs,
                         'closingOdds': [o * math.exp(.15 * x[2] - .05 * x[1]) for o, x in zip(odds, xs)]})
    return rows


class PredictionTests(unittest.TestCase):
    def test_future_and_unknown_timing_never_create_training_features(self):
        cutoff = iso('2025-01-01T14:50:00+09:00')
        source = {'retrievedAt': '2025-01-01T14:40:00+09:00', 'availabilityAt': '2025-01-01T14:40:00+09:00', 'timingEvidence': 'observed-visible-at'}
        self.assertTrue(available_at(source, cutoff))
        self.assertFalse(available_at({**source, 'timingEvidence': 'zip-import'}, cutoff))
        self.assertFalse(available_at({**source, 'retrievedAt': '2025-01-01T15:10:00+09:00'}, cutoff))

    def test_historical_odds_are_labels_not_fabricated_t10_observations(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.sqlite'
            make_source(source)
            with closing(open_source(source)) as c:
                rows, _ = training_rows(c, {'observations': []}, BASE)
                self.assertEqual(rows, [])
                model = train_runtime_models(c, {'observations': []}, BASE)
            self.assertEqual(model['marketModel']['status'], 'insufficient-data')
            self.assertEqual(model['closingOddsModel']['status'], 'insufficient-data')

    def test_training_uses_last_record_known_by_cutoff_not_postrace_revision(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.sqlite'; make_source(source)
            observed = {'raceId': 'r0000', 'raceDate': '20250101', 'winOdds': {str(n): 2. + n for n in range(1, 6)},
                        'sourcePublishedAt': '2025-01-01T14:40:00+09:00', 'observedAt': '2025-01-01T14:40:00+09:00',
                        'retrievedAt': '2025-01-01T14:41:00+09:00'}
            late = {**observed, 'retrievedAt': '2025-01-01T15:01:00+09:00', 'winOdds': {str(n): 50. for n in range(1, 6)}}
            with closing(open_source(source)) as c:
                rows, _ = training_rows(c, {'races': [observed, late]}, BASE)
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['decisionOdds'], [3., 4., 5., 6., 7.])
            self.assertEqual(rows[0]['closingOdds'], [3., 4., 5., 6., 7.])

    def test_fit_and_selection_use_no_holdout_outcomes_or_prices(self):
        rows = rows_fixture()
        original = train_prediction_models(rows, BASE)
        altered = copy.deepcopy(rows)
        for row in altered:
            if row['date'] >= '20250125':
                row['winner'] = 3
                row['closingOdds'] = [1000.] * 4
        other = train_prediction_models(altered, BASE)
        self.assertEqual(original['contextModel']['coefficients'], other['contextModel']['coefficients'])
        self.assertEqual(original['marketModel']['gamma'], other['marketModel']['gamma'])
        self.assertEqual(original['marketModel']['abilityWeight'], other['marketModel']['abilityWeight'])
        self.assertEqual(original['closingOddsModel']['coefficients'], other['closingOddsModel']['coefficients'])
        self.assertEqual(original['closingOddsModel']['residualLower'], other['closingOddsModel']['residualLower'])
        self.assertNotEqual(original['closingOddsModel']['validation']['holdout'], other['closingOddsModel']['validation']['holdout'])
        self.assertGreater(original['contextModel']['coefficients']['paddock'], 0)
        self.assertEqual(original['contextModel']['features'], ['paceFit', 'paddock'])
        json.dumps(original, allow_nan=False)

    def test_live_result_labels_train_without_waiting_for_result_database_import(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / 'source.sqlite'; make_source(source)
            with closing(sqlite3.connect(source)) as c, c:
                c.execute("DELETE FROM jrdb_results WHERE race_key='r0000'")
            observed = {'raceId': 'r0000', 'raceDate': '20250101', 'winOdds': {str(n): 2. + n for n in range(1, 6)},
                        'sourcePublishedAt': '2025-01-01T14:40:00+09:00', 'observedAt': '2025-01-01T14:40:00+09:00',
                        'retrievedAt': '2025-01-01T14:41:00+09:00'}
            result = {'raceId': 'r0000', 'raceDate': '20250101', 'results': [{'horseNo': 2, 'rank': 1}],
                      'retrievedAt': '2025-01-01T15:10:00+09:00'}
            with closing(open_source(source)) as c:
                rows, audit = training_rows(c, {'races': [observed, result]}, BASE)
            self.assertEqual(audit['liveResultLabelRaces'], 1)
            self.assertEqual(rows[0]['winner'], 1)
            self.assertEqual(rows[0]['closingOdds'], [None] * 5)
            result['finalWinOdds'] = {'1': 4., '2': 2., '3': 8., '4': 7., '5': 10.}
            with closing(open_source(source)) as c:
                rows, _ = training_rows(c, {'races': [observed, result]}, BASE)
            self.assertEqual(rows[0]['closingOdds'], [4., 2., 8., 7., 10.])

    def test_missing_context_has_no_fabricated_weather_or_paddock_effect(self):
        rows = rows_fixture()
        for row in rows:
            row['context'] = [dict.fromkeys(FEATURES) for _ in row['context']]
        model = train_prediction_models(rows, BASE)
        self.assertEqual(model['contextModel']['status'], 'insufficient-data')
        self.assertEqual(model['marketModel']['status'], 'ready')
        self.assertEqual(model['closingOddsModel']['status'], 'ready')

    def test_context_and_price_formula_match_browser_contract(self):
        race = {'race_key': 'synthetic', 'race_date': '20250101', 'surface_code': '1', 'place_code': '08'}
        source = {'going': '重', 'weather': '雨', 'paddock': [{'horseNo': 1, 'paddockIndex': 3}, {'horseNo': 2, 'paddockIndex': 1}],
                  'retrievedAt': '2025-01-01T14:40:00+09:00', 'availabilityAt': '2025-01-01T14:40:00+09:00', 'timingEvidence': 'observed-visible-at'}
        histories = {n: [{'race_date': '20241220', 'surface_code': '1', 'going_code': '3', 'rank': n, 'field_size': 5, 'weather': '雨'}] for n in [1, 2]}
        features = context_features([1, 2], histories, {1: '1', 2: '4'}, race, source, [], iso('2025-01-01T14:50:00+09:00'))
        self.assertEqual(features[0]['goingAffinity'], .125)
        self.assertEqual(features[1]['weatherAffinity'], .0625)
        self.assertEqual(features[0]['paddock'], 1)
        self.assertEqual(features[1]['paddock'], -1)
        x = price_features(3, 4, iso('2025-01-01T14:50:00+09:00'), iso('2025-01-01T14:40:00+09:00'), iso('2025-01-01T15:00:00+09:00'))
        self.assertAlmostEqual(x[2], math.log(.75))


if __name__ == '__main__':
    unittest.main()
