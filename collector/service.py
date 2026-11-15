"""Install a user-owned macOS LaunchAgent for the JRDB companion.

No credentials are written to the plist or command line. The private JSON stays 0600.
The old runtime is retained so a reinstall can be rolled back.
"""
from __future__ import annotations
import argparse
import json
import os
import plistlib
import shutil
import sqlite3
import subprocess
from datetime import datetime, timezone
from pathlib import Path

LABEL='jp.raceanalyzer.companion'
ROOT=Path(__file__).resolve().parents[1]

def control(action,home=None):
    home=Path(home or Path.home());plist=home/'Library/LaunchAgents'/f'{LABEL}.plist';domain=f'gui/{os.getuid()}'
    if action=='status':return subprocess.run(['launchctl','print',f'{domain}/{LABEL}']).returncode
    if action=='stop':return subprocess.run(['launchctl','bootout',domain,str(plist)]).returncode
    if action=='start':
        subprocess.run(['launchctl','bootstrap',domain,str(plist)],check=True)
        return subprocess.run(['launchctl','kickstart',f'{domain}/{LABEL}']).returncode
    raise ValueError('Unknown service action')

def install(config_path,start=False):
    config_path=Path(config_path).expanduser().resolve(strict=True)
    if config_path.stat().st_mode&0o077:raise ValueError('Config must be mode 0600')
    config=json.loads(config_path.read_text());node=shutil.which('node');python=shutil.which('python3')
    if not node or not python:raise ValueError('Node and Python 3 must be installed')
    target=Path.home()/'Library/Application Support/RaceAnalyzer';target.mkdir(parents=True,exist_ok=True);target.chmod(0o700)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ');runtime=target/'runtime'/stamp;runtime.mkdir(parents=True)
    for directory in ('collector','pipeline'):
        shutil.copytree(ROOT/directory,runtime/directory,ignore=shutil.ignore_patterns('state','profile','output','__pycache__'))
    (runtime/'package.json').write_text('{"type":"module","private":true}\n')
    for module in ('@playwright/test','playwright','playwright-core'):
        source=ROOT/'node_modules'/module
        if not source.exists():raise ValueError('Run npm ci before installing companion')
        shutil.copytree(source,runtime/'node_modules'/module,symlinks=False)
    # Capture training models and SQLite through a consistent backup, never copy an open journal.
    research=target/'research';research.mkdir(exist_ok=True);research.chmod(0o700)
    for file in (ROOT/'pipeline/output').glob('*.json'):
        destination=research/file.name
        if not destination.exists():shutil.copy2(file,destination);destination.chmod(0o600)
    source_store=ROOT/'pipeline/output/market.sqlite';target_store=research/'market.sqlite'
    if source_store.exists() and not target_store.exists():
        with sqlite3.connect(source_store.as_uri()+'?mode=ro',uri=True) as src,sqlite3.connect(target_store) as dst:src.backup(dst)
        target_store.chmod(0o600)
    for name in ('state','profile','logs'):(target/name).mkdir(exist_ok=True,mode=0o700)
    config.update(stateDir=str(target/'state'),output=str(research),profile=str(target/'profile'))
    for key in ('mode','date','race','no-sync','no-train','no-download','no-prepare'):config.pop(key,None)
    private=target/'config.json';private.write_text(json.dumps(config,ensure_ascii=False,indent=2)+'\n');private.chmod(0o600)
    launch_dir=Path.home()/'Library/LaunchAgents';launch_dir.mkdir(exist_ok=True)
    plist=launch_dir/f'{LABEL}.plist'
    if plist.exists():
        control('stop');shutil.copy2(plist,target/f'{LABEL}.{stamp}.plist.backup')
    definition={'Label':LABEL,'ProgramArguments':[node,str(runtime/'collector/run.mjs'),'daemon','--config',str(private)],
                'WorkingDirectory':str(runtime),'RunAtLoad':True,'KeepAlive':True,'ThrottleInterval':60,
                'EnvironmentVariables':{'PATH':os.environ.get('PATH','/usr/bin:/bin'),'RACE_PYTHON':python},
                'StandardOutPath':str(target/'logs/companion.log'),'StandardErrorPath':str(target/'logs/companion-error.log')}
    with plist.open('wb') as stream:plistlib.dump(definition,stream)
    plist.chmod(0o600)
    for log in ('companion.log','companion-error.log'):
        path=target/'logs'/log;path.touch(mode=0o600,exist_ok=True);path.chmod(0o600)
    manifest={'installedAt':datetime.now(timezone.utc).isoformat(),'runtime':str(runtime),'config':str(private),'plist':str(plist),'startRequested':start}
    (target/'installation.json').write_text(json.dumps(manifest,indent=2)+'\n');(target/'installation.json').chmod(0o600)
    if start:control('start')
    return manifest

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('action',choices=['install','status','stop','start']);p.add_argument('--config');p.add_argument('--start',action='store_true')
    args=p.parse_args()
    if args.action=='install':
        if not args.config:p.error('install requires --config')
        print(json.dumps(install(args.config,args.start),ensure_ascii=False))
    else:raise SystemExit(control(args.action))
