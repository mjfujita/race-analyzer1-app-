"""Join immutable forecasts to outcomes and gate a versioned win-probability calibrator."""
from collections import Counter, defaultdict
from datetime import timedelta
import json
import math

from .ingest import JST, append_observations, canonical, digest, iso, now_iso
from .jrdb_files import FILE_KINDS, METADATA, RESULTS

TEMPERATURES = (1, 0.8, 1.25, 0.67, 1.5, 0.5, 2.0)
FIT_RACES, FIT_DAYS = 40, 10
BACKTEST_RACES, BACKTEST_DAYS = 20, 5
GATE_RACES, GATE_DAYS = 20, 5
MONITOR_RACES, MONITOR_DAYS = 12, 3
MIN_IMPROVEMENT = 0.001


def import_receipts(connection, ledger, receipts):
    """Only the authenticated companion pull calls this; generic ledger imports cannot attest receipt."""
    scope = ledger['scope']
    forecasts = {record['id']: record for record in ledger['forecasts']}
    items = []
    if not isinstance(receipts, list) or len(receipts) > len(forecasts):
        raise ValueError('Invalid receipt batch')
    for receipt in receipts:
        record = forecasts.get(receipt.get('forecastId'))
        if (not record or record['kind'] != 'ace' or record['mode'] != 'live'
                or receipt.get('schemaVersion') != 1 or receipt.get('ownerId') != scope['userId']
                or any(receipt.get(k) != scope[k] for k in ('raceId', 'raceDate'))
                or receipt.get('sourceId') != record['inputs'].get('sourceId')
                or iso(receipt['cutoffAt']) != iso(record['cutoffAt'])
                or not iso(record['createdAt']) <= iso(receipt['receivedAt']) <= iso(receipt['cutoffAt'])):
            raise ValueError('Receipt does not attest a matching pre-cutoff forecast')
        items.append(('FORECAST_RECEIPT', receipt, digest(receipt), 'owner-companion'))
    return append_observations(connection, items)


def latest_value(events, extract):
    """Retain first availability of the currently observed value. Simultaneous conflicts are unresolved."""
    by_time = defaultdict(dict)
    for event in events:
        value = extract(event['payload'])
        if value is not None:
            by_time[iso(event['retrievedAt'])][canonical(value)] = value
    current, since = None, None
    for time, values in sorted(by_time.items()):
        value = next(iter(values.values())) if len(values) == 1 else []
        if current != value:
            current, since = value, time
    return current, since


def standing_rows(payload):
    rows = payload['records']
    # An explicit record of a scratch/abnormal finish prevents silently shrinking the sample.
    normal = all(row['abnormalCode'] in ('0', '') and row['fieldSize'] == len(rows) for row in rows)
    return sorted([[r['horseNo'], r['rank']] for r in rows], key=lambda r: r[0]) if normal else []


def browser_rows(payload):
    if not payload.get('results') or payload.get('priceStatus') != 'final-visible':
        return None
    results = payload['results']
    if (len(results) != payload.get('releaseFieldSize') or len(results) != len(payload.get('activeHorseNumbers', []))
            or any(horse.get('cancelled') for horse in payload.get('horses', []))):
        return []
    return sorted([[r['horseNo'], r['rank']] for r in results])


def win_payout(payload):
    payouts = sorted({(p['numbers'][0], p['per100']) for p in payload.get('payouts', []) if p['type'] == '単勝'})
    return [list(p) for p in payouts] if payouts else None


def race_outcome(events, numbers, post_at, generated_at):
    by_kind = defaultdict(list)
    for event in events:
        retrieved = iso(event['retrievedAt'])
        if post_at <= retrieved <= generated_at:
            by_kind[event['kind']].append(event)
    formats = ((kind, by_kind[kind], standing_rows) for kind in ('SED', 'SEC'))
    ranked = [(kind, *latest_value(rows, parser)) for kind, rows, parser in formats]
    live = by_kind['LIVE_RACE']
    indexed = latest_value(live, browser_rows)
    first = next((item for item in ranked if item[1] is not None), ('LIVE', *indexed))
    source, ranks, rank_at = first
    if ranks is None:
        return 'awaiting-results', [], None, None
    if (len(ranks) != len(numbers) or {row[0] for row in ranks} != set(numbers)
            or any(type(row[1]) is not int for row in ranks)
            or sorted(row[1] for row in ranks) != list(range(1, len(numbers) + 1))):
        return 'incomplete-or-abnormal', ranks, None, None
    winner = next(no for no, rank in ranks if rank == 1)
    live_payout_rows = [event for event in live if event['payload'].get('priceStatus') == 'final-visible']
    paid, paid_at = latest_value([*by_kind['HJC'], *live_payout_rows], win_payout)
    if paid is None:
        return 'awaiting-payout', ranks, None, source
    # A more recent standings correction must agree before either version is evaluated.
    conflicting = any(other is not None and other_at >= rank_at and other != ranks
                      for other, other_at in [(item[1], item[2]) for item in ranked if item[0] != source]
                                              + ([indexed] if source != 'LIVE' else []))
    if len(paid) != 1 or paid[0][0] != winner or conflicting:
        return 'result-conflict', ranks, None, source
    return 'matched', ranks, max(rank_at, paid_at), source


def valid_probabilities(values):
    return (len(values) >= 2 and all(type(p) in (int, float) and math.isfinite(p) and 0 < p < 1 for p in values)
            and abs(sum(values) - 1) <= 1e-6)


def collect(ledgers, observations, generated_at):
    events, references, receipts, counts = defaultdict(list), defaultdict(list), {}, Counter()
    for event in observations:
        kind, row = event['kind'], event['payload']
        if kind in FILE_KINDS:
            counts[kind] += row.get('recordCount', 1)
        if kind in METADATA:
            references[(row['raceDate'], row['raceId'])].append(event)
        if kind in (*RESULTS, 'HJC', 'LIVE_RACE'):
            events[(row['raceDate'], row['raceId'])].append(event)
        if kind == 'FORECAST_RECEIPT':
            key = (row['ownerId'], row['raceDate'], row['raceId'], row['forecastId'])
            if key in receipts and receipts[key] != row:
                raise ValueError('Conflicting immutable forecast receipts')
            receipts[key] = row

    display, samples = [], []
    for ledger in ledgers:
        scope = ledger['scope']
        race_key = (scope['raceDate'], scope['raceId'])
        original = [r for r in ledger['forecasts'] if r['kind'] == 'ace']
        if not original:
            continue
        def receipt(record):
            return receipts.get((scope['userId'], *race_key, record['id']))
        original.sort(key=lambda r: (not bool(receipt(r)), iso((receipt(r) or {}).get('receivedAt', r['createdAt'])), r['id']))
        record = original[0]
        received = receipt(record)
        field = sorted(record['field'], key=lambda h: h['no'])
        numbers = [h['no'] for h in field]
        cutoff = iso(record['cutoffAt'])
        state, ranks, available, source = race_outcome(events[race_key], numbers, cutoff + timedelta(minutes=10), generated_at)
        raw = [h.get('pStar') for h in field]
        shown = [h['probability'] for h in field]
        stack = record['inputs'].get('probabilityStack')
        calibration = record['inputs'].get('probabilityCalibration')
        winner = next((no for no, rank in ranks if rank == 1), None)
        if sum(rank == 1 for _, rank in ranks) != 1:
            winner = None
        meeting_key = (race_key[0], race_key[1][:6])
        supporting = [*references[race_key], *references[meeting_key]]
        latest_by_kind = {event['kind']: event['payload'] for event in sorted(supporting, key=lambda event: iso(event['retrievedAt']))}
        reference = {kind: payload['records'][0] if kind != 'KTA' else {'registeredCount': payload['recordCount']}
                     for kind, payload in latest_by_kind.items() if payload['records'] or kind == 'KTA'}
        outcome = {'references': reference, 'raceId': race_key[1], 'raceDate': race_key[0], 'state': state, 'source': source,
                   'forecastId': record['id'], 'modelVersion': record['modelVersion'],
                   'calibrationId': calibration, 'mode': record['mode'], 'verified': received is not None,
                   'winnerNo': winner, 'topPick': max(field, key=lambda h: h['probability'])['no'],
                   'field': [{'no': h['no'], 'probability': h['probability'], 'rank': dict(ranks).get(h['no'])} for h in field]}
        display.append(outcome)
        if (state == 'matched' and received and isinstance(stack, str) and 0 < len(stack) <= 800
                and valid_probabilities(raw) and iso(received['receivedAt']) <= cutoff):
            samples.append({'raceKey': '/'.join(race_key), 'id': record['id'], 'date': race_key[0], 'cutoff': cutoff,
                            'available': available, 'stack': stack, 'p': raw, 'shown': shown,
                            'winner': numbers.index(winner), 'fingerprint': digest([record['id'], ranks, raw, stack])})
    return display, samples, dict(sorted(counts.items()))


def calibrated(probabilities, temperature):
    logits = [math.log(p) / temperature for p in probabilities]
    high = max(logits)
    weights = [math.exp(logit - high) for logit in logits]
    return [weight / sum(weights) for weight in weights]


def metrics(rows, predictions):
    if not rows:
        return None
    loss = brier = hits = 0
    bins = [[0, 0.0, 0] for _ in range(10)]
    for row, probabilities in zip(rows, predictions, strict=True):
        winner = row['winner']
        loss -= math.log(max(1e-15, probabilities[winner]))
        hits += max(range(len(probabilities)), key=probabilities.__getitem__) == winner
        for index, p in enumerate(probabilities):
            won = int(index == winner)
            brier += (won - p) ** 2
            bucket = bins[min(9, int(10 * p))]
            bucket[0] += 1
            bucket[1] += p
            bucket[2] += won
    n = len(rows)
    return {'races': n, 'logLoss': loss / n, 'brier': brier / n, 'topPickRate': hits / n,
            'bins': [{'lower': i / 10, 'count': count, 'predicted': total / count, 'actual': won / count}
                     for i, (count, total, won) in enumerate(bins) if count]}


def score(rows, temperature):
    return metrics(rows, (calibrated(row['p'], temperature) for row in rows))


def compare(rows, temperature, incumbent=1):
    return {'before': score(rows, 1), 'after': score(rows, temperature), 'incumbent': score(rows, incumbent)}


def has_sample(rows, races, days):
    return len(rows) >= races and len({row['date'] for row in rows}) >= days


def fit(rows):
    return min(TEMPERATURES, key=lambda t: round(score(rows, t)['logLoss'], 10))


def eligible_training(rows, test):
    first_date = min(row['date'] for row in test)
    first_cutoff = min(row['cutoff'] for row in test)
    return [row for row in rows if row['date'] < first_date and row['available'] < first_cutoff]


def walk_forward(rows):
    days = defaultdict(list)
    for row in rows:
        days[row['date']].append(row)
    tested, predictions, folds = [], [], []
    for day, today in sorted(days.items()):
        train = eligible_training(rows, today)
        if not has_sample(train, BACKTEST_RACES, BACKTEST_DAYS):
            continue
        temperature = fit(train)
        folds.append({'date': day, 'trainingRaces': len(train), 'testRaces': len(today), 'temperature': temperature})
        tested.extend(today)
        predictions.extend(calibrated(row['p'], temperature) for row in today)
    return {'days': len(folds), 'folds': folds[-20:], 'before': score(tested, 1), 'after': metrics(tested, predictions)}


def gate_block(rows, since, min_races, min_days):
    """Take the earliest complete block after the last consumed day, including its entire final race day."""
    days = sorted({row['date'] for row in rows if row['date'] > since})
    for day in days[min_days - 1:]:
        candidate = [row for row in rows if since < row['date'] <= day]
        if len(candidate) >= min_races:
            return candidate, day
    return [], since


def degraded(comparison):
    before, after = comparison['before'], comparison['after']
    return after['logLoss'] > before['logLoss'] + 1e-9 or after['brier'] > before['brier'] + 1e-9


def passes(comparison):
    after = comparison['after']
    return all(after['logLoss'] <= comparison[key]['logLoss'] - MIN_IMPROVEMENT
               and after['brier'] <= comparison[key]['brier'] + 1e-9 for key in ('before', 'incumbent'))


def update_stack(state, rows, timestamp):
    state = dict(state)
    active = state.get('active')
    by_key = {row['raceKey']: row['fingerprint'] for row in rows}
    if active and any(by_key.get(key) != value for key, value in state['evidence'].items()):
        return {**state, 'active': None, 'status': 'paused-correction',
                'through': max(state['through'], max((r['date'] for r in rows), default=''))}, None
    after = state.get('through', '')
    if active:
        activation = iso(active['activatedAt'])
        after = max(after, activation.astimezone(JST).strftime('%Y%m%d'))
        prospective = [row for row in rows if row['cutoff'] > activation]
        monitor, day = gate_block(prospective, state.get('monitoredThrough', after), MONITOR_RACES, MONITOR_DAYS)
        while monitor:
            comparison = compare(monitor, active['temperature'])
            state.update(monitoredThrough=day, monitor=comparison)
            if degraded(comparison):
                return {**state, 'active': None, 'status': 'paused-degradation',
                        'through': max(day, state.get('through', ''))}, None
            state['evidence'] = {**state['evidence'], **{r['raceKey']: r['fingerprint'] for r in monitor}}
            monitor, day = gate_block(prospective, day, MONITOR_RACES, MONITOR_DAYS)

    days = sorted({r['date'] for r in rows if r['date'] > after})
    gate, train, through = [], [], after
    # Start at the first day with a usable point-in-time training set, then consume exactly one fresh gate.
    for first in days:
        available = [row for row in rows if row['date'] >= first]
        trial, end = gate_block(available, after, GATE_RACES, GATE_DAYS)
        if not trial:
            break
        earlier = eligible_training(rows, trial)
        if has_sample(earlier, FIT_RACES, FIT_DAYS):
            gate, train, through = trial, earlier, end
            break
    if not gate:
        return state, None
    temperature = fit(train)
    before = active['temperature'] if active else 1
    comparison = compare(gate, temperature, before)
    adopted = passes(comparison)
    data = {r['raceKey']: r['fingerprint'] for r in [*train, *gate]}
    version = {'schemaVersion': 1, 'algorithm': 'win-temperature-v1', 'stack': rows[0]['stack'],
               'id': 'win-temp-' + digest([rows[0]['stack'], temperature, data, through])[:24],
               'temperature': temperature, 'createdAt': timestamp, 'activatedAt': timestamp if adopted else None,
               'trainedThrough': max(r['date'] for r in train), 'testedThrough': through, 'decision': 'adopted' if adopted else 'rejected',
               'evaluation': comparison, 'walkForward': walk_forward(train)}
    state.update(through=through, latest=version, status='active' if active or adopted else 'rejected')
    if adopted:
        state.update(active=version, evidence=data, monitoredThrough=max(through, iso(timestamp).astimezone(JST).strftime('%Y%m%d')), monitor=None)
    return state, version


def run_review(connection, timestamp=None):
    from .ingest import export_store
    from .ledger import saved_ledgers
    with connection:
        connection.execute('BEGIN IMMEDIATE')
        timestamp = timestamp or now_iso()
        ledgers = saved_ledgers(connection)
        display, samples, counts = collect(ledgers, export_store(connection)['observations'], iso(timestamp))
        groups = defaultdict(list)
        owners = {ledger['scope']['userId'] for ledger in ledgers}
        if len(owners) > 1:
            raise ValueError('Forecast review requires a single owner per research store')
        for sample in sorted(samples, key=lambda row: (row['date'], row['cutoff'], row['raceKey'])):
            groups[sample['stack']].append(sample)
        connection.execute('CREATE TABLE IF NOT EXISTS calibration_state (stack TEXT PRIMARY KEY, state TEXT NOT NULL)')
        connection.execute('CREATE TABLE IF NOT EXISTS calibration_versions (id TEXT PRIMARY KEY, version TEXT NOT NULL)')
        known = {stack: json.loads(state) for stack, state in connection.execute('SELECT stack,state FROM calibration_state')}
        for stack in groups.keys() | known.keys():
            state, version = update_stack(known.get(stack, {}), groups[stack], timestamp)
            if state:
                connection.execute('INSERT INTO calibration_state VALUES (?,?) ON CONFLICT(stack) DO UPDATE SET state=excluded.state',
                                   (stack, canonical(state)))
                known[stack] = state
            if version:
                connection.execute('INSERT OR IGNORE INTO calibration_versions VALUES (?,?)', (version['id'], canonical(version)))
        version_history = [json.loads(row[0]) for row in connection.execute(
            'SELECT version FROM calibration_versions ORDER BY rowid DESC LIMIT 20')]
    active = [state['active'] for state in known.values() if state.get('active')]
    return {'schemaVersion': 1, 'generatedAt': timestamp, 'ownerId': next(iter(owners), None), 'sourceCounts': counts,
            'totalForecasts': len(display), 'eligibleRaces': len(samples), 'states': dict(Counter(row['state'] for row in display)),
            'actual': metrics(samples, (row['shown'] for row in samples)),
            'races': sorted(display, key=lambda r: (r['raceDate'], r['raceId']), reverse=True)[:48],
            'active': sorted(active, key=lambda v: v['activatedAt'], reverse=True)[:8],
            'versions': version_history,
            'statesByStack': [{'stack': stack, 'status': v['status'], 'monitor': v.get('monitor'),
                               'activeId': (v.get('active') or {}).get('id')} for stack, v in sorted(known.items()) if v][:20]}
