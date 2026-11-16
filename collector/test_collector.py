import copy
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from collector.persist import persist, bundle
from collector.prepare import extract_paci
from pipeline.ingest import validate_snapshot, open_store, append_observations
from pipeline.ledger import validate_ledger
from pipeline.test_pipeline import snapshot_fixture, ledger_fixture

class CaptureTests(unittest.TestCase):
    def test_pulled_ledgers_stay_in_research_and_are_not_echoed_as_observations(self):
        with tempfile.TemporaryDirectory() as temp:
            race={'raceId':'05261101','raceDate':'20261115','postTime':'1540','fieldSize':2,'placeCode':'05','raceNo':1,'horses':[],'statistics':[]}
            with open_store(Path(temp)/'market.sqlite') as db:
                append_observations(db,[('TYB',{'raceId':race['raceId'],'raceDate':race['raceDate']},'source','official'),
                                        ('LEDGER',{'raceId':race['raceId'],'raceDate':race['raceDate'],'ledger':{}},'owner-ledger','owner')])
            with patch('collector.persist.catalog',return_value=[race]):
                exported=bundle('unused',temp,'20261115',{'lastRunAt':'2026-11-15T07:00:00Z'})
            self.assertEqual([e['kind'] for e in exported['races'][0]['observations']],['TYB'])
            with sqlite3.connect(Path(temp)/'market.sqlite') as db:
                self.assertEqual(db.execute("SELECT count(*) FROM observations WHERE kind='LEDGER'").fetchone()[0],1)

    def test_pace_bundle_keeps_both_surfaces_and_both_cutoff_versions_without_idm(self):
        date = '20261115'
        def race(no, time, surface, place='08'):
            return {'raceId': f'{place}2654{no:02}', 'raceDate': date, 'postTime': time, 'fieldSize': 12,
                    'placeCode': place, 'raceNo': no, 'surface': '芝' if surface == '1' else 'ダート',
                    'surfaceCode': surface, 'distance': 1800, 'horses': [], 'statistics': []}
        dirt, turf, target, later, other = [
            race(1, '1300', '2'), race(2, '1330', '1'), race(3, '1430', '1'),
            race(4, '1500', '2'), race(1, '1300', '1', '05')]
        def capture(info, time, ranks):
            row = {**info, 'fieldSize': 11, 'retrievedAt': time, 'resultsRetrievedAt': time, 'availabilityAt': time,
                   'timingEvidence': 'observed-visible-at', 'results':
                       [{'horseNo': rank + 2, 'rank': rank, 'cornerPass4': corner} for rank, corner in enumerate(ranks, 1)]}
            return ('LIVE_RACE', row, f"{info['raceId']}:{time}", 'test')
        with tempfile.TemporaryDirectory() as temp:
            with open_store(Path(temp) / 'market.sqlite') as store:
                append_observations(store, [
                    capture(dirt, '2026-11-15T04:15:00Z', [1, 3, 7]),
                    capture(dirt, '2026-11-15T05:22:00Z', [2, 3, 7]),
                    capture(dirt, '2026-11-15T05:25:00Z', [None, 3, 7]),
                    capture(turf, '2026-11-15T05:24:00Z', [4, 4, 5]),
                    capture(later, '2026-11-15T06:15:00Z', [1, 3, 7]),
                    capture(other, '2026-11-15T04:15:00Z', [1, 3, 7]),
                ])
            with patch('collector.persist.catalog', return_value=[dirt, turf, target, later, other]):
                rows = bundle('unused', temp, date, {'lastRunAt': '2026-11-15T07:00:00Z'})['races']
        selected = rows[2]['race']
        self.assertEqual(selected['earlierResults'], [])
        pace = selected['earlierPaceResults']
        self.assertEqual([(r['raceNo'], r['surfaceCode'], r['fieldSize']) for r in pace], [(1, '2', 11), (1, '2', 11), (2, '1', 11)])
        self.assertEqual([r['results'][0]['cornerPass4'] for r in pace], [1, 2, 4])

    def test_visible_snapshot_needs_explicit_available_at_evidence(self):
        s=snapshot_fixture();s['sourcePublishedAt']=None
        with self.assertRaises(ValueError):validate_snapshot(s,[1,2])
        s.update(timingEvidence='observed-visible-at',availabilityAt=s['retrievedAt'])
        validate_snapshot(s,[1,2])
        s['availabilityAt']='2026-11-15T01:00:00Z'
        with self.assertRaises(ValueError):validate_snapshot(s,[1,2])

    def test_visible_live_ledger_does_not_invent_publication(self):
        l=ledger_fixture();f=l['forecasts'][0];f['mode']='live';f['createdAt']='2026-11-15T06:15:00Z';f['cutoffAt']='2026-11-15T06:20:00Z'
        f['inputs']={'observedAt':'2026-11-15T06:10:00Z','retrievedAt':'2026-11-15T06:11:00Z','sourcePublishedAt':None,'timingEvidence':'observed-visible-at','availabilityAt':'2026-11-15T06:11:00Z'}
        validate_ledger(l)
        f['inputs']['availabilityAt']='2026-11-15T06:09:00Z'
        with self.assertRaises(ValueError):validate_ledger(l)

    def test_invalid_capture_snapshots_roll_back_the_whole_batch(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'store.sqlite'
            capture={'observation':{'kind':'LIVE_RACE','payload':{'raceId':'05261101','raceDate':'20261115','retrievedAt':'2026-11-15T06:10:00Z','availabilityAt':'2026-11-15T06:10:00Z','timingEvidence':'observed-visible-at','activeHorseNumbers':[1,2]}},'snapshots':[snapshot_fixture()]}
            bad=copy.deepcopy(capture);bad['snapshots'][0]['odds']={'1':3}
            with self.assertRaises(ValueError):persist(path,[bad])
            with sqlite3.connect(path) as db:self.assertEqual(db.execute('SELECT count(*) FROM observations').fetchone()[0],0)
            self.assertEqual(persist(path,[capture]),2)
            self.assertEqual(persist(path,[capture]),0)

    def test_paci_paths_are_flattened_and_missing_core_files_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            zip_path=Path(temp)/'PACI261115.zip';out=Path(temp)/'out'
            with zipfile.ZipFile(zip_path,'w') as archive:
                archive.writestr('../../BAC261115.txt',b'fiction');archive.writestr('x/KYI261115.txt',b'fiction')
            count,dates=extract_paci([zip_path],out)
            self.assertEqual(count,2);self.assertEqual(dates,{'20261115'})
            self.assertTrue((out/'BAC261115.txt').exists());self.assertFalse((Path(temp)/'BAC261115.txt').exists())
            with zipfile.ZipFile(zip_path,'w') as archive:archive.writestr('UKC261115.txt',b'fiction')
            with self.assertRaises(ValueError):extract_paci([zip_path],out)

    def test_conflicting_paci_versions_are_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as temp:
            files=[];out=Path(temp)/'out'
            for n in range(2):
                path=Path(temp)/f'PACI261115-{n}.zip';files.append(path)
                with zipfile.ZipFile(path,'w') as archive:
                    archive.writestr('BAC261115.txt',str(n));archive.writestr('KYI261115.txt','data')
            with self.assertRaises(ValueError):extract_paci(files,out)
            self.assertFalse((out/'BAC261115.txt').exists())
if __name__=='__main__':unittest.main()
