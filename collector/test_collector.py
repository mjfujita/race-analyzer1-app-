import copy
import json
import sqlite3
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest.mock import patch
from collector.persist import persist, bundle
from collector.prepare import extract_paci, audit_history, prepare
from pipeline.ingest import validate_snapshot, open_store, append_observations
from pipeline.ledger import validate_ledger
from pipeline.test_pipeline import snapshot_fixture, ledger_fixture

class CaptureTests(unittest.TestCase):
    def history_row(self):
        row=bytearray(b' '*374)
        for a,b,value in [(0,8,b'05265303'),(10,18,b'24100001'),(18,26,b'20261114'),(62,66,b'1600'),(130,132,b'14'),(140,142,b'02')]:row[a:b]=value
        return bytes(row)

    def test_zed_and_unparsed_text_are_retained_and_inventoried(self):
        with tempfile.TemporaryDirectory() as temp:
            archive=Path(temp)/'PACI261128.zip';out=Path(temp)/'out'
            with zipfile.ZipFile(archive,'w') as z:
                for name,content in [('BAC',b'core'),('KYI',b'core'),('ZED',self.history_row()),('JOA',b'unparsed')]:z.writestr(f'{name}261128.txt',content)
            count,dates=extract_paci([archive],out)
            self.assertEqual(count,4);self.assertEqual(dates,{'20261128'})
            files={f['name']:f for f in json.loads((out/'manifest.json').read_text())['files']}
            self.assertEqual((out/'ZED261128.txt').read_bytes(),self.history_row())
            self.assertEqual(files['ZED261128.txt']['handling'],'database')
            self.assertEqual(files['JOA261128.txt']['handling'],'retained-only')
            self.assertEqual(files['ZED261128.txt']['rows'],1)

    def test_history_audit_rejects_missing_wrong_and_truncated_rows(self):
        with tempfile.TemporaryDirectory() as temp,sqlite3.connect(':memory:') as db:
            db.execute('CREATE TABLE jrdb_results(race_key,ketto_id,race_date,distance,field_size,rank)')
            with self.assertRaisesRegex(ValueError,'no ZED/SED'):audit_history(db,temp)
            path=Path(temp)/'ZED261128.txt';path.write_bytes(self.history_row())
            with self.assertRaisesRegex(ValueError,'incomplete'):audit_history(db,temp)
            db.execute('INSERT INTO jrdb_results VALUES(?,?,?,?,?,?)',('05265303','24100001','20261114',1600,14,3))
            with self.assertRaisesRegex(ValueError,'inconsistent'):audit_history(db,temp)
            db.execute('UPDATE jrdb_results SET rank=2')
            self.assertEqual(audit_history(db,temp),{'expectedRows':1,'verifiedRows':1,'complete':True})
            path.write_bytes(b'short')
            with self.assertRaisesRegex(ValueError,'Truncated'):audit_history(db,temp)

    def test_failed_history_import_keeps_previously_prepared_database(self):
        from subprocess import CompletedProcess
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);source=root/'source.db';out=root/'out';out.mkdir();inbox=root/'inbox';inbox.mkdir()
            with sqlite3.connect(source) as db:db.execute('CREATE TABLE jrdb_results(race_key,ketto_id,race_date,distance,field_size,rank)')
            previous=b'previous validated database';(out/'race.db').write_bytes(previous)
            with zipfile.ZipFile(inbox/'PACI261128.zip','w') as z:
                for name,content in [('BAC',b'core'),('KYI',b'core'),('ZED',self.history_row())]:z.writestr(f'{name}261128.txt',content)
            with patch('collector.prepare.subprocess.run',return_value=CompletedProcess([],0,stdout='simulated skipped history')):
                with self.assertRaisesRegex(ValueError,'incomplete'):prepare(source,root,out,inbox,python='unused')
            self.assertEqual((out/'race.db').read_bytes(),previous)

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
