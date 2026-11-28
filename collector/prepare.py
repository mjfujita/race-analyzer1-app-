"""Prepare a new local source DB from PACI files without changing the original."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import re
import shutil
import sqlite3
import subprocess
import tempfile
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from pipeline.run import write_json

IMPORTED_PREFIXES={'BAC','KYI','UKC','SED','ZED','CYB','KAB','CHA','KKA','SKB','ZKB'}

def extract_paci(paths, destination):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True);known={};dates=set();total=0
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            members=archive.infolist()
            if len(members)>1000 or sum(m.file_size for m in members)>100_000_000:raise ValueError('PACI archive exceeds limit')
            for member in members:
                name=Path(member.filename).name
                match=re.fullmatch(r'([A-Z]{2,3})(\d{6})\.txt',name,re.I)
                if not match:continue
                if member.is_dir() or member.file_size/max(1,member.compress_size)>500:raise ValueError('PACI member expansion limit')
                content=archive.read(member);name=name.upper().replace('.TXT','.txt');total+=len(content)
                if total>500_000_000:raise ValueError('PACI batch exceeds limit')
                if name in known and known[name]!=content:raise ValueError('Conflicting PACI file versions require separate runs')
                known[name]=content
                if match[1].upper()=='BAC':dates.add('20'+match[2])
    if not any(name.startswith('BAC') for name in known) or not any(name.startswith('KYI') for name in known):raise ValueError('PACI needs BAC and KYI files')
    # Never use the path stored inside an archive. All writes stay in the temporary extraction directory.
    for name,content in known.items():
        target=destination/name;target.write_bytes(content);target.chmod(0o600)
    # Preserve and account for EVERY text member, including formats not yet parsed.
    write_json(destination/'manifest.json',{'files':[{'name':name,'bytes':len(content),
        'rows':len([line for line in content.splitlines() if line]),'sha256':hashlib.sha256(content).hexdigest(),
        'handling':'database' if re.match(r'[A-Z]+',name)[0] in IMPORTED_PREFIXES else 'retained-only'}
        for name,content in sorted(known.items())]})
    return len(known),dates

def audit_history(db, extracted):
    """Reject missing or stale imported history before replacing the prepared DB."""
    paths=sorted(Path(extracted).glob('ZED*.txt'))+sorted(Path(extracted).glob('SED*.txt'))
    if not paths:raise ValueError('PACI has no ZED/SED history file; completeness cannot be verified')
    expected={}
    for path in paths:
        for line in path.read_bytes().splitlines():
            if not line:continue
            if len(line)<374:raise ValueError('Truncated ZED/SED history row')
            raw_key=line[:8].decode('ascii')
            # Match the installed importer's numeric kai/race convention for non-JRA records.
            # The untouched source key remains in the retained raw archive.
            race_key=raw_key[:4]+str(int(raw_key[4]) if raw_key[4].isdigit() else 0)+raw_key[5]+f'{int(raw_key[6:]) if raw_key[6:].isdigit() else 0:02d}'
            key=(race_key,line[10:18].decode('ascii').strip(),line[18:26].decode('ascii').strip())
            if not all(key) or not re.fullmatch(r'\d{8}',key[2]):raise ValueError('Invalid ZED/SED history identity')
            values=tuple(int(line[a:b].strip()) if line[a:b].strip() else None for a,b in ((62,66),(130,132),(140,142)))
            if key in expected and expected[key]!=values:raise ValueError('Conflicting ZED/SED history rows')
            expected[key]=values
    for key,values in expected.items():
        actual=db.execute('SELECT distance,field_size,rank FROM jrdb_results WHERE race_key=? AND ketto_id=? AND race_date=?',key).fetchall()
        if len(actual)!=1 or tuple(actual[0])!=values:raise ValueError('ZED/SED history import is incomplete or inconsistent')
    return {'expectedRows':len(expected),'verifiedRows':len(expected),'complete':True}

def prepare(source,backend,output,inbox,python=None):
    source=Path(source).expanduser().resolve(strict=True);backend=Path(backend).expanduser().resolve(strict=True)
    output=Path(output).expanduser().resolve();output.mkdir(parents=True,exist_ok=True);inbox=Path(inbox).expanduser()
    paths=sorted(p for p in inbox.iterdir() if p.is_file() and not p.is_symlink() and re.fullmatch(r'PACI\d{6}[^/]*\.zip',p.name,re.I))
    if not paths:raise ValueError('PACI年月日.zip is not present in the input directory')
    if source==output/'race.db':raise ValueError('Original and prepared database must differ')
    python=python or backend/'venv/bin/python'
    with tempfile.TemporaryDirectory(prefix='prepare-',dir=output) as temp:
        temp=Path(temp);files,dates=extract_paci(paths,temp/'extracted');destination=temp/'race.db'
        manifest=json.loads((temp/'extracted/manifest.json').read_text())
        raw_id=hashlib.sha256(json.dumps(manifest,sort_keys=True).encode()).hexdigest()
        retained=output/'raw'/raw_id
        if not retained.exists():shutil.copytree(temp/'extracted',retained)
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as original,sqlite3.connect(destination) as copy:original.backup(copy)
        destination.chmod(0o600)
        environment={**os.environ,'PYTHONPATH':str(backend),'PACI_STAGE':str(temp/'extracted'),'PACI_DATES':json.dumps(sorted(dates))}
        # History can change while evaluator_version stays unchanged. Rebuild the
        # affected meeting's cached evaluations inside the disposable copy only.
        program="""import os,json,sqlite3
from pathlib import Path
import import_jrdb
import_jrdb.EXTRACT_DIR=Path(os.environ['PACI_STAGE'])
import_jrdb.main()
with sqlite3.connect('race.db') as db:
 for date in json.loads(os.environ['PACI_DATES']):
  for table in ('race_evaluations','race_summaries'):
   if db.execute('SELECT 1 FROM sqlite_master WHERE type=\"table\" AND name=?',(table,)).fetchone():
    db.execute(f'DELETE FROM {table} WHERE race_key IN (SELECT race_key FROM jrdb_races WHERE race_date=?)',(date,))
import evaluate_all
evaluate_all.main()
"""
        run=subprocess.run([str(python),'-c',program],cwd=temp,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        log=output/'prepare.log';log.write_text(run.stdout);log.chmod(0o600)
        if run.returncode:raise ValueError('Legacy importer/evaluator failed; original DB is unchanged. See local prepare.log')
        with sqlite3.connect(destination) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Prepared DB integrity check failed')
            history=audit_history(db,temp/'extracted')
            for date in dates:
                races=db.execute('SELECT race_key,field_size FROM jrdb_races WHERE race_date=?',(date,)).fetchall()
                if not races:raise ValueError('Imported schedule is missing')
                for key,size in races:
                    entries=db.execute('SELECT COUNT(DISTINCT horse_no) FROM jrdb_entries WHERE race_key=?',(key,)).fetchone()[0]
                    payload=db.execute('SELECT payload FROM race_evaluations WHERE race_key=?',(key,)).fetchone()
                    if entries!=size or not payload or len(json.loads(payload[0]).get('horses',[]))!=size:raise ValueError('Prepared race or evaluation is incomplete')
        target=output/'race.db'
        if target.exists():
            backup=output/f"race.{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S')}.db.backup"
            shutil.copy2(target,backup);backup.chmod(0o600)
        os.replace(destination,target)
        report={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'sourceDb':str(source),'preparedDb':str(target),'zipFiles':len(paths),'textFiles':files,'dates':sorted(dates),'originalUnchanged':True,
                'historyAudit':history,'rawDirectory':str(retained),'files':manifest['files'],
                'retainedOnly':[f['name'] for f in manifest['files'] if f['handling']=='retained-only']}
        write_json(output/'prepared-source.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-db',default=str(Path.home()/'projects/backend/race.db'));p.add_argument('--backend',default=str(Path.home()/'projects/backend'))
    p.add_argument('--output',default=str(Path(__file__).parent/'state/derived'));p.add_argument('--inbox',default=str(Path.home()/'Downloads'));p.add_argument('--python')
    args=p.parse_args();print(json.dumps(prepare(args.source_db,args.backend,args.output,args.inbox,args.python),ensure_ascii=False))
