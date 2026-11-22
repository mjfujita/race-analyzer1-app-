"""Browser ledger interchange: proposals never imply purchases or settlement."""
from __future__ import annotations

import json
import math
from itertools import permutations

from .ingest import canonical, digest, iso, race_date, ticket_key
from .group_plans import validate_group_plan


def _money(value, positive=False):
    return type(value) is int and value >= (100 if positive else 0) and value % 100 == 0


def _single_anchor_candidates(field, inputs, factor, threshold):
    if type(threshold) not in (int, float) or not math.isfinite(threshold) or not 0 <= threshold <= 1:
        raise ValueError('Invalid top-three threshold')
    release = inputs.get('releaseFieldSize', len(field))
    if type(release) is not int or not len(field) <= release <= 18:
        raise ValueError('Invalid place betting field size')
    places = inputs.get('placePositions')
    places = places if places is not None else (3 if release >= 8 else 2)
    if type(places) is not int or places not in (2, 3):
        raise ValueError('Invalid place betting field size')
    probabilities = {h['no']: h['probability'] for h in field}
    top3, place = dict.fromkeys(probabilities, 0.0), dict.fromkeys(probabilities, 0.0)
    total = 0.0
    for order in permutations(probabilities, min(3, len(field))):
        remaining, probability = list(probabilities), 1.0
        for no in order:
            probability *= probabilities[no] / sum(probabilities[n] for n in remaining)
            remaining.remove(no)
        total += probability
        for no in order:
            top3[no] += probability
        if release >= 5:
            for no in order[:places]:
                place[no] += probability
    quotes = {}
    source_quotes = inputs.get('quotes', [])
    if not isinstance(source_quotes, list) or any(not isinstance(quote, dict) for quote in source_quotes):
        raise ValueError('Place quotes must be an array of records')
    for quote in source_quotes:
        if quote.get('type') != '複勝' or not isinstance(quote.get('numbers'), list) or len(quote['numbers']) != 1:
            continue
        no, price, upper = quote['numbers'][0], quote.get('odds'), quote.get('upper')
        if type(no) is not int or no not in probabilities or type(price) not in (int, float) or not math.isfinite(price) or price < 1:
            continue
        if upper is not None and (type(upper) not in (int, float) or not math.isfinite(upper) or upper < price):
            continue
        if no in quotes:
            raise ValueError('Duplicate place quote')
        quotes[no] = price
    ranked = sorted(field, key=lambda h: (-min(1, top3[h['no']] / total), -h['probability'], h['no']))
    result = []
    for horse in ranked:
        no = horse['no']
        win_value = horse['probability'] * max(1, inputs['winOdds'][str(no)] * factor) > 1 + 1e-10
        place_value = no in quotes and release >= 5 and place[no] / total * max(1, quotes[no] * factor) > 1 + 1e-10
        if top3[no] / total + 1e-10 >= threshold and (win_value or place_value):
            result.append(no)
    return result[:2]


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
    groups = value.get('groupPlans', [])
    if not isinstance(groups, list) or len(groups) > 500:
        raise ValueError('Invalid group decisions')
    ids = set()
    for item in forecasts + groups + purchases + settlements:
        if not isinstance(item, dict) or not isinstance(item.get('id'), str) or not item['id'] or item['id'] in ids:
            raise ValueError('Ledger IDs must be nonempty and unique')
        ids.add(item['id'])
        iso(item.get('createdAt'))
    for plan in groups:
        validate_group_plan(plan, scope)
    by_forecast = {f['id']: f for f in forecasts + groups}
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
        selection = parameters.get('anchorSelection')
        if selection is not None:
            if not isinstance(selection, dict) or selection.get('method') not in ('win-value-two-v1', 'place-value-single-v2'):
                raise ValueError('Invalid anchor method')
            suggested, selected = selection.get('suggested'), selection.get('selected')
            factor, prices = parameters.get('oddsFactor'), inputs.get('winOdds')
            if type(factor) not in (int, float) or not math.isfinite(factor) or not 0.2 - 1e-12 <= factor <= 1 or not isinstance(prices, dict):
                raise ValueError('Invalid anchor prices')
            if any(type(prices.get(str(h['no']))) not in (int, float) or not math.isfinite(prices[str(h['no'])]) or prices[str(h['no'])] < 1 for h in field):
                raise ValueError('Complete anchor prices required')
            if selection['method'] == 'win-value-two-v1':
                for pair in (suggested, selected):
                    if not isinstance(pair, list) or len(pair) != 2 or any(type(n) is not int or n not in numbers for n in pair) or pair[0] == pair[1]:
                        raise ValueError('Two distinct forecast horses are required')
                ranked = sorted(field, key=lambda h: (-h['probability'], h['no']))
                qualifies = lambda h: h['probability'] * max(1, prices[str(h['no'])] * factor) > 1 + 1e-10
                expected = [h['no'] for h in ranked if qualifies(h)] + [h['no'] for h in ranked if not qualifies(h)]
                if suggested != expected[:2] or (forecast['kind'] == 'ace' and selected != suggested):
                    raise ValueError('Two-anchor selection does not match the frozen forecast')
            else:
                expected = _single_anchor_candidates(field, inputs, factor, selection.get('minTop3'))
                decision = selection.get('decision')
                if (not isinstance(suggested, list) or suggested != expected
                        or any(type(n) is not int for n in suggested)
                        or decision not in ('pending', 'selected', 'skip')
                        or (decision == 'selected' and (type(selected) is not int or selected not in suggested))
                        or (decision != 'selected' and selected is not None)
                        or (decision == 'pending' and not suggested)
                        or (forecast['kind'] == 'ace' and (selected is not None or decision != ('pending' if suggested else 'skip')))):
                    raise ValueError('Single-anchor selection does not match frozen conditions')
                reference = inputs.get('anchorTrendReference')
                if reference is not None:
                    if not isinstance(reference, dict):
                        raise ValueError('Invalid odds trend reference')
                    direct = reference.get('timingEvidence') == 'observed-visible-at' and reference.get('availabilityAt') == reference.get('retrievedAt')
                    if (reference.get('schemaVersion') != 2 or reference.get('kind') != 'observed'
                            or reference.get('raceId') != scope['raceId'] or race_date(reference.get('raceDate')) != race_date(scope['raceDate'])
                            or set(reference.get('odds', {})) != {str(no) for no in numbers}
                            or any(type(v) not in (int, float) or not math.isfinite(v) or v < 1 for v in reference['odds'].values())
                            or not iso(reference['observedAt']) < iso(inputs['observedAt'])
                            or not iso(reference['observedAt']) <= iso(reference['retrievedAt']) <= min(cutoff, iso(inputs['retrievedAt']))
                            or (reference.get('sourcePublishedAt') is None and not direct)
                            or (reference.get('sourcePublishedAt') is not None and not iso(reference['sourcePublishedAt']) <= iso(reference['observedAt']))):
                        raise ValueError('Invalid odds trend reference')
            if parameters['budget'] != 0 or forecast.get('allocations') != []:
                raise ValueError('Anchor assessment must not contain an allocated budget')
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
                            'forecasts': {}, 'purchases': {}, 'settlements': {}, 'groupPlans': {}}
        for field in ('forecasts', 'groupPlans', 'purchases', 'settlements'):
            for record in ledger.get(field, []):
                prior = grouped[key][field].get(record['id'])
                if prior is not None and canonical(prior) != canonical(record):
                    raise ValueError('Stored immutable ledger record has conflicting versions')
                grouped[key][field][record['id']] = record
    output = []
    for group in grouped.values():
        for field in ('forecasts', 'groupPlans', 'purchases', 'settlements'):
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
