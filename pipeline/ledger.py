"""Browser ledger interchange: proposals never imply purchases or settlement."""
from __future__ import annotations

import json
import math

from .ingest import canonical, digest, iso, race_date, ticket_key


def _money(value, positive=False):
    return type(value) is int and value >= (100 if positive else 0) and value % 100 == 0


def _validate_ticket_field(ticket, field):
    if ticket['type'] != '枠連':
        if not set(ticket['numbers']) <= {horse['no'] for horse in field}:
            raise ValueError('Ticket contains a horse outside forecast field')
        return
    frames = [horse.get('frameNo') for horse in field]
    if any(type(frame) is not int or not 1 <= frame <= 8 for frame in frames):
        raise ValueError('Frame tickets require official frameNo for every horse')
    first, second = ticket['numbers']
    if first not in frames or second not in frames or (first == second and frames.count(first) < 2):
        raise ValueError('Frame ticket does not match forecast field')


def validate_ledger(value):
    if not isinstance(value, dict) or value.get('schemaVersion') != 1:
        raise ValueError('Ledger schemaVersion must be 1')
    scope = value.get('scope', {})
    if not all(isinstance(scope.get(k), str) and scope[k] and len(scope[k]) <= 200 for k in ('userId', 'raceId', 'raceDate')):
        raise ValueError('Ledger scope is required')
    race_date(scope['raceDate'])
    forecasts, purchases, settlements = [value.get(k) for k in ('forecasts', 'purchases', 'settlements')]
    if any(not isinstance(rows, list) or len(rows) > 500 for rows in (forecasts, purchases, settlements)):
        raise ValueError('Ledger arrays required')
    ids = set()
    for item in forecasts + purchases + settlements:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in ids:
            raise ValueError('Ledger IDs must be nonempty and unique')
        ids.add(item['id'])
        iso(item.get('createdAt'))
    by_forecast = {f['id']: f for f in forecasts}
    by_purchase = {p['id']: p for p in purchases}
    preceding_forecasts = {}
    for forecast in forecasts:
        if forecast.get('kind') not in ('ace', 'user') or forecast.get('mode') not in ('live', 'replay'):
            raise ValueError('Invalid forecast kind/mode')
        cutoff = iso(forecast.get('cutoffAt'))
        inputs = forecast.get('inputs', {})
        timestamps = {}
        visible = inputs.get('timingEvidence') == 'observed-visible-at' and inputs.get('availabilityAt') == inputs.get('retrievedAt')
        for field in ('observedAt', 'retrievedAt', 'sourcePublishedAt'):
            if inputs.get(field) is None and (forecast['mode'] == 'replay' or (field == 'sourcePublishedAt' and visible)):
                continue
            stamp = iso(inputs.get(field))
            timestamps[field] = stamp
            if forecast['mode'] == 'live' and stamp > cutoff:
                raise ValueError('Live forecast includes post-cutoff information')
        if forecast['mode'] == 'live' and not (timestamps.get('sourcePublishedAt', timestamps['observedAt']) <= timestamps['observedAt'] <= timestamps['retrievedAt'] <= iso(forecast['createdAt']) <= cutoff):
            raise ValueError('Live input timestamp ordering is invalid')
        if forecast.get('kind') == 'ace' and forecast.get('parentId') is not None:
            raise ValueError('ACE original cannot have a parent')
        if forecast.get('kind') == 'user' and preceding_forecasts.get(forecast.get('parentId'), {}).get('kind') != 'ace':
            raise ValueError('User forecast needs an earlier ACE original')
        if not isinstance(forecast.get('modelVersion'), str) or not forecast['modelVersion']:
            raise ValueError('Model version is required')
        parameters, field = forecast.get('parameters', {}), forecast.get('field')
        if type(parameters.get('budget')) is not int or parameters['budget'] < 0:
            raise ValueError('Invalid forecast budget')
        if not isinstance(field, list) or not 2 <= len(field) <= 18:
            raise ValueError('Forecast field is required')
        numbers = set()
        probability_sum = 0
        for horse in field:
            n, probability = horse.get('no'), horse.get('probability')
            if type(n) is not int or not 1 <= n <= 18 or n in numbers or type(probability) not in (int, float) or not math.isfinite(probability) or not 0 < probability <= 1:
                raise ValueError('Invalid forecast horse probability')
            numbers.add(n)
            probability_sum += probability
        if abs(probability_sum - 1) > 1e-6:
            raise ValueError('Forecast probabilities must sum to one')
        allocations = forecast.get('allocations')
        if not isinstance(allocations, list):
            raise ValueError('Forecast allocations required')
        keys = set()
        for ticket in allocations:
            key = ticket_key(ticket.get('type'), ticket.get('numbers', []))
            if key != ticket.get('key') or key in keys or not _money(ticket.get('stake'), True):
                raise ValueError('Invalid forecast allocation')
            _validate_ticket_field(ticket, field)
            keys.add(key)
        if sum(t['stake'] for t in allocations) > parameters['budget']:
            raise ValueError('Forecast exceeds budget')
        preceding_forecasts[forecast['id']] = forecast
    preceding_purchases, replaced_purchases = {}, set()
    for purchase in purchases:
        if purchase.get('forecastId') not in by_forecast:
            raise ValueError('Purchase does not refer to a forecast')
        tickets = purchase.get('tickets')
        if not isinstance(tickets, list):
            raise ValueError('Purchase tickets must be an array')
        seen = set()
        for ticket in tickets:
            key = ticket_key(ticket.get('type'), ticket.get('numbers', []))
            if key != ticket.get('key') or key in seen or not _money(ticket.get('stake'), True):
                raise ValueError('Invalid purchase ticket')
            _validate_ticket_field(ticket, by_forecast[purchase['forecastId']]['field'])
            seen.add(key)
        previous = purchase.get('replacesId')
        if previous is not None:
            old = preceding_purchases.get(previous)
            if not old or previous in replaced_purchases or old['forecastId'] != purchase['forecastId'] or iso(old['createdAt']) > iso(purchase['createdAt']):
                raise ValueError('Invalid purchase correction')
            replaced_purchases.add(previous)
        preceding_purchases[purchase['id']] = purchase
    preceding_settlements, replaced_settlements, settled_purchases = {}, set(), set()
    for settlement in settlements:
        purchase = by_purchase.get(settlement.get('purchaseId'))
        if not purchase:
            raise ValueError('Settlement does not refer to a purchase')
        payouts = settlement.get('payouts')
        expected = {t['key'] for t in purchase['tickets']}
        if not isinstance(payouts, dict) or set(payouts) != expected:
            raise ValueError('All purchased tickets need explicit payouts (0=miss,100=refund)')
        if any(type(v) is not int or v < 0 for v in payouts.values()):
            raise ValueError('Payouts must be nonnegative integer yen per100')
        previous = settlement.get('replacesId')
        if previous is not None:
            old = preceding_settlements.get(previous)
            if not old or previous in replaced_settlements or old['purchaseId'] != settlement['purchaseId'] or iso(old['createdAt']) > iso(settlement['createdAt']):
                raise ValueError('Invalid settlement correction')
            replaced_settlements.add(previous)
        elif settlement['purchaseId'] in settled_purchases:
            raise ValueError('An existing settlement must be corrected with replacesId')
        preceding_settlements[settlement['id']] = settlement
        settled_purchases.add(settlement['purchaseId'])
    return json.loads(canonical(value))


def summarize_ledger(ledger):
    validate_ledger(ledger)
    replaced_purchases = {p.get('replacesId') for p in ledger['purchases']}
    replaced_settlements = {s.get('replacesId') for s in ledger['settlements']}
    settled = {s['purchaseId']: s for s in sorted(ledger['settlements'], key=lambda s: s['createdAt'])
               if s['id'] not in replaced_settlements}
    total_staked = settled_staked = returned = count = 0
    pending = 0
    for purchase in ledger['purchases']:
        if purchase['id'] in replaced_purchases:
            continue
        stake = sum(t['stake'] for t in purchase['tickets'])
        total_staked += stake
        if purchase['id'] not in settled:
            pending += 1
            continue
        count += 1
        settled_staked += stake
        payouts = settled[purchase['id']]['payouts']
        returned += sum(t['stake'] * payouts[t['key']] / 100 for t in purchase['tickets'])
    return {'forecastCount': len(ledger['forecasts']), 'purchaseStake': total_staked,
            'settledPurchases': count, 'pendingPurchases': pending, 'settledStake': settled_staked,
            'returned': returned, 'profit': returned - settled_staked,
            'returnRate': returned / settled_staked if settled_staked else None}


def import_ledger(connection, document):
    ledger = validate_ledger(document)
    scope = ledger['scope']
    from .ingest import append_observations
    # Lock before reading: concurrent imports cannot both replace the same active record.
    with connection:
        if not connection.in_transaction:
            connection.execute('BEGIN IMMEDIATE')
        existing = connection.execute("SELECT payload FROM observations WHERE kind='LEDGER' AND race_id=? ORDER BY rowid", (scope['raceId'],))
        documents = [json.loads(row[0])['ledger'] for row in existing]
        _merge_ledgers([old for old in documents if old['scope'] == scope] + [ledger])
        payload = {'raceId': scope['raceId'], 'raceDate': scope['raceDate'], 'ledger': ledger}
        return append_observations(connection, [('LEDGER', payload, digest(payload), 'browser-ledger-json')], manage_transaction=False)


def _merge_ledgers(documents):
    grouped = {}
    for ledger in documents:
        key = canonical(ledger['scope'])
        if key not in grouped:
            grouped[key] = {'schemaVersion': 1, 'scope': ledger['scope'],
                            'forecasts': {}, 'purchases': {}, 'settlements': {}}
        for field in ('forecasts', 'purchases', 'settlements'):
            for record in ledger[field]:
                prior = grouped[key][field].get(record['id'])
                if prior is not None and canonical(prior) != canonical(record):
                    raise ValueError('Stored immutable ledger record has conflicting versions')
                grouped[key][field][record['id']] = record
    output = []
    for group in grouped.values():
        for field in ('forecasts', 'purchases', 'settlements'):
            group[field] = list(group[field].values())
        output.append(validate_ledger(group))
    return output


def saved_ledgers(connection):
    """Merge immutable records so importing an older export never loses newer events."""
    rows = connection.execute("SELECT payload FROM observations WHERE kind='LEDGER' ORDER BY rowid")
    return _merge_ledgers(json.loads(row[0])['ledger'] for row in rows)


def payout_suggestions(connection, ledger):
    validate_ledger(ledger)
    row = connection.execute("SELECT payload FROM observations WHERE kind='HJC' AND race_id=? AND race_date=? ORDER BY retrieved_at DESC,event_id DESC LIMIT 1",
                             (ledger['scope']['raceId'], ledger['scope']['raceDate'])).fetchone()
    if not row:
        return {'scope': ledger['scope'], 'status': 'missing-HJC', 'purchases': []}
    hjc = json.loads(row[0])
    if hjc['status'] != 'published':
        return {'scope': ledger['scope'], 'status': 'HJC-pending', 'purchases': []}
    payouts = {p['key']: p['per100'] for p in hjc['payouts']}
    replaced = {p.get('replacesId') for p in ledger['purchases']}
    suggestions = []
    for purchase in ledger['purchases']:
        if purchase['id'] in replaced:
            continue
        suggestions.append({'purchaseId': purchase['id'], 'payouts': {t['key']: payouts.get(t['key']) for t in purchase['tickets']},
                            'confirmationRequired': True,
                            'note': 'HJC lists winning payouts but has no refund field. Null needs explicit miss/refund confirmation.'})
    return {'scope': ledger['scope'], 'status': 'suggestions-only', 'purchases': suggestions}
