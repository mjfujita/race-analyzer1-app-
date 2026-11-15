"""Timestamp-safe conditional, T-10 market and closing-price model training.

Only observed decision-time records create training features. Closing odds and
finishing order are labels. Missing context never becomes a fabricated bonus.
"""
from __future__ import annotations

import math
from collections import defaultdict
from datetime import datetime, timedelta

from .ingest import JST, digest, iso, now_iso
from .train import condition_features, load_complete_races, softmax, split_races

FEATURES = ('goingAffinity', 'weatherAffinity', 'paceFit', 'dayBias', 'paddock')
FRONT = {'1': 1, '2': .5, '3': -.5, '4': -1}
GOING = {'1': '良', '2': '稍重', '3': '重', '4': '不良', '稍': '稍重'}


def finite(value):
    return type(value) in (int, float) and math.isfinite(value)


def available_at(source, cutoff, max_age=math.inf):
    try:
        retrieved = iso(source.get('retrievedAt'))
        if retrieved > cutoff:
            return False
        if (source.get('timingEvidence') == 'observed-visible-at'
                and iso(source.get('availabilityAt')) == retrieved):
            if any(source.get(key) is not None and iso(source[key]) > retrieved for key in ('observedAt', 'sourcePublishedAt')):
                return False
            return (cutoff - retrieved).total_seconds() / 60 <= max_age
        observed, published = iso(source.get('observedAt')), iso(source.get('sourcePublishedAt'))
        return published <= observed <= retrieved and (cutoff - observed).total_seconds() / 60 <= max_age
    except (ValueError, TypeError, AttributeError):
        return False


def flatten_observations(document):
    if isinstance(document, list):
        raw = document
    elif isinstance(document, dict):
        raw = document.get('observations', document.get('races', []))
    else:
        return []
    records = []
    for event in raw:
        if not isinstance(event, dict):
            continue
        payload = event.get('payload', event)
        if not isinstance(payload, dict):
            continue
        if event.get('kind') not in (None, 'LIVE_RACE', 'RACE_CONTEXT', 'ODDS', 'observed'):
            continue
        record = dict(payload)
        record['retrievedAt'] = record.get('retrievedAt') or event.get('retrievedAt')
        if record.get('odds') and not record.get('winOdds'):
            record['winOdds'] = record['odds']
        records.append(record)
    return records


def context_features(numbers, histories, styles, race, source, earlier_results, cutoff):
    date = race['race_date']
    surface = {'1': '芝', '2': 'ダート'}.get(str(race['surface_code']))
    visible = available_at(source, cutoff, 60)
    front = [FRONT.get(str(styles.get(n))) for n in numbers]
    complete_styles = all(value is not None for value in front)
    fraction = sum(value > 0 for value in front) / len(numbers) if complete_styles else None
    paddock = source.get('paddock', [])
    if isinstance(paddock, dict):
        paddock = [{**value, 'horseNo': int(no)} if isinstance(value, dict)
                   else {'horseNo': int(no), 'paddockIndex': value} for no, value in paddock.items() if str(no).isdigit()]
    pmap = {int(p.get('horseNo', p.get('no'))): p.get('paddockIndex') for p in paddock if isinstance(p, dict)
            and str(p.get('horseNo', p.get('no', ''))).isdigit()}
    ps = [pmap.get(no) for no in numbers]
    valid_paddock = visible and all(finite(v) for v in ps)
    mean = sum(ps) / len(ps) if valid_paddock else 0
    sd = math.sqrt(sum((v - mean) ** 2 for v in ps) / len(ps)) if valid_paddock else 0
    residuals = []
    unique_results = {}
    for result in earlier_results:
        if (result.get('raceDate') != date or str(result.get('placeCode')) != str(race['place_code'])
                or str(result.get('surface')) != str(surface) or result.get('raceId') == race['race_key']
                or not available_at(result, cutoff)):
            continue
        previous = unique_results.get(result.get('raceId'))
        if previous is None or iso(result['retrievedAt']) > iso(previous['retrievedAt']):
            unique_results[result.get('raceId')] = result
    for result in unique_results.values():
        field = result.get('field', [])
        if len(field) < 2 or any(not finite(h.get('probability')) or str(h.get('style')) not in FRONT for h in field):
            continue
        winner = next((h for h in field if h['no'] == result.get('winnerNo')), None)
        if winner and abs(sum(h['probability'] for h in field) - 1) < 1e-6:
            residuals.append(FRONT[str(winner['style'])] - sum(h['probability'] * FRONT[str(h['style'])] for h in field))
    day = sum(residuals) / (len(residuals) + 3) if residuals else None
    output = []
    for i, no in enumerate(numbers):
        past = sorted([p for p in histories.get(no, []) if p['race_date'] < date and p.get('rank')
                       and p.get('field_size') and 1 <= p['rank'] <= p['field_size'] and p['field_size'] >= 2
                       and str(p.get('surface_code')) == str(race['surface_code'])], key=lambda p: p['race_date'], reverse=True)[:5]

        def affinity(key, target):
            if not visible or target in (None, '', '—', '?'):
                return None
            known = [p for p in past if p.get(key) not in (None, '', '—', '?')]
            if not known:
                return None
            normalized = lambda v: GOING.get(str(v), str(v)) if key == 'going_code' else str(v)
            matching = [p for p in known if normalized(p[key]) == normalized(target)]
            return sum(.5 - (p['rank'] - 1) / (p['field_size'] - 1) for p in matching) / (len(matching) + 3)

        output.append({'goingAffinity': affinity('going_code', source.get('going')),
                       'weatherAffinity': affinity('weather', source.get('weather')),
                       'paceFit': front[i] * (1 - 2 * fraction) if complete_styles else None,
                       'dayBias': front[i] * day if complete_styles and day is not None else None,
                       'paddock': max(-3, min(3, (ps[i] - mean) / sd)) if valid_paddock and sd > 0 else 0 if valid_paddock else None})
    return output


def price_features(odds, previous, observed, previous_at, post):
    minutes = (post - observed).total_seconds() / 60
    if not finite(odds) or odds < 1 or not 10 <= minutes <= 30:
        return None
    elapsed = (observed - previous_at).total_seconds() / 60 if previous_at else 0
    has_previous = finite(previous) and previous >= 1 and 1 <= elapsed <= 120
    slope = max(-2, min(2, math.log(odds / previous) / elapsed * 10)) if has_previous else 0
    return [1, math.log(odds), slope, minutes / 10, int(has_previous)]


def training_rows(connection, document, base_model):
    """Join full fields to known-by-T10 snapshots and outcome labels, never vice versa."""
    complete, _ = load_complete_races(connection)
    source_complete_count = len(complete)
    metadata = {r['race_key']: dict(r) for r in connection.execute('SELECT * FROM jrdb_races')}
    entries = defaultdict(list)
    for row in connection.execute('SELECT * FROM jrdb_entries'):
        entries[row['race_key']].append(dict(row))
    past = defaultdict(list)
    for row in connection.execute('SELECT * FROM jrdb_results'):
        past[row['ketto_id']].append(dict(row))
    records = flatten_observations(document)
    by_race = defaultdict(list)
    for record in records:
        by_race[str(record.get('raceId'))].append(record)
    weather_by_race = {}
    for key, observations in by_race.items():
        meta = metadata.get(key)
        if not meta:
            continue
        try:
            post = datetime.strptime(meta['race_date'] + str(meta.get('post_time') or '').replace(':', ''), '%Y%m%d%H%M').replace(tzinfo=JST)
        except ValueError:
            continue
        known = [r for r in observations if r.get('weather') not in (None, '', '—', '?') and available_at(r, post, 120)]
        if known:
            weather_by_race[key] = max(known, key=lambda r: iso(r['retrievedAt']))['weather']
    for history in past.values():
        for result in history:
            if result['race_key'] in weather_by_race:
                result['weather'] = weather_by_race[result['race_key']]
    # A live result's single identified winner is enough for win-probability labels.
    # It does not invent the unreported lower finishing order or missing closing prices.
    complete_keys = {r['raceId'] for r in complete}
    live_labels = 0
    for key, meta in metadata.items():
        if key in complete_keys:
            continue
        ordered = sorted(entries[key], key=lambda e: e['horse_no'])
        n = meta.get('field_size') or 0
        numbers = [e['horse_no'] for e in ordered]
        if not 2 <= n <= 18 or len(ordered) != n or len(set(numbers)) != n or any(not finite(e.get('idm')) or e['idm'] <= 0 for e in ordered):
            continue
        try:
            post = datetime.strptime(meta['race_date'] + str(meta.get('post_time') or '').replace(':', ''), '%Y%m%d%H%M').replace(tzinfo=JST)
        except ValueError:
            continue
        labels = []
        for record in by_race[key]:
            result = record.get('results')
            if not isinstance(result, list) or str(record.get('raceDate', '')).replace('-', '') != meta['race_date']:
                continue
            try:
                retrieved = iso(record.get('resultsRetrievedAt') or record.get('retrievedAt'))
            except ValueError:
                continue
            winners = [r.get('horseNo', r.get('no')) for r in result if isinstance(r, dict) and r.get('rank') == 1]
            if retrieved > post and len(winners) == 1 and winners[0] in numbers:
                labels.append((retrieved, winners[0], record))
        if not labels:
            continue
        _, winner, record = max(labels, key=lambda row: row[0])
        closing = record.get('finalWinOdds')
        if (not isinstance(closing, dict) or set(map(str, closing)) != set(map(str, numbers))
                or any(not finite(value) or value < 1 for value in closing.values())):
            closing = {}
        counts = []
        for entry in ordered:
            history = sorted([p for p in past[entry['ketto_id']] if p['race_date'] < meta['race_date'] and p.get('rank')
                              and p.get('field_size') and 1 <= p['rank'] <= p['field_size']], key=lambda p: (p['race_date'], p['race_key']), reverse=True)[:5]
            count = {'history_runs': len(history), 'history_top3': sum(p['rank'] <= 3 for p in history)}
            for condition in ('distance', 'venue', 'course'):
                same = [p for p in history if str(p.get('surface_code')) == str(meta.get('surface_code'))
                        and (abs((p.get('distance') or -9999) - (meta.get('distance') or 9999)) <= 200 if condition == 'distance'
                             else p['race_key'][:2] == meta.get('place_code') if condition == 'venue'
                             else p['race_key'][:2] == meta.get('place_code') and p.get('distance') == meta.get('distance'))]
                count[f'{condition}_runs'] = len(same); count[f'{condition}_top3'] = sum(p['rank'] <= 3 for p in same)
            counts.append(count)
        complete.append({'raceId': key, 'date': meta['race_date'], 'idms': [e['idm'] for e in ordered],
                         'closingOdds': [closing.get(str(no), closing.get(no)) for no in numbers],
                         'conditionCounts': counts, 'winner': numbers.index(winner)})
        live_labels += 1
    complete.sort(key=lambda r: (r['date'], r['raceId']))
    rows, counts = [], {'availableSnapshots': len(records), 'completeSourceRaces': source_complete_count,
                        'liveResultLabelRaces': live_labels, 'eligibleRaces': 0, 'noDecisionObservation': 0, 'baseModelNotEarlier': 0}
    through = str(base_model.get('trainedThrough', '')).replace('-', '')
    # Default temperature has no learned parameters; learned base models must precede every target.
    if not through and base_model.get('id') != 'idm-temperature-baseline-v1':
        raise ValueError('A historical cutoff is required for the base model')
    outcomes = {r['raceId']: r for r in complete}
    earlier_results = []
    for record in records:
        result = record.get('results')
        outcome = outcomes.get(record.get('raceId'))
        meta = metadata.get(record.get('raceId'))
        if not result or not outcome or not meta or (through and through >= outcome['date']):
            continue
        if not isinstance(result, list):
            continue
        numbers = sorted(e['horse_no'] for e in entries[outcome['raceId']])
        ordered = sorted(entries[outcome['raceId']], key=lambda e: e['horse_no'])
        ps = base_probabilities(outcome, base_model)
        timestamped = dict(record)
        timestamped.update({'sourcePublishedAt': record.get('resultsPublishedAt') or record.get('sourcePublishedAt'),
                            'retrievedAt': record.get('resultsRetrievedAt') or record.get('retrievedAt'),
                            'observedAt': record.get('resultsObservedAt') or record.get('observedAt'),
                            'placeCode': meta['place_code'], 'surface': {'1': '芝', '2': 'ダート'}.get(str(meta['surface_code'])),
                            'winnerNo': numbers[outcome['winner']],
                            'field': [{'no': no, 'style': e.get('running_style'), 'probability': p} for no, e, p in zip(numbers, ordered, ps)]})
        # A result must actually contain the officially identified winner; a stale prerace page is not evidence.
        if any(r.get('horseNo', r.get('no')) == timestamped['winnerNo'] and r.get('rank') == 1 for r in result if isinstance(r, dict)):
            earlier_results.append(timestamped)
    for outcome in complete:
        if through and through >= outcome['date']:
            counts['baseModelNotEarlier'] += 1
            continue
        key = outcome['raceId']; meta = metadata[key]
        clock = str(meta.get('post_time') or '').replace(':', '')
        if len(clock) != 4 or not clock.isdigit():
            continue
        try:
            post = datetime.strptime(meta['race_date'] + clock, '%Y%m%d%H%M').replace(tzinfo=JST)
        except ValueError:
            continue
        cutoff = post - timedelta(minutes=10)
        ordered = sorted(entries[key], key=lambda e: e['horse_no'])
        numbers = [e['horse_no'] for e in ordered]
        candidates = []
        for r in by_race[key]:
            odds = r.get('winOdds')
            if (str(r.get('raceDate', '')).replace('-', '') != outcome['date'] or r.get('kind') == 'baseline'
                    or not available_at(r, cutoff, 140) or not isinstance(odds, dict)
                    or set(map(str, odds)) != set(map(str, numbers))
                    or any(not finite(v) or v < 1 for v in odds.values())):
                continue
            try:
                observed = iso(r.get('observedAt') or r.get('availabilityAt'))
            except ValueError:
                continue
            candidates.append((observed, iso(r['retrievedAt']), r))
        candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
        eligible = [c for c in candidates if timedelta() <= cutoff - c[0] <= timedelta(minutes=20)]
        if not eligible:
            counts['noDecisionObservation'] += 1
            continue
        observed, _, source = eligible[0]
        previous = next((c for c in candidates if observed - c[0] >= timedelta(minutes=1)), None)
        odds = [source['winOdds'].get(str(n), source['winOdds'].get(n)) for n in numbers]
        features = context_features(numbers, {e['horse_no']: past[e['ketto_id']] for e in ordered},
                                    {e['horse_no']: e.get('running_style') for e in ordered}, meta, source, earlier_results, cutoff)
        xs = [price_features(o, previous[2]['winOdds'].get(str(n), previous[2]['winOdds'].get(n)) if previous else None,
                             observed, previous[0] if previous else None, post) for n, o in zip(numbers, odds)]
        rows.append({'raceId': key, 'date': outcome['date'], 'winner': outcome['winner'], 'numbers': numbers,
                     'baseProbability': base_probabilities(outcome, base_model), 'decisionOdds': odds,
                     'closingOdds': outcome['closingOdds'], 'context': features, 'priceFeatures': xs,
                     'cutoffAt': cutoff.isoformat(), 'sourceObservedAt': observed.isoformat(),
                     'sourceRetrievedAt': source['retrievedAt']})
    rows.sort(key=lambda row: (row['date'], row['raceId']))
    counts['eligibleRaces'] = len(rows)
    counts['featureRaceCounts'] = {key: sum(all(finite(h[key]) for h in row['context']) for row in rows) for key in FEATURES}
    return rows, counts


def base_probabilities(race, base):
    scores = [idm / base.get('temperature', 8) for idm in race['idms']]
    if base.get('modelType') == 'idm-conditions-v1':
        coefficients = [base['coefficients'][name] for name in ('distance', 'venue', 'course')]
        scores = [score + sum(coef * value for coef, value in zip(coefficients, condition_features(counts, base['featureSpec']['priorRate'])))
                  for score, counts in zip(scores, race['conditionCounts'])]
    return softmax(scores)


def context_probabilities(row, coefficients):
    enabled = [key for key in coefficients if all(finite(h[key]) for h in row['context'])]
    return softmax([math.log(max(p, 1e-15)) + sum(coefficients[k] * h[k] for k in enabled)
                    for p, h in zip(row['baseProbability'], row['context'])])


def summary(rows, predictions):
    return {'races': len(rows), 'logLoss': sum(-math.log(max(p[r['winner']], 1e-15)) for r, p in zip(rows, predictions)) / len(rows),
            'brier': sum(sum((p - int(i == r['winner'])) ** 2 for i, p in enumerate(ps)) for r, ps in zip(rows, predictions)) / len(rows)}


def fit_context(rows, keys, penalty):
    coefficients = dict.fromkeys(keys, 0.)
    for _ in range(180):
        gradient = dict.fromkeys(keys, 0.)
        for row in rows:
            ps = context_probabilities(row, coefficients)
            for key in keys:
                if all(finite(h[key]) for h in row['context']):
                    gradient[key] += sum((p - int(i == row['winner'])) * h[key] for i, (p, h) in enumerate(zip(ps, row['context'])))
        values = {k: max(-20., min(20., coefficients[k] - .3 * (gradient[k] / len(rows) + penalty * coefficients[k]))) for k in keys}
        change = max(abs(values[k] - coefficients[k]) for k in keys)
        coefficients = values
        if change < 1e-7:
            break
    return coefficients


def ridge_fit(samples, penalty):
    n = 5
    system = [[sum(x[i] * x[j] for x, _ in samples) / len(samples) + (penalty if i == j and i > 0 else 0)
               for j in range(n)] + [sum(x[i] * y for x, y in samples) / len(samples)] for i in range(n)]
    # Small ridge even on the intercept handles collinear/constant observation horizons deterministically.
    for i in range(n):
        system[i][i] += 1e-9
    for i in range(n):
        pivot = max(range(i, n), key=lambda k: abs(system[k][i])); system[i], system[pivot] = system[pivot], system[i]
        scale = system[i][i]
        system[i] = [v / scale for v in system[i]]
        for j in range(n):
            if j != i:
                multiplier = system[j][i]
                system[j] = [a - multiplier * b for a, b in zip(system[j], system[i])]
    return [system[i][-1] for i in range(n)]


def quantile(values, fraction):
    values = sorted(values)
    return values[min(len(values) - 1, max(0, math.ceil(len(values) * fraction) - 1))]


def train_runtime_models(connection, document, base_model):
    rows, audit = training_rows(connection, document, base_model)
    bundle = train_prediction_models(rows, base_model, audit)
    if bundle['contextModel']['status'] == 'insufficient-data' and bundle['marketModel']['status'] == 'insufficient-data':
        # KYI style is a prerace field. This historical research fallback does not create fake T10 prices.
        context = train_historical_pace(connection, base_model)
        if context['status'] == 'ready':
            bundle['contextModel'] = context
            bundle['id'] = 'runtime-' + digest({'base': base_model['id'], 'observed': bundle['id'], 'pace': context['id']})[:12]
    return bundle


def train_historical_pace(connection, base_model):
    races, _ = load_complete_races(connection)
    styles = defaultdict(dict)
    columns = {row[1] for row in connection.execute('PRAGMA table_info(jrdb_entries)')}
    if 'running_style' not in columns:
        return {'modelType': 'context-logit-v1', 'status': 'insufficient-data', 'reason': 'No prerace running styles'}
    for row in connection.execute('SELECT race_key,horse_no,running_style FROM jrdb_entries'):
        styles[row['race_key']][row['horse_no']] = FRONT.get(str(row['running_style']))
    through = str(base_model.get('trainedThrough', '')).replace('-', '')
    rows = []
    for race in races:
        if through and through >= race['date']:
            continue
        style = [value for _, value in sorted(styles[race['raceId']].items())]
        if len(style) != len(race['idms']) or any(value is None for value in style):
            continue
        fraction = sum(value > 0 for value in style) / len(style)
        rows.append({'raceId': race['raceId'], 'date': race['date'], 'winner': race['winner'],
                     'baseProbability': base_probabilities(race, base_model),
                     'context': [{**dict.fromkeys(FEATURES), 'paceFit': value * (1 - 2 * fraction)} for value in style]})
    try:
        train, calibration, holdout = split_races(rows)
    except ValueError as error:
        return {'modelType': 'context-logit-v1', 'status': 'insufficient-data', 'reason': str(error)}
    trials = []
    for penalty in [.01, .1, 1.]:
        coef = fit_context(train, ['paceFit'], penalty)
        trials.append({'penalty': penalty, 'coefficients': coef,
                       'calibrationLogLoss': summary(calibration, [context_probabilities(r, coef) for r in calibration])['logLoss']})
    best = min(trials, key=lambda trial: trial['calibrationLogLoss'])
    incumbent = summary(calibration, [r['baseProbability'] for r in calibration])['logLoss']
    selected = best['calibrationLogLoss'] < incumbent
    coef = best['coefficients'] if selected else {'paceFit': 0.}
    through = calibration[-1]['date']
    return {'modelType': 'context-logit-v1', 'status': 'ready', 'research': True, 'baseModelId': base_model['id'],
            'id': 'pace-history-' + digest({'rows': rows, 'base': base_model['id'], 'algorithm': 'pace-context-v1'})[:12],
            'generatedAt': now_iso(), 'trainedThrough': f'{through[:4]}-{through[4:6]}-{through[6:]}',
            'informationTiming': 'historical-KYI-time-unverified', 'features': ['paceFit'], 'coefficients': coef,
            'featureSchema': 'race-context-v1', 'featureTrainCounts': {'paceFit': len(train)},
            'selection': {'selected': 'challenger' if selected else 'incumbent', 'incumbentLogLoss': incumbent,
                          'challengerLogLoss': best['calibrationLogLoss']},
            'validation': {'method': 'chronological-date-split',
                           'periods': {name: {'dateFrom': part[0]['date'], 'dateTo': part[-1]['date'], 'races': len(part)} for name, part in
                                       [('train', train), ('calibration', calibration), ('holdout', holdout)]},
                           'trials': trials, 'holdout': {'base': summary(holdout, [r['baseProbability'] for r in holdout]),
                                                        'selected': summary(holdout, [context_probabilities(r, coef) for r in holdout])}},
            'limitations': ['Only prerace KYI style composition is fitted from historical data.',
                            'Historical publication time is unverified; this is not an executable T10 ROI test.',
                            'Weather, going, paddock and day-bias effects require timestamped observations.']}


def train_prediction_models(rows, base_model, audit=None):
    """Pure fitting entry point, also exercised by synthetic chronological tests."""
    generated = now_iso()
    bundle = {'schemaVersion': 1, 'kind': 'race-prediction-models', 'generatedAt': generated, 'baseModel': base_model,
              'audit': audit or {'eligibleRaces': len(rows)},
              'limitations': ['Models are research estimates, not evidence of profitable betting.',
                              'Closing-price bounds are predictive residual quantiles, not confidence bounds on expected returns.',
                              'Missing context is omitted; no fabricated probability bonus is applied.']}
    types = {'contextModel': 'context-logit-v1', 'marketModel': 't10-market-blend-v1', 'closingOddsModel': 'closing-logratio-v1'}
    def empty(name, reason):
        return {'modelType': types[name], 'status': 'insufficient-data', 'reason': reason,
                'required': {'races': 60, 'dates': 15}, 'available': {'races': len(rows), 'dates': len({r['date'] for r in rows})}}
    try:
        train, calibration, holdout = split_races(rows)
    except ValueError as error:
        bundle.update({name: empty(name, str(error)) for name in types})
        bundle['id'] = 'runtime-pending-' + digest({'base': base_model['id'], 'rows': rows})[:12]
        return bundle
    periods = {name: {'dateFrom': part[0]['date'], 'dateTo': part[-1]['date'], 'races': len(part)} for name, part in
               [('train', train), ('calibration', calibration), ('holdout', holdout)]}
    through = calibration[-1]['date']
    common = {'status': 'ready', 'generatedAt': generated, 'baseModelId': base_model['id'],
              'trainedThrough': f'{through[:4]}-{through[4:6]}-{through[6:]}', 'informationTiming': 'observed-before-T10',
              'research': True, 'validation': {'method': 'chronological-date-split', 'periods': periods}}
    feature_counts = {key: sum(all(finite(h[key]) for h in row['context']) for row in train) for key in FEATURES}
    keys = [key for key in FEATURES if feature_counts[key] >= 30 and any(any(abs(h[key]) > 1e-12 for h in row['context'])
                       for row in train if all(finite(h[key]) for h in row['context']))]
    coefficients = {}
    if keys:
        trials = []
        for penalty in [.01, .1, 1.]:
            coef = fit_context(train, keys, penalty)
            loss = summary(calibration, [context_probabilities(r, coef) for r in calibration])['logLoss']
            trials.append({'penalty': penalty, 'coefficients': coef, 'calibrationLogLoss': loss})
        best = min(trials, key=lambda t: t['calibrationLogLoss'])
        incumbent = summary(calibration, [r['baseProbability'] for r in calibration])['logLoss']
        selected = best['calibrationLogLoss'] < incumbent
        coefficients = best['coefficients'] if selected else dict.fromkeys(keys, 0.)
        bundle['contextModel'] = {**common, 'modelType': types['contextModel'], 'features': keys, 'coefficients': coefficients,
                                  'featureSchema': 'race-context-v1', 'featureTrainCounts': feature_counts,
                                  'selection': {'selected': 'challenger' if selected else 'incumbent', 'incumbentLogLoss': incumbent,
                                                'challengerLogLoss': best['calibrationLogLoss']},
                                  'validation': {**common['validation'], 'trials': trials,
                                                 'holdout': {'base': summary(holdout, [r['baseProbability'] for r in holdout]),
                                                             'selected': summary(holdout, [context_probabilities(r, coefficients) for r in holdout])}}}
    else:
        bundle['contextModel'] = empty('contextModel', 'At least 30 training-period races with each varying context feature are required')
        bundle['contextModel']['featureTrainCounts'] = feature_counts
    gamma_trials = []
    market = lambda r, gamma: softmax([-gamma * math.log(o) for o in r['decisionOdds']])
    for gamma in [.7, .85, 1., 1.15, 1.3, 1.5]:
        gamma_trials.append({'gamma': gamma, 'trainLogLoss': summary(train, [market(r, gamma) for r in train])['logLoss']})
    gamma = min(gamma_trials, key=lambda trial: trial['trainLogLoss'])['gamma']
    def blend(row, weight):
        pc, pm = context_probabilities(row, coefficients), market(row, gamma)
        return softmax([weight * math.log(max(p, 1e-15)) + (1 - weight) * math.log(max(q, 1e-15)) for p, q in zip(pc, pm)])
    blend_trials = [{'abilityWeight': weight, 'calibrationLogLoss': summary(calibration, [blend(r, weight) for r in calibration])['logLoss']}
                    for weight in [0., .25, .5, .75, 1.]]
    weight = min(blend_trials, key=lambda trial: trial['calibrationLogLoss'])['abilityWeight']
    bundle['marketModel'] = {**common, 'modelType': types['marketModel'], 'gamma': gamma, 'abilityWeight': weight,
                             'validation': {**common['validation'], 'gammaTrials': gamma_trials, 'blendTrials': blend_trials,
                                            'holdout': {'market': summary(holdout, [market(r, gamma) for r in holdout]),
                                                        'selected': summary(holdout, [blend(r, weight) for r in holdout])}}}
    samples = lambda part: [(x, math.log(close / observed)) for r in part for x, close, observed in
                           zip(r['priceFeatures'], r['closingOdds'], r['decisionOdds']) if x is not None and finite(close) and close >= 1]
    training_samples, calibration_samples, holdout_samples = samples(train), samples(calibration), samples(holdout)
    if not training_samples or not calibration_samples or not holdout_samples:
        bundle['closingOddsModel'] = empty('closingOddsModel', 'All three chronological periods need valid decision-to-closing price pairs')
    else:
        mse = lambda part, coef: sum((y - sum(a * b for a, b in zip(x, coef))) ** 2 for x, y in part) / len(part)
        trials = []
        for penalty in [.001, .01, .1, 1.]:
            coef = ridge_fit(training_samples, penalty)
            trials.append({'penalty': penalty, 'coefficients': coef, 'calibrationMSE': mse(calibration_samples, coef)})
        best = min(trials, key=lambda trial: trial['calibrationMSE'])
        unchanged = mse(calibration_samples, [0.] * 5)
        coefficients_price = best['coefficients'] if best['calibrationMSE'] < unchanged else [0.] * 5
        residuals = [y - sum(a * b for a, b in zip(x, coefficients_price)) for x, y in calibration_samples]
        median_correction = quantile(residuals, .5)
        coefficients_price = list(coefficients_price)
        coefficients_price[0] += median_correction
        residuals = [residual - median_correction for residual in residuals]
        low, high = quantile(residuals, .1), quantile(residuals, .9)
        observed_coverage = sum(low <= y - sum(a * b for a, b in zip(x, coefficients_price)) <= high for x, y in holdout_samples) / len(holdout_samples)
        bundle['closingOddsModel'] = {**common, 'modelType': types['closingOddsModel'], 'coefficients': coefficients_price,
                                      'featureSchema': 'logodds-slope-horizon-v1', 'residualLower': low, 'residualUpper': high,
                                      'pointMethod': 'calibration-median-adjusted-log-regression', 'medianBiasCorrection': median_correction,
                                      'interval': {'nominalCoverage': .8, 'method': 'calibration-residual-quantiles'},
                                      'selection': {'selected': 'challenger' if best['calibrationMSE'] < unchanged else 'unchanged-trend'},
                                      'validation': {**common['validation'], 'trials': trials,
                                                     'holdout': {'logRatioMSE': mse(holdout_samples, coefficients_price),
                                                                 'unchangedPriceMSE': mse(holdout_samples, [0.] * 5),
                                                                 'intervalCoverage': observed_coverage, 'horses': len(holdout_samples)}}}
    fingerprint = digest({'base': base_model['id'], 'algorithm': 'runtime-v1', 'rows': rows})
    bundle['id'] = 'runtime-' + fingerprint[:12]; bundle['inputHash'] = fingerprint
    for key in types:
        bundle[key]['id'] = key + '-' + fingerprint[:12]
    return bundle
