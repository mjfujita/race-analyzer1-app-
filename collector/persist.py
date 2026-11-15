"""Bridge verified browser captures into the append-only research store."""
from __future__ import annotations
import argparse
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from contextlib import closing
from pipeline.ingest import open_store, append_observations, import_snapshots, export_store, digest, canonical, iso
from pipeline.run import write_json
from .catalog import catalog
from pipeline.train import probabilities

def persist(path, captures):
    if not isinstance(captures, list) or len(captures)>100:
        raise ValueError('Capture list is required (maximum 100 races)')
    with closing(open_store(path)) as db:
        os.chmod(path,0o600)
        prepared=[];snapshots=[];fields={}
        for capture in captures:
            observation=capture.get('observation',{});payload=observation.get('payload',{})
            if observation.get('kind')!='LIVE_RACE' or not payload.get('raceId') or not payload.get('raceDate'):
                raise ValueError('A verified LIVE_RACE capture is required')
            iso(payload['retrievedAt'])
            if payload.get('timingEvidence')!='observed-visible-at' or payload.get('availabilityAt')!=payload['retrievedAt']:
                raise ValueError('Capture availability evidence is required')
            fields[payload['raceId']]=payload['activeHorseNumbers']
            prepared.append(('LIVE_RACE',payload,digest(payload),'browser-visible'))
            snapshots.extend(capture.get('snapshots',[]))
        # Re-reading the same historical table does not rewrite its first retrieval time.
        known={json.loads(row[0])['id']:json.loads(row[0]) for row in db.execute("SELECT payload FROM observations WHERE kind='ODDS'")}
        fresh=[]
        for snapshot in snapshots:
            if snapshot['id'] in known:
                old=known[snapshot['id']]
                if any(old.get(key)!=snapshot.get(key) for key in ('raceId','raceDate','odds','observedAt','sourcePublishedAt','source','kind')):
                    raise ValueError('Snapshot identifier conflict')
                continue
            known[snapshot['id']]=snapshot;fresh.append(snapshot)
        # Validate imports on a savepoint; no partial capture survives an invalid snapshot.
        with db:
            db.execute('SAVEPOINT capture_batch')
            try:
                n=append_observations(db,prepared,manage_transaction=False)
                # import_snapshots owns a connection transaction; validate first before mutation.
                from pipeline.ingest import validate_snapshot
                for row in fresh: validate_snapshot(row,fields[row['raceId']])
                items=[('ODDS',row,digest(row),'browser-visible') for row in fresh]
                n+=append_observations(db,items,manage_transaction=False)
                db.execute('RELEASE capture_batch')
            except Exception:
                db.execute('ROLLBACK TO capture_batch');db.execute('RELEASE capture_batch');raise
        return n

def bundle(source, output, date, status):
    output=Path(output)
    races=catalog(source,date);meta={row['raceId']:row for row in races}
    with closing(open_store(output/'market.sqlite')) as db:
        records=export_store(db)['observations']
    # Newly discovered official pages remain usable before the next PACI import.
    for event in records:
        row=event['payload']
        if event['kind']=='LIVE_RACE' and row.get('raceDate')==date and row.get('raceId') not in meta:
            meta[row['raceId']]={**row,'statistics':row.get('statistics',[])}
    grouped={}
    for event in records:
        payload=event['payload'];race_id=payload.get('raceId')
        if payload.get('raceDate')!=date or race_id not in meta:continue
        group=grouped.setdefault(race_id,[]);group.append(event)
    result=[]
    for race_id,race in meta.items():
        events=grouped.get(race_id,[])
        live=[event['payload'] for event in events if event['kind']=='LIVE_RACE']
        context=live[-1] if live else None
        result.append({'raceId':race_id,'raceDate':date,
            'race':{'id':race_id,'raceDate':date,'postTime':race['postTime'],'fieldSize':context['fieldSize'] if context else race['fieldSize'],
                    'releaseFieldSize':race['fieldSize'],'placeCode':race['placeCode'],'surface':race.get('surface'),'surfaceCode':race.get('surfaceCode'),'raceNo':race['raceNo'],
                    'name':race.get('name'),'distance':race.get('distance'),'venue':race.get('venue'),'lr':race.get('lr'),'lrCode':race.get('lrCode'),
                    'horses':[{**horse,'no':horse['horseNo'],'frameNo':next((h.get('frameNo') for h in (context or {}).get('horses',[]) if h['horseNo']==horse['horseNo']),None),
                               'cancelled':next((h.get('cancelled',False) for h in (context or {}).get('horses',[]) if h['horseNo']==horse['horseNo']),False)} for horse in race['horses']],
                    'statistics':race['statistics']},
            'snapshots':[event['payload'] for event in events if event['kind']=='ODDS'],
            # Owner ledgers are pulled into the research store, never echoed back as source observations.
            'observations':[event for event in events if event['kind'] in ('TYB','HJC','LIVE','LIVE_RACE','RESULT')][-2000:],
            'context':context,'results':context.get('results',[]) if context else []})
    def model(name):
        path=output/name
        return json.loads(path.read_text()) if path.exists() else None
    runtime=model('model.runtime.json')
    ability=runtime.get('baseModel') if runtime else model('model.conditions.json')
    for target in result:
        earlier=[]
        for previous in result:
            info=previous['race'];target_info=target['race']
            if info['placeCode']!=target_info['placeCode'] or info['surface']!=target_info['surface'] or str(info['postTime'])>=str(target_info['postTime']):continue
            time=str(target_info['postTime']).replace(':','').zfill(4)
            cutoff=datetime.strptime(date+time,'%Y%m%d%H%M').replace(tzinfo=timezone(timedelta(hours=9)))-timedelta(minutes=10)
            candidates=[e['payload'] for e in previous['observations'] if e['kind']=='LIVE_RACE' and e['payload'].get('results') and iso(e['payload']['retrievedAt'])<=cutoff]
            observed=max(candidates,key=lambda r:iso(r['retrievedAt'])) if candidates else previous['context']
            if not observed:continue
            winner=next((r['horseNo'] for r in observed.get('results',[]) if r['rank']==1),None)
            field=[h for h in info['horses'] if not h.get('cancelled')]
            if not winner or not field or any(not isinstance(h.get('idm'),(int,float)) for h in field):continue
            condition_counts=info.get('statistics',[])
            compatible=ability and ability.get('trainedThrough','').replace('-','')<date and len(condition_counts)==len(field)
            if compatible:
                rows={r['horse_no']:r for r in condition_counts};counts=[rows[h['horseNo']] for h in field]
                ps=probabilities({'idms':[h['idm'] for h in field],'conditionCounts':counts,'closingOdds':[1]*len(field)},'conditions',
                    temperature=ability['temperature'],coefficients=[ability['coefficients'][k] for k in ('distance','venue','course')],prior_rate=ability['featureSpec']['priorRate'])
            else:
                ps=probabilities({'idms':[h['idm'] for h in field],'closingOdds':[1]*len(field)},'ability',temperature=8)
            earlier.append({'raceId':previous['raceId'],'raceDate':date,'placeCode':info['placeCode'],'surface':info['surface'],'winnerNo':winner,
                'field':[{'no':h['horseNo'],'style':h.get('style',h.get('runningStyle')),'probability':p} for h,p in zip(field,ps)],
                'results':observed.get('results',[]),'retrievedAt':observed['retrievedAt'],'availabilityAt':observed['availabilityAt'],
                'timingEvidence':observed['timingEvidence'],'modelVersion':ability['id'] if compatible else 'idm-baseline-uncalibrated'})
        target['race']['earlierResults']=earlier
    return {'schemaVersion':1,'kind':'race-companion-bundle','generatedAt':status['lastRunAt'],'status':status,
            'models':{'abilityModel':ability,'runtimeModel':runtime},'races':result}

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['persist','bundle','ledger']);p.add_argument('--output',required=True)
    p.add_argument('--input');p.add_argument('--source-db');p.add_argument('--date');p.add_argument('--status')
    a=p.parse_args();output=Path(a.output);output.mkdir(parents=True,exist_ok=True)
    if a.action=='persist':
        if Path(a.input).stat().st_size>50_000_000:raise ValueError('Capture JSON too large')
        print(json.dumps({'added':persist(output/'market.sqlite',json.loads(Path(a.input).read_text()))}))
    elif a.action=='ledger':
        from pipeline.ledger import import_ledger
        incoming=json.loads(Path(a.input).read_text())
        if not isinstance(incoming,list) or len(incoming)>72:raise ValueError('Ledger batch limit')
        with closing(open_store(output/'market.sqlite')) as db:
            print(json.dumps({'added':sum(import_ledger(db,record) for record in incoming)}))
    else:
        status=json.loads(Path(a.status).read_text());data=bundle(a.source_db,output,a.date,status)
        write_json(output/'companion.bundle.json',data);print(json.dumps({'races':len(data['races']),'file':str(output/'companion.bundle.json')}))
