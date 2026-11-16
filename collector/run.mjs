#!/usr/bin/env node
import { chromium } from '@playwright/test'
import { readFile, writeFile, mkdir, chmod, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { resolve, dirname, basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { capturePage, dueCaptures, hash, safeJrdbUrl, publicSource, CAPTURE_OFFSETS, postTimestamp } from './capture.mjs'
import { discoverDayRaces } from './discovery.mjs'

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()).replaceAll('-','')
export async function saveJson(path,value){await mkdir(dirname(path),{recursive:true,mode:0o700});const tmp=`${path}.tmp`;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await chmod(tmp,0o600);await rename(tmp,path)}
async function json(path,fallback){try{return JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code==='ENOENT')return fallback;throw e}}
function python(args){return new Promise((resolvePromise,reject)=>{const p=spawn(process.env.RACE_PYTHON??'python3',args,{cwd:ROOT,stdio:['ignore','pipe','pipe']});let out='',err='';p.stdout.on('data',d=>{out+=d;if(out.length>5000000)p.kill()});p.stderr.on('data',d=>{err+=d;if(err.length>1000000)p.kill()});p.on('error',reject);p.on('close',code=>code===0?resolvePromise(out):reject(Object.assign(new Error('ローカルデータ処理が失敗しました。'),{code:'pipeline_failed',detail:err.slice(-5000)})))})}
function args(){const out={mode:process.argv[2]??'once'};for(let i=3;i<process.argv.length;i++){const key=process.argv[i];if(!key.startsWith('--'))throw new Error('引数を確認してください。');if(['--headful','--no-sync','--no-train','--no-download','--no-prepare'].includes(key))out[key.slice(2)]=true;else out[key.slice(2)]=process.argv[++i]}return out}
function redactedFailure(error){return {code:['auth_required','wrong_race','pipeline_failed','sync_failed','ledger_conflict'].includes(error.code)?error.code:'capture_failed',message:error.code==='auth_required'?'JRDBログインを確認してください。':error.code==='sync_failed'?'本番との同期に失敗しました。ローカル記録は保持されています。':error.code==='pipeline_failed'?'データ処理を再試行してください。':'取得できませんでした。元の記録を保持して再試行します。'}}

export function chunkBundles(bundle,limit=2700000){
  const base={...bundle,races:[]},chunks=[];let current={...base,races:[]}
  const events=race=>(race.snapshots?.length??0)+(race.observations?.length??0)
  let eventCount=0
  for(const race of bundle.races){
    if(Buffer.byteLength(JSON.stringify({...base,races:[race]}))>limit)throw new Error('1レースの同期データが上限を超えました。ローカル記録は保持されています。')
    if(current.races.length&&(current.races.length>=4||eventCount+events(race)>100||Buffer.byteLength(JSON.stringify({...current,races:[...current.races,race]}))>limit)){chunks.push(current);current={...base,races:[]};eventCount=0}
    current.races.push(race);eventCount+=events(race)
  }
  if(current.races.length||!chunks.length)chunks.push(current)
  return chunks
}
export async function companionAction(config,body,request=globalThis.fetch){
  const url=new URL(config.syncUrl??'https://race-analyzer-app.vercel.app/api/companion')
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('同期先はHTTPS URLにしてください。')
  const response=await request(url,{method:'POST',headers:{Authorization:`Bearer ${config.syncToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000),redirect:'error'})
  if(!response.ok)throw Object.assign(new Error('同期操作に失敗しました。'),{code:'sync_failed'})
  const data=await response.text();if(data.length>3000000)throw new Error('同期応答が上限を超えました。')
  return JSON.parse(data)
}
async function synchronize(bundle,config,timeoutMs=30000){
  if(!config.syncToken) return {state:'sync_not_configured',chunks:0}
  const url=new URL(config.syncUrl??'https://race-analyzer-app.vercel.app/api/companion')
  if(url.protocol!=='https:'||url.username||url.password)throw new Error('同期先は認証情報を含まないHTTPS URLにしてください。')
  const batches=chunkBundles(bundle)
  for(const body of batches){const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${config.syncToken}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(timeoutMs),redirect:'error'})
    if(!response.ok)throw Object.assign(new Error('同期に失敗しました。'),{code:'sync_failed',httpStatus:response.status})
  }
  return {state:'synced',chunks:batches.length}
}
export async function synchronizePending(bundle,config,state,{changed=false,now=new Date().toISOString(),persistState=async()=>{},send=synchronize}={}){
  state.pendingFullSync=Boolean(state.pendingFullSync||changed)
  await persistState(state)
  const full=state.pendingFullSync
  if(!full&&Date.parse(now)-Date.parse(state.lastSyncAt??'1970-01-01')<5*60000)return {state:'unchanged'}
  const raceHashes=Object.fromEntries(bundle.races.map(race=>[`${race.raceDate}:${race.raceId}`,hash(race)]))
  // Skip entire unchanged races after a successful sync. Changed races retain all immutable evidence.
  const changedRaces=bundle.races.filter(race=>state.raceHashes?.[`${race.raceDate}:${race.raceId}`]!==raceHashes[`${race.raceDate}:${race.raceId}`])
  // The pending bit is durable before network I/O and clears only after a complete successful batch.
  const result=await send(full?{...bundle,races:changedRaces}:{...bundle,races:[],models:null,forecastReview:null},config)
  if(result.state==='synced'){
    state.lastSyncAt=now
    if(full){state.pendingFullSync=false;state.lastFullSyncAt=now;state.raceHashes={...state.raceHashes,...raceHashes}}
    await persistState(state)
  }
  return result
}
export async function reportSyncFailure(bundle,config,status,state,error,send=synchronize){
  const failure={...redactedFailure(error),code:'sync_failed'}
  if(Number.isInteger(error.httpStatus)&&error.httpStatus>=400&&error.httpStatus<=599)failure.httpStatus=error.httpStatus
  status.failures.push(failure)
  status.state=status.failures.some(f=>f.code==='auth_required')?'auth_required':'partial'
  status.sync={state:'failed',...failure}
  status.lastFullSyncAt=state.lastFullSyncAt??null
  // A status heartbeat never clears the pending data bit or acknowledges a capture command.
  try{await send({...bundle,races:[],models:null,forecastReview:null,status},config,5000)}catch{/* Offline UI detects the stale heartbeat; local failure remains available. */}
}
async function downloadPublishedZips(page,config,date,state,nextDue){
  if(config['no-download'])return 0
  const deadline = Math.min(Date.now() + 90_000, nextDue - 60_000)
  const remaining = () => deadline - Date.now()
  await page.goto('https://jrdb.com/member/data/',{waitUntil:'domcontentloaded',timeout:30000})
  const memberLinks = () => page.locator('a[href]').evaluateAll(nodes => nodes.map(a => ({ url: a.href, label: a.innerText })))
  const entries = await memberLinks()
  const links = entries.map(entry => entry.url)
  const archivePages = entries.flatMap(entry => {
    if (!/個別データ|データルーム|最新更新履歴|成績(?:速報)?(?:データ|更新)/.test(entry.label)) return []
    try {
      const url = safeJrdbUrl(entry.url)
      return url.pathname.startsWith('/member/') && !/\.(?:zip|lzh)$/i.test(url.pathname) ? [url.href] : []
    } catch { return [] }
  })
  for (const source of [...new Set(archivePages)].slice(0, 3)) {
    if (remaining() < 4000) break
    const response = await page.goto(source, { waitUntil: 'domcontentloaded', timeout: Math.min(8000, remaining()) })
      .catch(() => null)
    if (!response) continue
    if ([401, 403].includes(response.status())) throw Object.assign(new Error('認証が必要です。'), { code: 'auth_required' })
    links.push(...(await memberLinks()).map(entry => entry.url))
  }
  // Results may be published after midnight; keep a short catch-up window and deduplicate by content hash.
  const suffix = offset => new Date(Date.UTC(+date.slice(0,4), +date.slice(4,6)-1, +date.slice(6,8)+offset))
    .toISOString().slice(2,10).replaceAll('-','')
  const recent = new Set(Array.from({ length: 8 }, (_, day) => suffix(-day)))
  const upcoming = new Set(Array.from({ length: 7 }, (_, day) => suffix(day+1)))
  const priority = ['PACI', 'SED', 'SEC', 'HJC', 'TYB', 'BAC', 'KAB', 'KTA', 'BAB', 'KAA', 'UKC', 'CSA', 'CZA', 'KSA', 'KZA', 'MSA', 'MZA']
  const candidate = [...new Set(links)].flatMap(value => {
    try {
      const url = safeJrdbUrl(value)
      const match = /([A-Z]{3,4})(\d{6})\.zip$/i.exec(url.pathname)
      if (!match) return []
      const [, rawKind, day] = match
      const kind = rawKind.toUpperCase()
      const rank = priority.indexOf(kind)
      return rank >= 0 && (recent.has(day) || (rank === 0 || rank >= 5) && upcoming.has(day)) ? [{ url: url.href, rank, day }] : []
    } catch { return [] }
  }).sort((a, b) => a.rank - b.rank || b.day.localeCompare(a.day))
  let count=0
  for (const { url: link } of candidate.slice(0, 24)) {
    if (remaining() < 3000) break
    const requestZip = url => page.context().request.get(url, { timeout: Math.min(9000, remaining()), maxRedirects: 0 }).catch(() => null)
    let response = await requestZip(link)
    const redirect = response?.headers().location
    if (redirect && response.status() >= 300 && response.status() < 400 && remaining() > 3000) {
      const target = new URL(redirect, link)
      try { response = await requestZip(safeJrdbUrl(target.href).href) } catch { continue }
    }
    if (!response) continue
    if([401,403].includes(response.status()))throw Object.assign(new Error('認証が必要です。'),{code:'auth_required'})
    if(!response.ok())continue
    const bytes=await response.body();if(bytes.length>50000000||bytes.length<4||bytes[0]!==80||bytes[1]!==75)continue
    const digest=hash(bytes.toString('base64'));if(state.downloads[digest])continue
    const name=basename(new URL(link).pathname).replace(/\.zip$/i,`-${digest.slice(0,12)}.zip`)
    await mkdir(config.downloads,{recursive:true,mode:0o700});await writeFile(join(config.downloads,name),bytes,{mode:0o600})
    state.downloads[digest]={source:publicSource(link),retrievedAt:new Date().toISOString()};count++
  }
  return count
}
async function cycle(page,config,state,force=false){
  const date=config.date??today();let races=JSON.parse(await python(['-m','collector.catalog','--source-db',config.sourceDb,'--date',date])).races
  const discovered=await json(join(config.stateDir,`catalog-${date}.json`),[])
  races=[...races,...discovered.filter(item=>!races.some(r=>r.raceId===item.raceId))]
  const nearCapture=races.some(r=>CAPTURE_OFFSETS.some(offset=>{const delta=postTimestamp(r)+offset*60000-Date.now();return delta>=-150000&&delta<=5*60000}))
  if(!races.length||(!nearCapture&&!config.race&&(force||Date.now()-Date.parse(state.lastDiscoveryAt??0)>30*60000))){
    try{const newRaces=await discoverDayRaces(page,date,races);races.push(...newRaces);await saveJson(join(config.stateDir,`catalog-${date}.json`),[...discovered,...newRaces]);state.lastDiscoveryAt=new Date().toISOString()}catch{/* main capture reports auth state without deleting the known schedule */}
  }
  if(config.race)races=races.filter(race=>race.raceId===config.race)
  let jobs=force?races.map(race=>({race,key:`manual:${race.raceId}:${Date.now()}`,offset:null})):dueCaptures(races,state.completed)
  const captures=[],failures=[],completed=[],acknowledgements=[]
  if(config.syncToken&&!config['no-sync']){
    try{const pending=await companionAction(config,{action:'pull-commands'})
      for(const command of pending.commands??[]){
        const race=races.find(r=>r.raceId===command.raceId&&r.raceDate===command.raceDate)
        if(race&&Date.parse(command.expiresAt)>Date.now())jobs.push({race,key:`command:${command.id}`,commandId:command.id,offset:null})
        else acknowledgements.push({id:command.id,status:'failed'})
      }
    }catch(error){failures.push(redactedFailure(error))}
  }
  for(const job of jobs){
    const retry=state.attempts[job.key]
    if(!force&&retry&&Date.now()-Date.parse(retry.at)<60000)continue
    state.attempts[job.key]={at:new Date().toISOString(),count:(retry?.count??0)+1}
    try {
      const capture=await capturePage(page,job.race)
      captures.push({observation:capture.observation,snapshots:capture.snapshots})
      await saveJson(join(config.stateDir,'evidence',`${job.race.raceDate}-${job.race.raceId}-${hash(capture.raw).slice(0,16)}.json`),capture.raw)
      completed.push([job.key,{retrievedAt:capture.observation.retrievedAt,completeOdds:capture.completeOdds}]);if(job.commandId)acknowledgements.push({id:job.commandId,status:'completed'})
    }catch(error){failures.push({raceId:job.race.raceId,...redactedFailure(error)});if(job.commandId)acknowledgements.push({id:job.commandId,status:'failed'});if(error.code==='auth_required')break}
    await sleep(1500)
  }
  const nextDue=races.flatMap(r=>CAPTURE_OFFSETS.map(offset=>postTimestamp(r)+offset*60000)).filter(t=>t>Date.now()).sort((a,b)=>a-b)[0]??Infinity
  const observationWindow=nextDue-Date.now()<5*60000
  let downloads=0
  if(!observationWindow&&(force||Date.now()-Date.parse(state.lastDownloadAt??0)>15*60000)){
    try{downloads=await downloadPublishedZips(page,config,date,state,nextDue);state.lastDownloadAt=new Date().toISOString()}catch(error){failures.push(redactedFailure(error))}
  }
  let added=0
  if(captures.length){const path=join(config.stateDir,'capture-input.json');await saveJson(path,captures);added=JSON.parse(await python(['-m','collector.persist','persist','--output',config.output,'--input',path])).added}
  for(const [key,value] of completed)state.completed[key]=value
  let ledgerRecords=0
  if(config.syncToken&&!config['no-sync']&&!observationWindow&&(force||Date.now()-Date.parse(state.lastLedgerPullAt??0)>15*60000)){
    try{const pulled=[]
      const settled = state.historicalLedgerPulls ?? {}
      const indexed = await companionAction(config, { action: 'pull-forecast-races' })
      const history = indexed.races.filter(r => r.raceDate < date && !settled[`${r.raceDate}:${r.raceId}`]).slice(0, 12)
      const batch = [...races, ...history].slice(0, 72)
      for(const race of batch){const record=await companionAction(config,{action:'pull-ledgers',raceId:race.raceId,raceDate:race.raceDate})
        if(record.conflicts?.length)throw Object.assign(new Error('購入記録に競合があります。'),{code:'ledger_conflict'})
        if(record.ledger)pulled.push({ledger:record.ledger,receipts:record.receipts??[]})
      }
      if(pulled.length){const file=join(config.stateDir,'ledger-input.json');await saveJson(file,pulled);ledgerRecords=JSON.parse(await python(['-m','collector.persist','ledger','--output',config.output,'--input',file])).added}
      state.historicalLedgerPulls = Object.fromEntries(Object.entries({
        ...settled, ...Object.fromEntries(history.map(r => [`${r.raceDate}:${r.raceId}`, true]))
      }).slice(-600))
      state.lastLedgerPullAt=new Date().toISOString()
    }catch(error){failures.push(redactedFailure(error))}
  }
  if(downloads&&!config['no-prepare']){
    try{const {readdir}=await import('node:fs/promises');const files=await readdir(config.downloads)
      if(files.some(name=>/^PACI\d{6}/i.test(name))){
        const prepared=JSON.parse(await python(['-m','collector.prepare','--source-db',config.originalSourceDb,'--output',join(config.stateDir,'derived'),'--inbox',config.downloads]))
        config.sourceDb=prepared.preparedDb
      }
    }catch(error){failures.push({...redactedFailure(error),code:'prepare_failed'})}
  }
  const hasModel=(await Promise.all(['model.runtime.json','forecast-review.json'].map(name=>stat(join(config.output,name)).then(()=>true,()=>false)))).every(Boolean)
  const resultUpdate=captures.some(c=>c.observation.payload.results.length)
  let modelUpdated=false
  state.pendingTraining = Boolean(state.pendingTraining || resultUpdate || downloads || ledgerRecords)
  const shouldTrain = !observationWindow && (force || !hasModel || (state.pendingTraining && Date.now()-Date.parse(state.lastTrainAt??0)>30*60000))
  if(!config['no-train']&&shouldTrain){
    try{await python(['-m','pipeline.run','run','--source-db',config.sourceDb,'--output',config.output,'--inbox',config.downloads,'--include-paci']);state.lastTrainAt=new Date().toISOString();state.pendingTraining=false;modelUpdated=true}catch(error){failures.push(redactedFailure(error));if(error.detail)await writeFile(join(config.stateDir,'pipeline-error.log'),error.detail,{mode:0o600})}
  }
  const status={state:failures.some(f=>f.code==='auth_required')?'auth_required':failures.length?'partial':jobs.length?'ready':'waiting',
    lastRunAt:new Date().toISOString(),source:'local-jrdb-companion',date,scheduledRaces:races.length,capturedRaces:captures.length,addedRecords:added,
    downloadedFiles:downloads,ledgerRecords,failures,scheduledOffsetsMinutes:CAPTURE_OFFSETS,decisionMinutesBefore:10,
    nextDueAt:Number.isFinite(nextDue)?new Date(nextDue).toISOString():null,lastFullSyncAt:state.lastFullSyncAt??null}
  await saveJson(join(config.stateDir,'status.json'),status)
  await python(['-m','collector.persist','bundle','--source-db',config.sourceDb,'--output',config.output,'--date',date,'--status',join(config.stateDir,'status.json')])
  if(!config['no-sync']){
    try{
      status.sync=await synchronizePending(await json(join(config.output,'companion.bundle.json')),config,state,
        {changed:Boolean(force||added||downloads||ledgerRecords||modelUpdated),persistState:value=>saveJson(join(config.stateDir,'state.json'),value)})
      if(status.sync.state==='synced'&&status.lastFullSyncAt!==state.lastFullSyncAt){
        status.lastFullSyncAt=state.lastFullSyncAt??null
        try{await synchronize({...await json(join(config.output,'companion.bundle.json')),races:[],models:null,forecastReview:null,status},config,5000)}catch{/* Data success remains valid even if its status heartbeat is delayed. */}
      }
    }catch(error){await reportSyncFailure(await json(join(config.output,'companion.bundle.json')),config,status,state,error)}
    for(const ack of acknowledgements){
      if(ack.status==='completed'&&status.sync.state!=='synced')continue
      try{await companionAction(config,{action:'ack-command',...ack})}catch(error){failures.push(redactedFailure(error))}
    }
  }
  state.lastRunAt=status.lastRunAt;await saveJson(join(config.stateDir,'state.json'),state);await saveJson(join(config.stateDir,'status.json'),status)
  console.log(JSON.stringify({state:status.state,capturedRaces:status.capturedRaces,addedRecords:added,sync:status.sync?.state??status.sync?.code??'disabled',failures:failures.map(f=>({raceId:f.raceId,code:f.code}))}))
  return status
}
export async function main(){
  const options=args();if(!['once','daemon','login','sync'].includes(options.mode))throw new Error('once / daemon / login / sync を指定してください。')
  let privateConfig={}
  if(options.config){const info=await stat(options.config);if((info.mode&0o077)!==0)throw new Error('認証設定ファイルは chmod 600 で保護してください。');privateConfig=await json(options.config,{})}
  const config={...privateConfig,...options,
    jrdbUser:process.env.JRDB_USER??privateConfig.jrdbUser,jrdbPassword:process.env.JRDB_PASSWORD??privateConfig.jrdbPassword,
    syncToken:process.env.COMPANION_TOKEN??privateConfig.syncToken,
    sourceDb:resolve(options['source-db']??privateConfig.sourceDb??join(homedir(),'projects/backend/race.db')),
    stateDir:resolve(options['state-dir']??privateConfig.stateDir??join(ROOT,'collector/state')),
    output:resolve(options.output??privateConfig.output??join(ROOT,'pipeline/output')),
    profile:resolve(options.profile??privateConfig.profile??join(ROOT,'collector/profile'))}
  config.downloads=join(config.stateDir,'downloads');await mkdir(config.downloads,{recursive:true,mode:0o700})
  config.originalSourceDb=config.sourceDb
  const prepared=await json(join(config.stateDir,'derived/prepared-source.json'),null)
  if(prepared&&!options['source-db']&&privateConfig.usePreparedSource!==false)config.sourceDb=prepared.preparedDb
  const state=await json(join(config.stateDir,'state.json'),{completed:{},attempts:{},downloads:{}})
  const localModified=await stat(join(config.output,'market.sqlite')).then(s=>s.mtimeMs,()=>0)
  if(localModified>Date.parse(state.lastFullSyncAt??'1970-01-01'))state.pendingFullSync=true
  if(options.mode==='sync'){console.log(JSON.stringify(await synchronize(await json(join(config.output,'companion.bundle.json')),config)));return}
  const httpCredentials=config.jrdbUser&&config.jrdbPassword?{username:config.jrdbUser,password:config.jrdbPassword,origin:'https://jrdb.com'}:undefined
  const context=await chromium.launchPersistentContext(config.profile,{channel:'chrome',headless:options.mode!=='login'&&!options.headful,httpCredentials,acceptDownloads:true})
  const page=context.pages()[0]??await context.newPage()
  let stopped=false;process.once('SIGTERM',()=>{stopped=true});process.once('SIGINT',()=>{stopped=true})
  try{
    if(options.mode==='login') {await page.goto('https://jrdb.com/member/',{waitUntil:'domcontentloaded'});console.log('専用ブラウザでJRDBへログインしてください。終了時にウィンドウを閉じると保存されます。');await new Promise(resolve=>context.once('close',resolve));return}
    do{try{await cycle(page,config,state,options.mode==='once')}catch(error){const status={state:'error',lastRunAt:new Date().toISOString(),...redactedFailure(error)};await saveJson(join(config.stateDir,'status.json'),status);console.error(JSON.stringify(status));if(options.mode==='once')process.exitCode=1}
      if(options.mode!=='daemon')break
      for(let i=0;i<30&&!stopped;i++)await sleep(1000)
    }while(!stopped)
  }finally{await context.close().catch(()=>{})}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(JSON.stringify(redactedFailure(error)));process.exitCode=1})
