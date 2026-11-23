import { createHash } from 'node:crypto'
import {parsePaddockTab} from './paddock.mjs'

export const CAPTURE_OFFSETS = [-60, -30, -20, -15, -12, -11, -10, -5, 0, 5, 15, 30]
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '')
const navigationTimes = new WeakMap()
async function paceNavigation(context) {
  const remaining=3500-(Date.now()-(navigationTimes.get(context)??0))
  if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining))
  navigationTimes.set(context,Date.now())
}
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex')
export function safeJrdbUrl(input) {
  const url = new URL(input)
  if (url.protocol !== 'https:' || !['jrdb.com', 'www.jrdb.com'].includes(url.hostname) || url.username || url.password) throw new Error('JRDBのHTTPS URLだけを取得できます。')
  return url
}
export function publicSource(input) { const url=safeJrdbUrl(input);return `${url.origin}${url.pathname}` }
export function postTimestamp(race) {
  const date=String(race.raceDate),time=String(race.postTime ?? '').replace(':','').padStart(4,'0')
  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time) || +time.slice(0,2)>23 || +time.slice(2)>59) throw new Error('レース日時が不正です。')
  const iso=`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${time.slice(0,2)}:${time.slice(2)}:00+09:00`
  if (!Number.isFinite(Date.parse(iso))) throw new Error('レース日時が不正です。')
  return Date.parse(iso)
}
export function dueCaptures(races, completed, now=Date.now(), toleranceMs=150000) {
  const result=[]
  for (const race of races) {
    const candidates=CAPTURE_OFFSETS.map(offset=>({race,offset,key:`${race.raceDate}:${race.raceId}:${offset}`,due:postTimestamp(race)+offset*60000}))
      .filter(job=>job.due<=now&&now<job.due+toleranceMs).sort((a,b)=>b.due-a.due)
    // Capture the latest slot only. A late start never backfills multiple earlier slots with the same observation.
    if(candidates[0]&&!completed[candidates[0].key])result.push(candidates[0])
  }
  return result.sort((a,b)=>a.due-b.due)
}

function numeric(value) {
  const clean=String(value??'').normalize('NFKC').replace(/[◎○▲△▽注消☆＊*\s,]/g,'')
  return /^[-+]?\d+(?:\.\d+)?$/.test(clean)?Number(clean):null
}
function odds(value) { const v=numeric(value);return v!==null&&v>=1&&v<=9999999?v:null }
function timestampForClock(date, clock) { return new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${clock}:00+09:00`).toISOString() }
function rowValue(row, key) { return row[key]?.text ?? row[key] ?? '' }

export function expandTable(rows) {
  const grid=[]
  rows.forEach((cells,y)=>{grid[y]??=[];let x=0;for(const cell of cells){while(grid[y][x]!==undefined)x++
    const colspan=Math.max(1,Math.min(100,Number(cell.colspan)||1)),rowspan=Math.max(1,Math.min(100,Number(cell.rowspan)||1))
    for(let dy=0;dy<rowspan;dy++){grid[y+dy]??=[];for(let dx=0;dx<colspan;dx++)grid[y+dy][x+dx]=String(cell.text??'').trim()}
    x+=colspan
  }});return grid
}

export function parseHistoryTable(rows, race, retrievedAt, source) {
  const grid=expandTable(rows??[])
  if(grid.length<4||normalize(grid[0][0])!=='枠'||normalize(grid[0][1])!=='馬')return {frames:{},snapshots:[]}
  const records=new Map(),frames={}
  for(const row of grid.slice(3)) {
    const no=numeric(row[1]),horse=race.horses.find(h=>Number(h.horseNo)===no)
    if(!horse||normalize(row[2]).replace(/[＊*]/g,'')!==normalize(horse.name).replace(/[＊*]/g,'')||records.has(no))continue
    records.set(no,row);const frame=numeric(row[0]);if(Number.isInteger(frame)&&frame>=1&&frame<=8)frames[no]=frame
  }
  const snapshots=[]
  if(records.size!==race.fieldSize)return {frames:{},snapshots:[]}
  for(let col=5;col<Math.max(...grid.slice(0,3).map(row=>row.length));col++) {
    const time=grid.slice(0,3).map(row=>row[col]).find(value=>/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value??''))
    if(!time)continue
    const published=timestampForClock(race.raceDate,time)
    if(Date.parse(published)>Date.parse(retrievedAt))continue
    const prices=Object.fromEntries([...records].map(([no,row])=>[no,odds(row[col])]))
    if(Object.values(prices).some(value=>value===null))continue
    snapshots.push({schemaVersion:2,id:hash(['jrdb-history',race.raceId,race.raceDate,time,prices]),raceId:race.raceId,raceDate:race.raceDate,
      kind:'observed',time,observedAt:published,sourcePublishedAt:published,retrievedAt,source,odds:prices,revisionOf:null})
  }
  return {frames:Object.keys(frames).length===race.fieldSize?frames:{},snapshots}
}


/** Parses only observed named JRDB columns, never positional guesses. */
export function parseVisibleRace(raw, race, { retrievedAt=new Date().toISOString(), sourceUrl }={}) {
  if (!Number.isFinite(Date.parse(retrievedAt))) throw new Error('取得時刻が不正です。')
  const source=publicSource(sourceUrl ?? `https://jrdb.com/member/n_live_${race.raceDate}_${race.raceId}.html`)
  if (raw.authenticationRequired || !raw.rows?.length) {
    const error=new Error('JRDBログインが必要、または対象の馬柱が表示されていません。');error.code='auth_required';throw error
  }
  const expected=new Map(race.horses.map(h=>[Number(h.horseNo),h]))
  if (expected.size!==race.fieldSize || expected.size<2 || expected.size>18) throw new Error('正式な全出走馬が未確認です。')
  const horses=[],seen=new Set()
  for(const row of raw.rows) {
    const horseNo=numeric(rowValue(row,'umaban'))
    if (!Number.isInteger(horseNo) || !expected.has(horseNo) || seen.has(horseNo)) throw new Error('馬番が公式出走欄と一致しません。')
    seen.add(horseNo)
    const displayedName=String(rowValue(row,'bamei9m')).trim()
    const name=String(row.bamei9m?.fullName??displayedName).trim()
    if (normalize(name).replace(/[＊*]/g,'')!==normalize(expected.get(horseNo).name).replace(/[＊*]/g,'')) throw new Error('馬名が公式出走欄と一致しません。別レースの可能性があります。')
    const rankText=String(rowValue(row,'se_tyakujun'))
    const cancelled=/取消|除外/.test(rankText)||/^(?:取消|除外)[\s　]/.test(displayedName)
    horses.push({horseNo,name,cancelled,idm:numeric(rowValue(row,'idm')),paddockIndex:numeric(rowValue(row,'sirusi_padock')),
      horseWeight:numeric(rowValue(row,'bataiju')),horseWeightDelta:numeric(rowValue(row,'zogendsp')),
      runningStyle:String(rowValue(row,'txt_kyakusitsu')).trim(),winOdds:odds(rowValue(row,'tanodds')),
      baselineOdds:odds(rowValue(row,'kijtanodds')),placeOddsLower:odds(rowValue(row,'fukodds')),
      rank:numeric(rankText),frameNo:null})
  }
  if(seen.size!==expected.size) throw new Error('全頭の表示が揃っていません。')
  const history=parseHistoryTable(raw.historyTable,race,retrievedAt,source)
  for(const horse of horses)horse.frameNo=history.frames[horse.horseNo]??null
  const active=horses.filter(h=>!h.cancelled),winOdds=Object.fromEntries(active.filter(h=>h.winOdds!==null).map(h=>[h.horseNo,h.winOdds]))
  const baselineOdds=Object.fromEntries(active.filter(h=>h.baselineOdds!==null).map(h=>[h.horseNo,h.baselineOdds]))
  const sourceHash=hash(raw)
  const cornerPass4={...raw.cornerPass4}
  for(const row of raw.resultTables??[])if(row.length===12&&Number.isInteger(numeric(row[1]))&&numeric(row[11])>=1)cornerPass4[numeric(row[1])]=numeric(row[11])
  const payouts = new Map(), previousTypes = new Map()
  const typeCounts = { '単勝': 1, '複勝': 1, '枠連': 2, '馬連': 2, '馬単': 2, 'ワイド': 2, '3連複': 3, '3連単': 3 }
  for (const row of raw.payoutTables ?? []) {
    const values = row.map(normalize)
    // Each payout has a heading, selection, amount and popularity. The page may put two groups in one row.
    for (let column = 0; column + 2 < values.length; column += 4) {
      const heading = values[column]
      const type = Object.hasOwn(typeCounts, heading) ? heading : previousTypes.get(column)
      let start = column + 1
      if (heading && !Object.hasOwn(typeCounts, heading)) {
        if (column !== 0 || values.length !== 3) continue
        start = 0  // HTML omits a repeated heading when it uses rowspan.
      }
      if (!type) continue
      previousTypes.set(column, type)
      const numbers = (values[start]?.match(/\d+/g) ?? []).map(Number)
      const amount = values[start + 1] ?? ''
      const per100 = /^\d[\d,]*円?$/.test(amount) ? Number(amount.replace(/[円,]/g, '')) : null
      if (numbers.length !== typeCounts[type] || !Number.isSafeInteger(per100) || per100 <= 0
        || numbers.some(n => n < 1 || n > (type === '枠連' ? 8 : 18))) continue
      if (!['馬単', '3連単'].includes(type)) numbers.sort((a, b) => a - b)
      const key = `${type}:${numbers.join('-')}`
      // Keep inconsistent amounts visible so review can flag the conflict.
      payouts.set(`${key}:${per100}`, { type, numbers, key, per100 })
    }
  }
  const finalPrice=/単勝最終オッズ|確定オッズ/.test(raw.oddsLabel??'')
  const clock=/([01]?\d|2[0-3]):([0-5]\d)\s*現在/.exec(raw.oddsLabel??'')
  const clockText=clock?`${clock[1].padStart(2,'0')}:${clock[2]}`:null
  const sourcePublishedAt=clockText?timestampForClock(race.raceDate,clockText):null
  if(sourcePublishedAt&&Date.parse(sourcePublishedAt)>Date.parse(retrievedAt)) throw new Error('表示元のオッズ時刻が取得時刻より未来です。')
  const observedAt=sourcePublishedAt ?? retrievedAt
  const weather=String(raw.weather??'').match(/小雨|小雪|晴|曇|雨|雪/)?.[0]??null
  const going=String(raw.weather??'').match(/不良|稍重|重|良/)?.[0]??null
  const results=horses.filter(h=>h.rank!==null&&Number.isInteger(h.rank)&&h.rank>=1&&h.rank<=race.fieldSize).map(h=>({horseNo:h.horseNo,rank:h.rank,
    cornerPass4:cornerPass4[h.horseNo]??null}))
  const resultKnown=results.length>0&&results.some(h=>h.rank===1)
  const commentCapture=parsePaddockTab(raw.paddockTab,race,retrievedAt)
  const {comments:paddockComments,...paddockCapture}=commentCapture
  const payload={...race,horses,fieldSize:active.length,releaseFieldSize:race.fieldSize,activeHorseNumbers:active.map(h=>h.horseNo),
    winOdds,baselineOdds,paddock:horses.map(h=>({horseNo:h.horseNo,paddockIndex:h.paddockIndex,horseWeight:h.horseWeight,horseWeightDelta:h.horseWeightDelta})),
    weather,going,observedAt,sourcePublishedAt,retrievedAt,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at',source,sourceHash,
    results,payouts:[...payouts.values()],refunds:null,refundStatus:'not-provided-by-screen',resultsPublishedAt:null,resultsRetrievedAt:resultKnown?retrievedAt:null,
    finalWinOdds:finalPrice&&Object.keys(winOdds).length===active.length?winOdds:null,
    closingPublishedAt:null,closingRetrievedAt:finalPrice?retrievedAt:null,
    priceStatus:finalPrice?'final-visible':sourcePublishedAt?'timestamped':'publication-time-unverified',
    quotes:active.filter(h=>h.placeOddsLower).map(h=>({type:'複勝',numbers:[h.horseNo],odds:h.placeOddsLower,upper:h.placeOddsLower,rangeStatus:'lower-only'})),
    paddockComments,paddockCapture, rawResultTable:raw.resultTables??[],rawPayoutTable:raw.payoutTables??[]}
  const eventId=hash(['LIVE_RACE',race.raceId,retrievedAt,sourceHash])
  const observation={eventId,kind:'LIVE_RACE',retrievedAt,sourceHash,payload}
  // Keep pre-withdrawal tables as raw evidence; do not turn an old field into today's active field.
  const snapshots=history.snapshots.filter(snapshot=>Object.keys(snapshot.odds).length===active.length
    && active.every(horse=>snapshot.odds[horse.horseNo]!=null))
  if(Object.keys(winOdds).length===active.length&&!finalPrice) {
    snapshots.push({schemaVersion:2,id:hash(['win',eventId]),raceId:race.raceId,raceDate:race.raceDate,kind:'observed',time:clockText??new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(observedAt)),
      observedAt,sourcePublishedAt,retrievedAt,source,odds:winOdds,revisionOf:null,activeHorseNumbers:payload.activeHorseNumbers,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at'})
  }
  if(Object.keys(baselineOdds).length===active.length)snapshots.push({schemaVersion:2,id:hash(['baseline',eventId]),raceId:race.raceId,raceDate:race.raceDate,kind:'baseline',
    time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(retrievedAt)),observedAt:retrievedAt,sourcePublishedAt:null,retrievedAt,source,odds:baselineOdds,revisionOf:null,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at'})
  // Baseline is recorded at actual capture time, never backdated to its presumed publication.
  return {observation,snapshots,completeOdds:Object.keys(winOdds).length===active.length}
}

export async function capturePage(page, race) {
  const sourceUrl=`https://jrdb.com/member/n_live_${race.raceDate}_${race.raceId}.html`
  // JRDB's link handler switches the race; navigating to its href alone can show the previous race.
  const context=page.context(),indexPage=await context.newPage()
  let racePage
  try {
    await paceNavigation(context)
    const index=await indexPage.goto('https://jrdb.com/member/new_index.php',{waitUntil:'domcontentloaded',timeout:30000})
    if(index&&[401,403].includes(index.status())) {const error=new Error('JRDBの認証期限が切れています。');error.code='auth_required';throw error}
    const dayPattern=new RegExp(`${Number(race.raceDate.slice(4,6))}\\s*月\\s*${Number(race.raceDate.slice(6,8))}日`)
    await indexPage.getByRole('link',{name:dayPattern}).filter({visible:true}).first().click()
    const link=indexPage.locator(`a[href*="n_live_${race.raceDate}_${race.raceId}.html"]`).filter({visible:true}).first()
    await link.waitFor({state:'attached',timeout:12000})
    const target=safeJrdbUrl(new URL(await link.getAttribute('href'),indexPage.url()).href)
    if(target.pathname!==new URL(sourceUrl).pathname)throw new Error('掲載リンクが対象レースと一致しません。')
    await paceNavigation(context)
    const [opened]=await Promise.all([indexPage.waitForEvent('popup',{timeout:15000}),link.click()])
    racePage=opened
    await racePage.waitForLoadState('domcontentloaded')
    if(safeJrdbUrl(racePage.url()).pathname!==target.pathname)throw new Error('開いた画面が対象レースと一致しません。')
    return await captureLoadedRace(racePage,race,sourceUrl,context)
  } finally {
    await racePage?.close().catch(()=>{})
    await indexPage.close().catch(()=>{})
  }
}

async function captureLoadedRace(page,race,sourceUrl,context) {
  try {
    await page.waitForFunction(expected=>{
      const norm=value=>String(value??'').normalize('NFKC').replace(/[\s＊*]/g,'')
      const rows=Array.from(document.querySelectorAll('#horse_grid0 tr[id]')).filter(row=>row.querySelector('[aria-describedby="horse_grid0_umaban"]'))
      return rows.length===expected.length&&rows.every(row=>{
        const no=Number(row.querySelector('[aria-describedby="horse_grid0_umaban"]').innerText)
        const cell=row.querySelector('[aria-describedby="horse_grid0_bamei9m"]')
        const name=cell?.querySelector('[onclick]')?.getAttribute('onclick')?.match(/uma_grid\.bamei_click\(\s*"[^"]*"\s*,\s*"([^"]+)"/)?.[1]??cell?.innerText
        return expected.some(horse=>Number(horse.horseNo)===no&&norm(horse.name)===norm(name))
      })
    },race.horses,{timeout:25000})
  } catch {const error=new Error('対象の全頭馬柱を確認できません。このレースの取得を再試行してください。');error.code='race_unavailable';throw error}
  const raw=await page.evaluate(()=>{
    const tableRows=selector=>Array.from(document.querySelectorAll(selector)).map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>cell.innerText.trim()))
    const rows=Array.from(document.querySelectorAll('#horse_grid0 tr[id]')).filter(row=>row.querySelector('[aria-describedby="horse_grid0_umaban"]')).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('td[aria-describedby]')).map(cell=>{
      const key=cell.getAttribute('aria-describedby').replace('horse_grid0_',''),text=cell.innerText.trim()
      const fullName=key==='bamei9m'?cell.querySelector('[onclick]')?.getAttribute('onclick')?.match(/uma_grid\.bamei_click\(\s*"[^"]*"\s*,\s*"([^"]+)"/)?.[1]:null
      return [key,fullName?{text,fullName}:text]
    })))
    return {rows,weather:document.querySelector('#tenki_all')?.innerText??'',oddsLabel:document.querySelector('#infomation_block')?.innerText??'',
      resultTables:tableRows('#results table tr'),payoutTables:tableRows('#payback table tr'),
      historyTable:Array.from(document.querySelectorAll('#tabs-5 table tr')).map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>({text:cell.innerText.trim(),rowspan:cell.rowSpan,colspan:cell.colSpan})))}
  })
  raw.paddockTab=await capturePaddockTab(page,race,context)
  const historyTab=page.locator('a[href="#tabs-5"]')
  if(await historyTab.count()){
    await paceNavigation(context)
    await historyTab.click()
    try {await page.locator('#tabs-5 table tr').first().waitFor({timeout:10000})} catch { /* explicit empty history remains missing */ }
    raw.historyTable=await page.locator('#tabs-5 table tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>({text:cell.innerText.trim(),rowspan:cell.rowSpan,colspan:cell.colSpan}))))
  }
  return {raw,...parseVisibleRace(raw,race,{sourceUrl,retrievedAt:new Date().toISOString()})}
}

export async function capturePaddockTab(page,race,context){
  const tab=page.locator('a[href="#tabs-1"]')
  if(!await tab.count())return {status:'tab-missing',checkedAt:new Date().toISOString()}
  try{
    await paceNavigation(context)
    await tab.click()
    await page.waitForFunction(expected=>{
      const norm=value=>String(value??'').normalize('NFKC').replace(/[\s＊*]/g,'')
      const rows=Array.from(document.querySelectorAll('#horse_grid1 tr[id]')).filter(row=>row.querySelector('[aria-describedby="horse_grid1_umaban"]'))
      return rows.length===expected.length&&rows.every(row=>{
        const no=Number(row.querySelector('[aria-describedby="horse_grid1_umaban"]').innerText)
        const cell=row.querySelector('[aria-describedby="horse_grid1_bamei9m"]')
        const name=cell?.querySelector('[onclick]')?.getAttribute('onclick')?.match(/uma_grid\.bamei_click\(\s*"[^"]*"\s*,\s*"([^"]+)"/)?.[1]??cell?.innerText
        return expected.some(horse=>Number(horse.horseNo)===no&&norm(horse.name)===norm(name))
      })
    },race.horses,{timeout:8000})
    const data=await page.evaluate(()=>{
      const rows=Array.from(document.querySelectorAll('#horse_grid1 tr[id]')).filter(row=>row.querySelector('[aria-describedby="horse_grid1_umaban"]')).map(row=>{
        const cell=key=>row.querySelector(`[aria-describedby="horse_grid1_${key}"]`)
        const name=cell('bamei9m'),fullName=name?.querySelector('[onclick]')?.getAttribute('onclick')?.match(/uma_grid\.bamei_click\(\s*"[^"]*"\s*,\s*"([^"]+)"/)?.[1]
        return {umaban:cell('umaban')?.innerText.trim(),bamei9m:fullName?{text:name.innerText.trim(),fullName}:name?.innerText.trim(),comment:cell('comment')?.innerText.trim()}
      })
      return {rows,accessNotice:/パドック返し馬コメント情報はオプションコンテンツ/.test(document.querySelector('#infomation_block')?.innerText??'')}
    })
    return {...data,status:'read',checkedAt:new Date().toISOString()}
  }catch{
    const notice=await page.locator('#infomation_block').innerText({timeout:1000}).catch(()=> '')
    return {status:'failed',checkedAt:new Date().toISOString(),accessNotice:/パドック返し馬コメント情報はオプションコンテンツ/.test(notice)}
  }
}
