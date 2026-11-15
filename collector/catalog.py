"""Read the official local race catalog without changing its database."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from contextlib import closing
from pipeline.train import open_source
from pipeline.ingest import race_date

def catalog(source, date):
    race_date(date)
    with closing(open_source(source)) as db:
        races = []
        for row in db.execute('SELECT * FROM jrdb_races WHERE race_date=? ORDER BY post_time,place_code,race_no', (date,)):
            entries = [dict(entry) for entry in db.execute('SELECT horse_no,horse_name,ketto_id,idm,running_style FROM jrdb_entries WHERE race_key=? ORDER BY horse_no', (row['race_key'],))]
            if len(entries) != row['field_size'] or len({e['horse_no'] for e in entries}) != len(entries):
                continue
            horses=[];statistics=[]
            for entry in entries:
                past=[dict(p) for p in db.execute('SELECT race_key,race_date,going_code,surface_code,distance,rank,field_size,last_3f,front_3f FROM jrdb_results WHERE ketto_id=? AND race_date<? AND rank BETWEEN 1 AND field_size ORDER BY race_date DESC,race_key DESC LIMIT 5',(entry['ketto_id'],date))]
                past_runs=[{'date':p['race_date'],'raceDate':p['race_date'],'raceId':p['race_key'],'going':{'1':'良','2':'稍重','3':'重','4':'不良'}.get(str(p['going_code']),p['going_code']),
                    'surface':{'1':'芝','2':'ダート','3':'障害'}.get(str(p['surface_code']),p['surface_code']),'surfaceCode':p['surface_code'],
                    'dist':{'1':'芝','2':'ダート','3':'障害'}.get(str(p['surface_code']),'')+str(p['distance'])+'m','distance':p['distance'],
                    'rank':p['rank'],'field_size':p['field_size'],'placeCode':p['race_key'][:2],'last3f':p['last_3f'],'front3f':p['front_3f'],
                    'cornerPass4':None,'cornerDataStatus':'legacy-column-is-popularity-not-corner'} for p in past]
                counts={'horse_no':entry['horse_no'],'idm':entry['idm'],'running_style':entry['running_style'],'history_runs':len(past),'history_top3':sum(p['rank']<=3 for p in past)}
                for condition in ('distance','venue','course'):
                    matching=[p for p in past if p['surface_code']==row['surface_code'] and
                        ((p['distance'] is not None and row['distance'] is not None and abs(p['distance']-row['distance'])<=200) if condition=='distance' else
                         p['race_key'][:2]==row['place_code'] if condition=='venue' else p['race_key'][:2]==row['place_code'] and p['distance']==row['distance'])]
                    counts[condition+'_runs']=len(matching);counts[condition+'_top3']=sum(p['rank']<=3 for p in matching)
                statistics.append(counts)
                horses.append({'horseNo':entry['horse_no'],'no':entry['horse_no'],'name':entry['horse_name'],'idm':entry['idm'],'style':entry['running_style'],'pastRuns':past_runs})
            races.append({'raceId':row['race_key'],'raceDate':date,'postTime':row['post_time'],
                'fieldSize':row['field_size'],'placeCode':row['place_code'],'raceNo':row['race_no'],
                'surface':{'1':'芝','2':'ダート','3':'障害'}.get(str(row['surface_code']),row['surface_code']),'surfaceCode':row['surface_code'],'distance':row['distance'],'name':row['race_name'],
                'lr':{'1':'右','2':'左','3':'直'}.get(str(row['lr_code'])),'lrCode':row['lr_code'],
                'venue':{'01':'札幌','02':'函館','03':'福島','04':'新潟','05':'東京','06':'中山','07':'中京','08':'京都','09':'阪神','10':'小倉'}.get(row['place_code']),
                'horses':horses,'statistics':statistics})
        return races

if __name__ == '__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-db',default=str(Path.home()/'projects/backend/race.db'));p.add_argument('--date',required=True)
    a=p.parse_args();print(json.dumps({'races':catalog(a.source_db,a.date)},ensure_ascii=False))
