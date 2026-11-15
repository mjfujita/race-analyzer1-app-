"""Prepare a new local source DB from PACI files without changing the original."""
from __future__ import annotations
import argparse
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

PREFIXES={'BAC','KYI','UKC','SED','CYB','KAB','CHA','KKA','SKB','ZKB','HJC','TYB','OZ','OW','OU','OT','OV'}

def extract_paci(paths, destination):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True);known={};dates=set();total=0
    for path in paths:
        with zipfile.ZipFile(path) as archive:
            members=archive.infolist()
            if len(members)>1000 or sum(m.file_size for m in members)>100_000_000:raise ValueError('PACI archive exceeds limit')
            for member in members:
                name=Path(member.filename).name
                match=re.fullmatch(r'([A-Z]{2,3})(\d{6})\.txt',name,re.I)
                if not match or match[1].upper() not in PREFIXES:continue
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
    return len(known),dates

def prepare(source,backend,output,inbox,python=None):
    source=Path(source).expanduser().resolve(strict=True);backend=Path(backend).expanduser().resolve(strict=True)
    output=Path(output).expanduser().resolve();output.mkdir(parents=True,exist_ok=True);inbox=Path(inbox).expanduser()
    paths=sorted(p for p in inbox.iterdir() if p.is_file() and not p.is_symlink() and re.fullmatch(r'PACI\d{6}[^/]*\.zip',p.name,re.I))
    if not paths:raise ValueError('PACI年月日.zip is not present in the input directory')
    if source==output/'race.db':raise ValueError('Original and prepared database must differ')
    python=python or backend/'venv/bin/python'
    with tempfile.TemporaryDirectory(prefix='prepare-',dir=output) as temp:
        temp=Path(temp);files,dates=extract_paci(paths,temp/'extracted');destination=temp/'race.db'
        with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as original,sqlite3.connect(destination) as copy:original.backup(copy)
        destination.chmod(0o600)
        environment={**os.environ,'PYTHONPATH':str(backend),'PACI_STAGE':str(temp/'extracted')}
        program="import os;from pathlib import Path;import import_jrdb;import_jrdb.EXTRACT_DIR=Path(os.environ['PACI_STAGE']);import_jrdb.main();import evaluate_all;evaluate_all.main()"
        run=subprocess.run([str(python),'-c',program],cwd=temp,env=environment,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
        log=output/'prepare.log';log.write_text(run.stdout);log.chmod(0o600)
        if run.returncode:raise ValueError('Legacy importer/evaluator failed; original DB is unchanged. See local prepare.log')
        with sqlite3.connect(destination) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Prepared DB integrity check failed')
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
        report={'schemaVersion':1,'generatedAt':datetime.now(timezone.utc).isoformat(),'sourceDb':str(source),'preparedDb':str(target),'zipFiles':len(paths),'textFiles':files,'dates':sorted(dates),'originalUnchanged':True}
        write_json(output/'prepared-source.json',report);return report

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source-db',default=str(Path.home()/'projects/backend/race.db'));p.add_argument('--backend',default=str(Path.home()/'projects/backend'))
    p.add_argument('--output',default=str(Path(__file__).parent/'state/derived'));p.add_argument('--inbox',default=str(Path.home()/'Downloads'));p.add_argument('--python')
    args=p.parse_args();print(json.dumps(prepare(args.source_db,args.backend,args.output,args.inbox,args.python),ensure_ascii=False))
