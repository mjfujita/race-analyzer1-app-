"""Validate human group decisions without converting them into probability training rows."""
import math
from datetime import timedelta
from itertools import product
from .ingest import iso, ticket_key


def validate_group_plan(p, scope):
    def require(ok):
        if not ok:
            raise ValueError('Invalid group decision')

    require(p.get('method') == 'odds-gap-v1' and p.get('mode') in ('live', 'replay'))
    require(p.get('race', {}).get('id') == scope['raceId'] and p['race'].get('raceDate') == scope['raceDate'])
    created, cutoff = iso(p['createdAt']), iso(p['cutoffAt'])
    field, snapshot, grouping = p['field'], p['snapshot'], p['grouping']
    require(isinstance(field, list) and 2 <= len(field) <= 18)
    numbers = [h['no'] for h in field]
    require(len(set(numbers)) == len(numbers) and all(type(n) is int and 1 <= n <= 18 for n in numbers))
    require(all(not h.get('cancelled') and isinstance(h.get('name'), str) and isinstance(h.get('evidence'), str) and len(h['evidence']) <= 4000 for h in field))
    require(snapshot['raceId'] == scope['raceId'] and snapshot['raceDate'].replace('-', '') == scope['raceDate'] and snapshot['kind'] == 'observed')
    odds = snapshot['odds']
    require(all(type(odds.get(str(n))) in (int, float) and math.isfinite(odds[str(n)]) and 1 <= odds[str(n)] <= 9999999 for n in numbers))
    threshold = grouping['threshold']
    require(type(threshold) in (int, float) and math.isfinite(threshold) and 1.1 <= threshold <= 5)
    rows = sorted([{'no': h['no'], 'name': h['name'], 'odds': odds[str(h['no'])]} for h in field], key=lambda h: (h['odds'], h['no']))
    automatic = [h['no'] for i, h in enumerate(rows) if i and h['odds'] / rows[i-1]['odds'] >= threshold - 1e-12]
    cuts = grouping['boundaries']
    require(isinstance(cuts, list) and len(set(cuts)) == len(cuts))
    require(all(any(i and h['no'] == n and h['odds'] != rows[i-1]['odds'] for i, h in enumerate(rows)) for n in cuts))
    require(grouping['automatic'] == automatic and (grouping['manual'] or cuts == automatic))
    groups = []
    for h in rows:
        if not groups or h['no'] in cuts:
            groups.append({'label': chr(65+len(groups)), 'horses': []})
        groups[-1]['horses'].append(h)
    membership = {str(h['no']): g['label'] for g in groups for h in g['horses']}
    require(grouping['groups'] == groups and grouping['membership'] == membership and grouping['complete'] is True and grouping['missing'] == [])
    reference = p.get('referenceSnapshot')
    if reference:
        require(iso(reference['observedAt']) < iso(snapshot['observedAt']) and iso(reference['retrievedAt']) <= iso(snapshot['retrievedAt']))
        require(p['referenceGrouping']['threshold'] == threshold and p['referenceGrouping']['manual'] is False)
        # Reuse the same validator for the frozen earlier grouping, without evaluating a new bet.
        validate_group_plan({**p, 'snapshot': reference, 'grouping': p['referenceGrouping'],
                             'referenceSnapshot': None, 'referenceGrouping': None, 'mode': 'replay',
                             'decision': 'skip', 'allocations': [], 'invested': 0, 'unspent': p['budget'],
                             'pricedCount': 0, 'minimumConditionalPayout': None, 'quotes': [],
                             'slots': [[g['label'] for g in p['referenceGrouping']['groups']]] * 3}, scope)
    else:
        require(p.get('referenceGrouping') is None)
    slots, excluded = p['slots'], p['excluded']
    require(isinstance(slots, list) and len(slots) == 3 and all(isinstance(s, list) and all(label in [g['label'] for g in groups] for label in s) for s in slots))
    require(isinstance(excluded, list) and len(set(excluded)) == len(excluded) and set(excluded) <= set(numbers))
    variant, decision = p['variant'], p['decision']
    require(variant in ('ordered', 'swapped', 'trio', 'exacta') and decision in ('plan', 'skip'))
    if variant == 'swapped':
        slots = [slots[0], slots[2], slots[1]]
    kind = {'trio': '3連複', 'exacta': '馬単'}.get(variant, '3連単')
    pools = [[h['no'] for g in groups if g['label'] in s for h in g['horses'] if h['no'] not in excluded] for s in slots]
    tickets = {}
    for ns in product(*pools[:2] if kind == '馬単' else pools):
        if len(set(ns)) != len(ns):
            continue
        ns = sorted(ns) if kind == '3連複' else list(ns)
        key = ticket_key(kind, ns)
        tickets[key] = {'type': kind, 'numbers': ns, 'key': key}
    budget, unit, overrides = p['budget'], p['unit'], p['overrides']
    require(type(budget) is int and 0 <= budget <= 10000 and budget % 100 == 0)
    require(type(unit) is int and 100 <= unit <= 10000 and unit % 100 == 0 and isinstance(overrides, dict))
    allocations = []
    for key, t in tickets.items():
        stake = overrides.get(key, unit)
        require(type(stake) is int and 0 <= stake <= 10000 and stake % 100 == 0)
        if stake and decision == 'plan':
            allocations.append({**t, 'stake': stake})
    require(p['allocations'] == allocations and (decision == 'skip' or len(allocations) > 0))
    invested = sum(t['stake'] for t in allocations)
    require(invested <= budget and p['invested'] == invested and p['unspent'] == budget-invested and p['overBudget'] is False)
    require(p['expectedReturn'] is None and p['hitProbability'] is None and isinstance(p['note'], str) and len(p['note']) <= 4000)
    quotes = p['quotes']
    require(isinstance(quotes, list) and len(quotes) <= 5000)
    prices = {}
    for q in quotes:
        require(q['type'] in ('3連単', '3連複', '馬単') and set(q['numbers']) <= set(numbers))
        key = ticket_key(q['type'], q['numbers'])
        require(key not in prices and type(q['odds']) in (int, float) and math.isfinite(q['odds']) and 1 <= q['odds'] <= 9999999)
        prices[key] = q['odds']
    payouts = [math.floor(t['stake'] * prices[t['key']]) for t in allocations if t['key'] in prices]
    require(p['pricedCount'] == len(payouts) and p['minimumConditionalPayout'] == (min(payouts) if payouts and len(payouts) == len(allocations) else None))
    if p['mode'] == 'live':
        observed, retrieved = iso(snapshot['observedAt']), iso(snapshot['retrievedAt'])
        direct = snapshot.get('timingEvidence') == 'observed-visible-at' and snapshot.get('availabilityAt') == snapshot['retrievedAt']
        require(snapshot.get('sourcePublishedAt') is not None or direct)
        published = iso(snapshot['sourcePublishedAt']) if snapshot.get('sourcePublishedAt') else observed
        require(published <= observed <= retrieved <= created <= cutoff and cutoff-observed <= timedelta(minutes=20))
        if quotes:
            require(iso(p['quoteObservedAt']) <= iso(p['quoteRetrievedAt']) <= created)
    return p
