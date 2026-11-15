"""Deterministic chronological research; never treats closing odds as T-10 data."""
from __future__ import annotations

import math
import sqlite3
from collections import Counter, defaultdict
from pathlib import Path

from .ingest import digest, now_iso


def open_source(path):
    path = Path(path).expanduser().resolve(strict=True)
    connection = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True)
    connection.execute('PRAGMA query_only=ON')
    connection.row_factory = sqlite3.Row
    required = {'jrdb_races', 'jrdb_entries', 'jrdb_results'}
    existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    if not required <= existing:
        connection.close()
        raise ValueError('Source DB missing required JRDB tables')
    return connection


def load_complete_races(connection):
    races = {row['race_key']: dict(row) for row in connection.execute(
        'SELECT race_key,race_date,field_size,post_time,place_code,surface_code,distance FROM jrdb_races ORDER BY race_date,race_key')}
    entries = defaultdict(list)
    for row in connection.execute('SELECT race_key,horse_no,ketto_id,idm FROM jrdb_entries'):
        if row['race_key'] in races:
            entries[row['race_key']].append(dict(row))
    results = defaultdict(list)
    histories = defaultdict(list)
    for row in connection.execute('SELECT race_key,race_date,horse_no,ketto_id,rank,win_odds,field_size,surface_code,distance FROM jrdb_results'):
        if row['rank'] and row['field_size'] and 1 <= row['rank'] <= row['field_size']:
            histories[row['ketto_id']].append(dict(row))
        if row['race_key'] in races and row['race_date'] == races[row['race_key']]['race_date']:
            results[row['race_key']].append(dict(row))
    for history in histories.values():
        history.sort(key=lambda r: (r['race_date'], r['race_key']), reverse=True)
    excluded = Counter()
    complete = []
    for key, race in races.items():
        es, rs = entries[key], results[key]
        n = race['field_size'] or 0
        if not 2 <= n <= 18 or len(es) != n or len(rs) != n:
            excluded['incomplete-field'] += 1
            continue
        en, rn = {e['horse_no'] for e in es}, {r['horse_no'] for r in rs}
        if len(en) != n or en != rn or any(type(i) is not int or not 1 <= i <= 18 for i in en):
            excluded['duplicate-or-mismatched-numbers'] += 1
            continue
        es.sort(key=lambda e: e['horse_no'])
        by_no = {r['horse_no']: r for r in rs}
        paired = [by_no[e['horse_no']] for e in es]
        if any(e['ketto_id'] != r['ketto_id'] for e, r in zip(es, paired)):
            excluded['horse-id-mismatch'] += 1
            continue
        if any(r['field_size'] != n for r in rs):
            excluded['field-size-disagreement'] += 1
            continue
        if sorted(r['rank'] or 0 for r in rs) != list(range(1, n + 1)):
            excluded['tie-withdrawal-or-incomplete-finish'] += 1
            continue
        idms, odds = [e['idm'] for e in es], [r['win_odds'] for r in paired]
        if any(type(v) not in (int, float) or not math.isfinite(v) or v <= 0 for v in idms):
            excluded['missing-idm'] += 1
            continue
        if any(type(v) not in (int, float) or not math.isfinite(v) or v < 1 for v in odds):
            excluded['missing-closing-odds'] += 1
            continue
        condition_counts = []
        for entry in es:
            past = [p for p in histories[entry['ketto_id']] if p['race_date'] < race['race_date']][:5]
            counts = {'history_runs': len(past), 'history_top3': sum(p['rank'] <= 3 for p in past)}
            for condition in ('distance', 'venue', 'course'):
                matching = []
                for p in past:
                    surface = p['surface_code'] is not None and race['surface_code'] is not None and p['surface_code'] == race['surface_code']
                    near = p['distance'] is not None and race['distance'] is not None and abs(p['distance'] - race['distance']) <= 200
                    venue = p['race_key'][:2] == race['place_code']
                    exact = p['distance'] is not None and race['distance'] is not None and p['distance'] == race['distance']
                    match = surface and (near if condition == 'distance' else venue if condition == 'venue'
                                         else venue and exact)
                    if match:
                        matching.append(p)
                counts[f'{condition}_runs'] = len(matching)
                counts[f'{condition}_top3'] = sum(p['rank'] <= 3 for p in matching)
            condition_counts.append(counts)
        complete.append({'raceId': key, 'date': race['race_date'], 'idms': idms, 'closingOdds': odds,
                         'conditionCounts': condition_counts,
                         'winner': next(i for i, r in enumerate(paired) if r['rank'] == 1)})
    complete.sort(key=lambda r: (r['date'], r['raceId']))
    months = Counter(r['race_date'][:6] for r in races.values())
    dates = sorted(set(r['race_date'] for r in races.values()))
    return complete, {'sourceRaceCount': len(races), 'completeRaceCount': len(complete),
                      'excluded': dict(sorted(excluded.items())), 'racesByMonth': dict(sorted(months.items())),
                      'dateFrom': dates[0] if dates else None, 'dateTo': dates[-1] if dates else None,
                      'inputTiming': 'historical-input-time-unverified',
                      'warnings': ['Closing odds are outcome-time data, not decision-time observations.',
                                   'Historical KYI publication and retrieval times are not available.',
                                   'Excluded races can create selection bias; full-field coverage is reported.',
                                   'Result IDM is not stored and is not used as a pre-race feature.']}


CONDITION_NAMES = ('distance', 'venue', 'course')


def condition_features(counts, prior_rate, strength=3):
    return [(counts[f'{name}_top3'] - prior_rate * counts[f'{name}_runs']) /
            (counts[f'{name}_runs'] + strength) for name in CONDITION_NAMES]


def softmax(values):
    maximum = max(values)
    weights = [math.exp(v - maximum) for v in values]
    total = sum(weights)
    return [w / total for w in weights]


def probabilities(race, mode, temperature=8, gamma=1, blend=0.5, coefficients=None, prior_rate=0.3):
    scores = [v / temperature for v in race['idms']]
    if mode == 'conditions':
        scores = [score + sum(b * x for b, x in zip(coefficients, condition_features(counts, prior_rate)))
                  for score, counts in zip(scores, race['conditionCounts'])]
    ability = softmax(scores)
    market = softmax([-gamma * math.log(o) for o in race['closingOdds']])
    if mode in ('ability', 'conditions'):
        return ability
    if mode == 'market':
        return market
    return softmax([blend * math.log(max(p, 1e-15)) + (1 - blend) * math.log(max(q, 1e-15))
                    for p, q in zip(ability, market)])


def log_loss(races, mode, **params):
    return sum(-math.log(max(probabilities(r, mode, **params)[r['winner']], 1e-15)) for r in races) / len(races)


def metrics(races, mode, **params):
    bins = [{'count': 0, 'probabilitySum': 0, 'wins': 0} for _ in range(10)]
    losses, briers = [], []
    invested = returned = 0
    for race in races:
        ps = probabilities(race, mode, **params)
        winner = race['winner']
        losses.append(-math.log(max(ps[winner], 1e-15)))
        briers.append(sum((p - (i == winner)) ** 2 for i, p in enumerate(ps)))
        for i, p in enumerate(ps):
            b = bins[min(9, int(p * 10))]
            b['count'] += 1
            b['probabilitySum'] += p
            b['wins'] += int(i == winner)
            # This is a diagnostic fixed rule, never a T-10 backtest or real settled ROI.
            if p * race['closingOdds'][i] > 1.05:
                invested += 100
                if i == winner:
                    returned += 100 * race['closingOdds'][i]
    calibration = [{'band': [i / 10, (i + 1) / 10], 'count': b['count'],
                    'meanProbability': b['probabilitySum'] / b['count'],
                    'observedFrequency': b['wins'] / b['count']} for i, b in enumerate(bins) if b['count']]
    return {'races': len(races), 'logLoss': sum(losses) / len(losses),
            'brier': sum(briers) / len(briers), 'calibration': calibration,
            'closingOddsProxy': {'scope': 'not-an-executable-T10-backtest', 'fixedThreshold': 1.05,
                                 'flatStake': 100, 'invested': invested, 'proxyReturned': returned,
                                 'proxyReturnRate': returned / invested if invested else None}}


def split_races(races):
    dates = sorted({r['date'] for r in races})
    if len(dates) < 15 or len(races) < 60:
        raise ValueError('At least 60 complete races across 15 dates are required for three chronological partitions')
    train_end, calibration_end = max(1, int(len(dates) * .6)), max(2, int(len(dates) * .8))
    groups = [dates[:train_end], dates[train_end:calibration_end], dates[calibration_end:]]
    return [[r for r in races if r['date'] in set(group)] for group in groups]


def train_model(races, audit):
    train, calibration, holdout = split_races(races)
    temperatures = [2, 3, 4, 6, 8, 10, 12, 16, 20, 25, 32]
    gammas = [.7, .85, 1, 1.15, 1.3, 1.5]
    temperature_trials = [{'temperature': t, 'logLoss': log_loss(train, 'ability', temperature=t)} for t in temperatures]
    selected = min(temperature_trials, key=lambda x: x['logLoss'])['temperature']
    calibration_trials = [{'temperature': selected * scale,
                           'logLoss': log_loss(calibration, 'ability', temperature=selected * scale)}
                          for scale in [.75, 1, 1.25]]
    temperature = min(calibration_trials, key=lambda x: x['logLoss'])['temperature']
    gamma_trials = [{'gamma': g, 'logLoss': log_loss(train, 'market', gamma=g)} for g in gammas]
    gamma = min(gamma_trials, key=lambda x: x['logLoss'])['gamma']
    blend_trials = [{'blend': b, 'logLoss': log_loss(calibration, 'blend', temperature=temperature, gamma=gamma, blend=b)}
                    for b in [0, .25, .5, .75, 1]]
    blend = min(blend_trials, key=lambda x: x['logLoss'])['blend']
    periods = {}
    for name, part in [('train', train), ('calibration', calibration), ('holdout', holdout)]:
        periods[name] = {'dateFrom': part[0]['date'], 'dateTo': part[-1]['date'], 'races': len(part)}
    validation = {'method': 'chronological-date-split', 'periods': periods,
                  'holdout': {'idmDefault': metrics(holdout, 'ability', temperature=8),
                              'idmTemperature': metrics(holdout, 'ability', temperature=temperature),
                              'marketShare': metrics(holdout, 'market'),
                              'marketCalibrated': metrics(holdout, 'market', gamma=gamma),
                              'blendResearch': metrics(holdout, 'blend', temperature=temperature, gamma=gamma, blend=blend)},
                  'trials': {'temperatureTrain': temperature_trials, 'temperatureCalibration': calibration_trials,
                             'gammaTrain': gamma_trials, 'blendCalibration': blend_trials}}
    through = calibration[-1]['date']
    fingerprint = digest(races)
    experiment_id = digest({'data': fingerprint, 'algorithm': 'chronological-idm-v1',
                            'temperatureGrid': temperatures, 'gammaGrid': gammas})[:12]
    return {'schemaVersion': 1, 'modelType': 'idm-temperature', 'id': f'idm-research-{experiment_id}',
            'temperature': temperature, 'trainedThrough': f'{through[:4]}-{through[4:6]}-{through[6:]}',
            'status': 'research', 'generatedAt': now_iso(), 'inputHash': fingerprint,
            'informationTiming': 'historical-input-time-unverified', 'validation': validation,
            'marketResearch': {'gamma': gamma, 'blend': blend, 'scope': 'closing-odds-only',
                               'usableForT10': False}, 'audit': audit,
            'limitations': ['No profitability approval or automatic model promotion.',
                            'IDM is a prior prediction, not result IDM.',
                            'Closing odds diagnostics are not actual purchase or official payout results.',
                            'Temperature-only ability model does not yet learn course, pace or paddock effects.']}


def fit_condition_coefficients(races, temperature, prior_rate, penalty):
    prepared = [(r, [condition_features(c, prior_rate) for c in r['conditionCounts']]) for r in races]
    coefficients = [0.0, 0.0, 0.0]
    # Fixed optimizer parameters. Tuning/selection never reads the holdout partition.
    for _ in range(180):
        gradient = [0.0, 0.0, 0.0]
        for race, features in prepared:
            ps = softmax([idm / temperature + sum(b * x for b, x in zip(coefficients, f))
                          for idm, f in zip(race['idms'], features)])
            for index, (p, f) in enumerate(zip(ps, features)):
                residual = p - (index == race['winner'])
                for k in range(3):
                    gradient[k] += residual * f[k]
        next_values = [b - 2 * (g / len(races) + penalty * b) for b, g in zip(coefficients, gradient)]
        change = max(abs(a - b) for a, b in zip(coefficients, next_values))
        coefficients = next_values
        if change < 1e-7:
            break
    return coefficients


def train_conditions(races, base_model):
    train, calibration, holdout = split_races(races)
    history_count = sum(c['history_runs'] for r in train for c in r['conditionCounts'])
    if history_count == 0:
        raise ValueError('Historical valid runs are required for the condition challenger')
    prior_rate = sum(c['history_top3'] for r in train for c in r['conditionCounts']) / history_count
    temperature = base_model['temperature']
    candidates = []
    for penalty in [.005, .02, .1]:
        coefficients = fit_condition_coefficients(train, temperature, prior_rate, penalty)
        candidate = {'penalty': penalty, 'coefficients': coefficients,
                     'calibrationLogLoss': log_loss(calibration, 'conditions', temperature=temperature,
                                                    coefficients=coefficients, prior_rate=prior_rate)}
        candidates.append(candidate)
    best = min(candidates, key=lambda x: x['calibrationLogLoss'])
    incumbent_loss = log_loss(calibration, 'ability', temperature=temperature)
    selected = 'challenger' if best['calibrationLogLoss'] < incumbent_loss else 'incumbent'
    coefficients = best['coefficients'] if selected == 'challenger' else [0.0, 0.0, 0.0]
    feature_spec = {'version': 1, 'priorRate': prior_rate, 'priorStrength': 3, 'window': 5,
                    'distanceTolerance': 200,
                    'fields': {name: [f'{name}_top3', f'{name}_runs'] for name in CONDITION_NAMES}}
    fingerprint = digest({'inputHash': base_model['inputHash'], 'algorithm': 'idm-conditions-v1',
                          'featureSpec': feature_spec, 'penalties': [.005, .02, .1]})
    return {'schemaVersion': 1, 'modelType': 'idm-conditions-v1', 'featureSchema': 'race-ability-last5-v1',
            'id': f'idm-conditions-{fingerprint[:12]}', 'temperature': temperature,
            'coefficients': dict(zip(CONDITION_NAMES, coefficients)), 'featureSpec': feature_spec,
            'trainedThrough': base_model['trainedThrough'], 'status': 'research',
            'informationTiming': base_model['informationTiming'], 'generatedAt': now_iso(),
            'inputHash': base_model['inputHash'],
            'selection': {'selected': selected, 'method': 'calibration-only',
                          'incumbentLogLoss': incumbent_loss, 'challengerLogLoss': best['calibrationLogLoss']},
            'validation': {'method': 'chronological-date-split', 'periods': base_model['validation']['periods'],
                           'trials': candidates,
                           'holdout': {'incumbent': metrics(holdout, 'ability', temperature=temperature),
                                       'challenger': metrics(holdout, 'conditions', temperature=temperature,
                                                             coefficients=best['coefficients'], prior_rate=prior_rate),
                                       'selected': metrics(holdout, 'conditions', temperature=temperature,
                                                           coefficients=coefficients, prior_rate=prior_rate)}},
            'limitations': ['Selection used calibration dates only; holdout did not select the model.',
                            'Past-run outcomes are restricted to dates before each target race.',
                            'Coefficients are predictive associations, not causal course effects.',
                            'Weather, pace, same-day bias, paddock and final-odds forecasting remain untrained.',
                            'Input publication and retrieval timestamps remain unverified; not a proven T10 strategy.']}
