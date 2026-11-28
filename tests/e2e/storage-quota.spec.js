import {test,expect} from '@playwright/test'
import {race,horses,demoSnapshots} from '../../dev/fixtures.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'
const odds={1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}
const events=demoSnapshots().filter(s=>s.kind==='observed'&&Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z')).map(s=>({...s,odds}))

test('a genuinely full browser recovers sync, keeps unsent predictions and registered groups, then updates through the API',async({page})=>{
 const state='groups-connected-quota',userId=`synthetic-demo-${state}`,service=createCompanionService({store:memoryStore(),ownerId:userId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:20:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:20:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:events,observations:[]}]})
 const handler=createCompanionHandler({service,ownerId:userId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:userId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 await page.route('**/api/companion**',async route=>{
  const req=route.request(),url=new URL(req.url()),response=await request(handler,{token:null,method:req.method(),body:req.method()==='POST'?req.postDataJSON():undefined,query:Object.fromEntries(url.searchParams)})
  await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})
 })
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-11-15T07:10:00Z'))
 await page.goto(`/market-preview.html?state=${state}`)
 const panel=page.getByRole('region',{name:'グループの独立登録'})
 await panel.getByRole('button',{name:'グループを登録',exact:true}).click()
 await expect(panel.getByRole('button',{name:'グループ登録済み',exact:true})).toBeVisible()
 const before=await page.evaluate(async({race,horses,events,userId})=>{
  const {createPrediction,writeJournal,journalKey}=await import('/src/predictionJournal.js')
  const plan=createPrediction({race,field:horses.map(({no,name})=>({no,name})),snapshot:events.at(-1),slots:[['B'],['A'],[]],type:'馬単'},'2026-11-15T06:25:00Z','unsent-personal-prediction')
  await writeJournal(localStorage,userId,race.raceDate,{predictions:[plan],results:[]})
  localStorage.setItem('quota-test-device-approval','protected-device-value')
  const saved=Object.fromEntries(Object.keys(localStorage).filter(k=>!k.startsWith('race-companion-cache:')).map(k=>[k,localStorage.getItem(k)]))
  let quota=0,index=0
  for(const chunk of [200000,1024]){
   for(let i=0;i<6000;i++){
    try{localStorage.setItem(`race-companion-cache:v1:${userId}:2026-11-14:old-${index++}`,JSON.stringify({fetchedAt:'2026-11-14T00:00:00Z',copy:'x'.repeat(chunk)}))}
    catch(error){if(error.name!=='QuotaExceededError')throw error;quota++;break}
   }
  }
  return {saved,quota,journalKey:journalKey(userId,race.raceDate),cacheCount:Object.keys(localStorage).filter(k=>k.startsWith('race-companion-cache:')).length}
 },{race,horses,events,userId})
 expect(before.quota).toBe(2);expect(before.cacheCount).toBeGreaterThan(10)
 await page.reload()
 await expect(panel.getByRole('button',{name:'グループ登録済み',exact:true})).toBeVisible()
 await expect.poll(()=>page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('race-companion-cache:')).length)).toBeLessThan(before.cacheCount)
 await expect(panel).toContainText('表示中のグループは登録済みです。')
 await expect(page.getByRole('alert')).toHaveCount(0)
 const after=await page.evaluate(saved=>({saved:Object.fromEntries(Object.keys(saved).map(k=>[k,localStorage.getItem(k)])),cacheCount:Object.keys(localStorage).filter(k=>k.startsWith('race-companion-cache:')).length}),before.saved)
 expect(after.saved).toEqual(before.saved);expect(after.cacheCount).toBeLessThan(before.cacheCount)
 expect((await service.getPredictionJournal({raceDate:race.raceDate})).predictions).toEqual([])
 await page.getByLabel('3番の前で区切る',{exact:true}).uncheck()
 await panel.getByRole('button',{name:'グループ登録を更新',exact:true}).click()
 await expect(panel.getByRole('button',{name:'グループ登録済み',exact:true})).toBeVisible()
 expect((await service.getPredictionJournal({raceDate:race.raceDate})).registrations).toHaveLength(2)
 expect(await page.evaluate(key=>JSON.parse(localStorage.getItem(key)).predictions[0].id,before.journalKey)).toBe('unsent-personal-prediction')
 expect(errors).toEqual([])
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await panel.screenshot({path:'.qa/quota-recovered-mobile.png'})
})
