import { createHash } from 'node:crypto'

export const CAPTURE_OFFSETS = [-60, -30, -20, -15, -12, -11, -10, -5, 0, 5, 15, 30]
const normalize = value => String(value ?? '').normalize('NFKC').replace(/[\s　]/g, '')
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


function cornerPositions(rows, horses) {
  const ranks = new Map(horses.filter(horse => !horse.cancelled).map(horse => [horse.horseNo, horse.rank]))
  const positions = new Map()
  let columns
  for (const row of rows) {
    const labels = row.map(normalize)
    const rank = labels.indexOf('着順')
    const horse = labels.indexOf('馬番')
    if (rank >= 0 && horse >= 0) {
      const corner = labels.findIndex(label => /^(?:4コ(?:ーナー)?|4角)$/.test(label))
      columns = corner >= 0 ? { rank, horse, corner, width: row.length } : null
      continue
    }
    if (!columns || row.length !== columns.width) continue
    const number = numeric(row[columns.horse])
    const position = numeric(row[columns.corner])
    const finish = numeric(row[columns.rank])
    if (Number.isInteger(finish) && finish >= 1 && ranks.get(number) === finish
      && Number.isInteger(position) && position >= 1 && position <= ranks.size) positions.set(number, position)
  }
  return positions
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
    const name=String(rowValue(row,'bamei9m')).trim()
    if (normalize(name).replace(/[＊*]/g,'')!==normalize(expected.get(horseNo).name).replace(/[＊*]/g,'')) throw new Error('馬名が公式出走欄と一致しません。別レースの可能性があります。')
    const rankText=String(rowValue(row,'se_tyakujun'))
    const cancelled=/取消|除外/.test(rankText)
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
  const cornerPass4 = cornerPositions(raw.resultTables ?? [], horses)
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
    cornerPass4:cornerPass4.get(h.horseNo)??null}))
  const resultKnown=results.length>0&&results.some(h=>h.rank===1)
  const payload={...race,horses,fieldSize:active.length,releaseFieldSize:race.fieldSize,activeHorseNumbers:active.map(h=>h.horseNo),
    winOdds,baselineOdds,paddock:horses.map(h=>({horseNo:h.horseNo,paddockIndex:h.paddockIndex,horseWeight:h.horseWeight,horseWeightDelta:h.horseWeightDelta})),
    weather,going,observedAt,sourcePublishedAt,retrievedAt,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at',source,sourceHash,
    results,payouts:[...payouts.values()],refunds:null,refundStatus:'not-provided-by-screen',resultsPublishedAt:null,resultsRetrievedAt:resultKnown?retrievedAt:null,
    finalWinOdds:finalPrice&&Object.keys(winOdds).length===active.length?winOdds:null,
    closingPublishedAt:null,closingRetrievedAt:finalPrice?retrievedAt:null,
    priceStatus:finalPrice?'final-visible':sourcePublishedAt?'timestamped':'publication-time-unverified',
    quotes:active.filter(h=>h.placeOddsLower).map(h=>({type:'複勝',numbers:[h.horseNo],odds:h.placeOddsLower,upper:h.placeOddsLower,rangeStatus:'lower-only'})),
    paddockComments:raw.paddockComments??[], rawResultTable:raw.resultTables??[],rawPayoutTable:raw.payoutTables??[]}
  const eventId=hash(['LIVE_RACE',race.raceId,retrievedAt,sourceHash])
  const observation={eventId,kind:'LIVE_RACE',retrievedAt,sourceHash,payload}
  const snapshots=[...history.snapshots]
  if(Object.keys(winOdds).length===active.length&&!finalPrice) {
    snapshots.push({schemaVersion:2,id:hash(['win',eventId]),raceId:race.raceId,raceDate:race.raceDate,kind:'observed',time:clockText??new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(observedAt)),
      observedAt,sourcePublishedAt,retrievedAt,source,odds:winOdds,revisionOf:null,activeHorseNumbers:payload.activeHorseNumbers,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at'})
  }
  if(Object.keys(baselineOdds).length===active.length)snapshots.push({schemaVersion:2,id:hash(['baseline',eventId]),raceId:race.raceId,raceDate:race.raceDate,kind:'baseline',
    time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit'}).format(new Date(retrievedAt)),observedAt:retrievedAt,sourcePublishedAt:null,retrievedAt,source,odds:baselineOdds,revisionOf:null,availabilityAt:retrievedAt,timingEvidence:'observed-visible-at'})
  // Baseline is recorded at actual capture time, never backdated to its presumed publication.
  return {observation,snapshots,completeOdds:Object.keys(winOdds).length===active.length}
}

function showsExpectedField(expected) {
  const normalize = name => String(name ?? '').normalize('NFKC').replace(/[\s　＊*]/g, '')
  const rows = [...document.querySelectorAll('#horse_grid0 tr[id]')]
  const displayed = rows.map(row => {
    const number = row.querySelector('[aria-describedby="horse_grid0_umaban"]')
    const name = row.querySelector('[aria-describedby="horse_grid0_bamei9m"]')
    return number ? [Number(normalize(number.innerText)), normalize(name?.innerText)] : null
  }).filter(Boolean)
  const names = new Map(expected)
  return displayed.length === names.size && new Set(displayed.map(([no]) => no)).size === names.size
    && displayed.every(([no, name]) => name && name === names.get(no))
}

export async function capturePage(page, race) {
  const sourceUrl=`https://jrdb.com/member/n_live_${race.raceDate}_${race.raceId}.html`
  const response=await page.goto(sourceUrl,{waitUntil:'domcontentloaded',timeout:30000})
  if(response&&[401,403].includes(response.status())) { const error=new Error('JRDBの認証期限が切れています。');error.code='auth_required';throw error }
  try {await page.locator('#horse_grid0 tr[id] td[aria-describedby="horse_grid0_umaban"]').first().waitFor({timeout:12000})} catch {const e=new Error('対象馬柱を確認できません。ログイン状態を確認してください。');e.code='auth_required';throw e}
  const expected = race.horses.map(horse => [Number(horse.horseNo), normalize(horse.name).replace(/[＊*]/g, '')])
  if (!(await page.evaluate(showsExpectedField, expected))) {
    // The member page can restore the last race even when the requested URL is different.
    // Select the published entry and wait for its runner list before collecting any results.
    if (!/^[0-9a-f]{8}$/i.test(race.raceId)) throw Object.assign(new Error('対象レースを特定できません。'), { code: 'wrong_race' })
    const option = page.locator('[id="jqs_jo_' + race.raceId + '"]')
    try {
      if (!(await option.isVisible())) await page.locator('a.sctble_display:visible').first().click({ timeout: 3000 })
      await option.click({ timeout: 3000 })
      await page.waitForFunction(showsExpectedField, expected, { timeout: 6000 })
    } catch {
      throw Object.assign(new Error('対象レースの馬柱に切り替えられませんでした。'), { code: 'wrong_race' })
    }
  }
  const raw=await page.evaluate(()=>{
    const tableRows=selector=>Array.from(document.querySelectorAll(selector)).map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>cell.innerText.trim()))
    const rows=Array.from(document.querySelectorAll('#horse_grid0 tr[id]')).filter(row=>row.querySelector('[aria-describedby="horse_grid0_umaban"]')).map(row=>Object.fromEntries(Array.from(row.querySelectorAll('td[aria-describedby]')).map(cell=>[cell.getAttribute('aria-describedby').replace('horse_grid0_',''),cell.innerText.trim()])))
    return {rows,weather:document.querySelector('#tenki_all')?.innerText??'',oddsLabel:document.querySelector('#infomation_block')?.innerText??'',
      resultTables:tableRows('#results table tr'),payoutTables:tableRows('#payback table tr'),paddockComments:[],
      historyTable:Array.from(document.querySelectorAll('#tabs-5 table tr')).map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>({text:cell.innerText.trim(),rowspan:cell.rowSpan,colspan:cell.colSpan})))}
  })
  const historyTab=page.locator('a[href="#tabs-5"]')
  if(await historyTab.count()){
    await historyTab.click()
    try {await page.locator('#tabs-5 table tr').first().waitFor({timeout:10000})} catch { /* explicit empty history remains missing */ }
    raw.historyTable=await page.locator('#tabs-5 table tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll(':scope > th,:scope > td')).map(cell=>({text:cell.innerText.trim(),rowspan:cell.rowSpan,colspan:cell.colSpan}))))
  }
  return {raw,...parseVisibleRace(raw,race,{sourceUrl,retrievedAt:new Date().toISOString()})}
}
