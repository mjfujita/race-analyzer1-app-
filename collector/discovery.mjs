import { safeJrdbUrl } from './capture.mjs'

/** Follow links actually published by the member page; do not fabricate race IDs. */
export async function discoverDayRaces(page,date,known=[]){
  await page.goto('https://jrdb.com/member/',{waitUntil:'domcontentloaded',timeout:30000})
  const candidates=await page.locator('a[href]').evaluateAll(links=>links.map(link=>link.href))
  const urls=[]
  for(const value of candidates){try{const url=safeJrdbUrl(value);const match=/\/n_live_(\d{8})_([0-9a-f]{8})\.html$/i.exec(url.pathname)
    if(match&&match[1]===date&&!known.some(r=>r.raceId===match[2]))urls.push({url:`${url.origin}${url.pathname}`,raceId:match[2]})}catch{/* unrelated member navigation */}}
  const races=[]
  for(const item of urls.slice(0,36)){
    await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000})
    try{await page.locator('#horse_grid0 tr[id] td[aria-describedby="horse_grid0_umaban"]').first().waitFor({timeout:10000})}catch{continue}
    const info=await page.evaluate(()=>{
      const body=document.body.innerText,time=body.match(/([0-2]?\d):([0-5]\d)\s*発走/)
      const rows=Array.from(document.querySelectorAll('#horse_grid0 tr[id]')).filter(r=>r.querySelector('[aria-describedby="horse_grid0_umaban"]'))
      const value=(row,key)=>row.querySelector(`[aria-describedby="horse_grid0_${key}"]`)?.innerText.trim()??''
      const horses=rows.map(row=>({horseNo:Number(value(row,'umaban')),no:Number(value(row,'umaban')),name:value(row,'bamei9m'),
        idm:Number(value(row,'idm').replace(/[◎○▲△▽注消☆＊*\s]/g,''))||null,style:value(row,'txt_kyakusitsu'),pastRuns:[]}))
      return {postTime:time?time[1].padStart(2,'0')+time[2]:null,horses,surface:/芝\s*\d{3,4}M/i.test(body)?'芝':/ダ[ーﾄト]*\s*\d{3,4}M/i.test(body)?'ダート':null,distance:Number(body.match(/(?:芝|ダート|ダ)\s*(\d{3,4})M/i)?.[1])||null}
    })
    if(!info.postTime||info.horses.length<2||info.horses.length>18||new Set(info.horses.map(h=>h.horseNo)).size!==info.horses.length||info.horses.some(h=>!h.name||h.horseNo<1||h.horseNo>18))continue
    races.push({raceId:item.raceId,raceDate:date,postTime:info.postTime,fieldSize:info.horses.length,placeCode:item.raceId.slice(0,2),raceNo:Number(item.raceId.slice(-2)),
      surface:info.surface,surfaceCode:info.surface==='芝'?'1':info.surface==='ダート'?'2':null,distance:info.distance,name:`${item.raceId.slice(0,2)}場${Number(item.raceId.slice(-2))}R`,horses:info.horses,statistics:[],catalogSource:'jrdb-visible-field',catalogRetrievedAt:new Date().toISOString()})
  }
  return races
}
