import {test,expect} from '@playwright/test'
import {race,aceHorses as horses,demoSnapshots} from '../../dev/fixtures.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'

test('groups of active runners can be registered with a withdrawn horse and restored without inventing probabilities',async({page})=>{
 const state='groups-connected-withdrawal',userId=`synthetic-demo-${state}`,cancelledHorses=horses.map(h=>h.no===7?{...h,cancelled:true}:h)
 const snapshot={...demoSnapshots()[2],odds:{1:3,2:3.5,3:8,4:9,5:20,6:25,8:100}}
 const service=createCompanionService({store:memoryStore(),ownerId:userId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:20:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:20:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses:cancelledHorses},snapshots:[snapshot],observations:[]}]})
 const handler=createCompanionHandler({service,ownerId:userId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:userId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 await page.route('**/api/companion**',async route=>{
  const req=route.request(),url=new URL(req.url()),response=await request(handler,{token:null,method:req.method(),body:req.method()==='POST'?req.postDataJSON():undefined,query:Object.fromEntries(url.searchParams)})
  await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})
 })
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-11-15T07:10:00Z'));await page.goto(`/market-preview.html?state=${state}`)
 const panel=page.getByRole('region',{name:'グループの独立登録'})
 await expect(panel).toContainText('取消馬を除く7頭のグループを登録します。')
 await expect(page.getByRole('checkbox',{name:'7番を候補に含める',exact:true})).toHaveCount(0)
 const probability=page.getByRole('region',{name:'A群の推定確率',exact:true})
 await expect(probability).toContainText('推定1着確率')
 await expect(probability.getByRole('definition').first()).toHaveText(/^\d+\.\d%$/)
 await expect(probability).not.toContainText('判定保留')
 await expect(panel.getByRole('button',{name:'グループを登録',exact:true})).toBeEnabled()
 await panel.getByRole('button',{name:'グループを登録',exact:true}).click()
 await expect(panel.getByRole('button',{name:'グループ登録済み',exact:true})).toBeVisible()
 const saved=(await service.getPredictionJournal({raceDate:race.raceDate})).registrations[0]
 expect(saved.field).toHaveLength(7);expect(saved.field.some(h=>h.no===7)).toBe(false)
 expect(saved.probabilities.horses.some(h=>h.no===7)).toBe(false);expect(saved.grouping.membership[7]).toBeUndefined()
 expect(saved.probabilities.groups.every(g=>g.status==='ready')).toBe(true)
 for(const key of ['win','second','third'])expect(saved.probabilities.groups.reduce((sum,g)=>sum+g[key],0)).toBeCloseTo(1,10)
 await page.reload();await expect(panel).toContainText('表示中のグループは登録済みです。')
 await page.getByRole('checkbox',{name:'3番の前で区切る',exact:true}).uncheck()
 await panel.getByRole('button',{name:'グループ登録を更新',exact:true}).click()
 await expect(panel).toContainText('表示中のグループは登録済みです。')
 const day=await service.getPredictionJournal({raceDate:race.raceDate});expect(day.registrations).toHaveLength(2);expect(day.registrations[0]).toEqual(saved)
 expect(day.predictions).toEqual([]);expect(day.results).toEqual([]);expect(errors).toEqual([])
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await panel.screenshot({path:'.qa/withdrawn-registration-mobile.png'})
})
