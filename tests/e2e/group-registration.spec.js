import {test,expect} from '@playwright/test'
import {race,horses,demoSnapshots} from '../../dev/fixtures.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'
const odds={1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}
const history=()=>demoSnapshots().filter(s=>s.kind==='observed'&&Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z')).map(s=>({...s,odds}))
async function open(page,state){
 await page.clock.setFixedTime(new Date('2026-11-15T07:10:00Z'))
 await page.addInitScript(({race,state,events})=>{const key=`race-ability-odds:v1:synthetic-demo-${state}:${race.raceDate}:${race.id}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(events))},{race,state,events:history()})
 await page.goto(`/market-preview.html?state=${state}`)
}
const records=page=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-group-registration:')))))
async function saveResult(page){
 await page.getByText('画像・手入力で結果を登録する',{exact:true}).click()
 for(const [i,no] of [1,3,5].entries())await page.getByLabel(`${i+1}着の馬番`,{exact:true}).selectOption(String(no))
 await page.getByRole('button',{name:'結果を登録する',exact:true}).click()
}
test('registers classification alone, reflects result/tally without a prediction and preserves manual groups on reload',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await open(page,'groups-independent-registration')
 await page.getByLabel('3番の前で区切る',{exact:true}).uncheck()
 await page.getByLabel('3番を候補に含める',{exact:true}).uncheck()
 await page.getByRole('button',{name:'グループを登録',exact:true}).click()
 const registration=page.getByRole('region',{name:'グループの独立登録'})
 await expect(registration).toContainText('表示中のグループは登録済みです。')
 const first=(await records(page))[0];expect(first.grouping.membership[3]).toBe('A');expect(Object.keys(first.grouping.membership)).toHaveLength(8);expect(first.tickets).toBeUndefined()
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-prediction-journal:'))))?.predictions??[])).toEqual([])
 await page.reload();await expect(page.getByLabel('3番の前で区切る',{exact:true})).not.toBeChecked()
 await page.getByRole('button',{name:'登録グループの結果を見る',exact:true}).click();await saveResult(page)
 const comparison=page.getByRole('group',{name:'このレースの予想と結果'})
 await expect(comparison).toContainText('このレースの予想はまだ登録されていません。');await expect(comparison.getByRole('region',{name:'このレースの結果'})).toContainText('A → A → B')
 await expect(page.getByRole('region',{name:'当日の予想・結果一覧'})).toContainText('照合できた1レース')
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:'.qa/group-registration-results-mobile.png',fullPage:true})
 await page.getByRole('button',{name:'登録グループを確認・変更する',exact:true}).click()
 await page.getByLabel('3番の前で区切る',{exact:true}).check()
 await expect(registration).toContainText('変更は未登録です。結果には前回の登録を使っています。')
 await page.getByRole('button',{name:'グループ登録を更新',exact:true}).click()
 await expect(registration).toContainText('表示中のグループは登録済みです。')
 expect(await records(page)).toHaveLength(2);expect((await records(page))[1].replacesId).toBe(first.id)
 await page.getByRole('button',{name:'登録グループの結果を見る',exact:true}).click();await expect(comparison.getByRole('region',{name:'このレースの結果'})).toContainText('A → B → C')
 await expect(page.getByRole('region',{name:'当日の予想・結果一覧'})).toContainText('照合できた1レース')
 expect(errors).toEqual([])
})
test('a later registration changes the result classification but keeps saved prediction numbers and grouping frozen',async({page})=>{
 await page.goto('/market-preview.html?state=personal-results-local-review')
 const before=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-prediction-journal:')))).predictions)
 await page.getByRole('button',{name:'登録グループを確認・変更する',exact:true}).click()
 await page.getByLabel('3番の前で区切る',{exact:true}).uncheck()
 await page.getByRole('button',{name:'グループ登録を更新',exact:true}).click()
 await expect(page.getByRole('region',{name:'グループの独立登録'})).toContainText('表示中のグループは登録済みです。')
 await page.getByRole('button',{name:'登録グループの結果を見る',exact:true}).click()
 const comparison=page.getByRole('group',{name:'このレースの予想と結果'})
 await expect(comparison.getByRole('region',{name:'保存した予想'})).toContainText('A → C → C')
 await expect(comparison.getByRole('region',{name:'このレースの結果'})).toContainText('A → A → B')
 const after=await page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-prediction-journal:')))).predictions)
 expect(after).toEqual(before)
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:'.qa/group-registration-results-desktop.png',fullPage:true})
})
test('cloud registration restores manual boundaries on another cache and a later observation needs explicit registration',async({page})=>{
 const state='groups-connected-registration',ownerId=`synthetic-demo-${state}`,store=memoryStore(),service=createCompanionService({store,ownerId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:20:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:20:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:history(),observations:[]}]})
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:ownerId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 await page.route('**/api/companion**',async route=>{const req=route.request(),url=new URL(req.url()),response=await request(handler,{token:null,method:req.method(),body:req.method()==='POST'?req.postDataJSON():undefined,query:Object.fromEntries(url.searchParams)});await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})})
 await open(page,state);await page.getByLabel('3番の前で区切る',{exact:true}).uncheck();await page.getByRole('button',{name:'グループを登録',exact:true}).click()
 await expect(page.getByRole('status').filter({hasText:'グループをクラウドに登録'})).toBeVisible()
 const first=(await records(page))[0]
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('race-group-registration:'))localStorage.removeItem(k)})
 await page.reload();await expect(page.getByLabel('3番の前で区切る',{exact:true})).not.toBeChecked()
 await expect(page.getByRole('region',{name:'グループの独立登録'})).toContainText('表示中のグループは登録済みです。')
 expect((await records(page))[0]).toEqual(first)
 const next={...history().at(-1),id:'later-observation',time:'15:30',observedAt:'2026-11-15T06:30:00Z',sourcePublishedAt:'2026-11-15T06:30:00Z',retrievedAt:'2026-11-15T06:30:00Z',odds:{1:3,2:3.5,3:6,4:7,5:20,6:25,7:80,8:100}}
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:30:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:30:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:[next],observations:[]}]})
 await page.getByRole('button',{name:'同期データを再読込（開発確認）'}).click()
 await page.getByRole('button',{name:'最新の観測を表示',exact:true}).click()
 await expect(page.getByRole('region',{name:'グループの独立登録'})).toContainText('変更は未登録です。')
 const cloud=await service.getPredictionJournal({raceDate:race.raceDate});expect(cloud.registrations).toEqual([first]);expect(cloud.predictions).toEqual([])
})
test('failed cloud update retains the prior result classification and draft until an explicit retry',async({page})=>{
 const state='groups-connected-registration-failure',ownerId=`synthetic-demo-${state}`,service=createCompanionService({store:memoryStore(),ownerId,now:()=>Date.parse('2026-11-15T07:15:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:20:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:20:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:history(),observations:[]}]})
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:ownerId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 let fail=false;const attempts=[]
 await page.route('**/api/companion**',async route=>{
  const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():undefined
  if(body?.action==='save-groups'){
   attempts.push(body.record)
   if(fail){fail=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'架空の通信エラー'})});return}
  }
  const response=await request(handler,{token:null,method:req.method(),body,query:Object.fromEntries(url.searchParams)});await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})
 })
 await open(page,state);await page.getByRole('button',{name:'グループを登録',exact:true}).click()
 const panel=page.getByRole('region',{name:'グループの独立登録'});await expect(panel).toContainText('表示中のグループは登録済みです。')
 const first=(await records(page))[0]
 await page.getByLabel('3番の前で区切る',{exact:true}).uncheck();fail=true
 await page.getByRole('button',{name:'グループ登録を更新',exact:true}).click()
 await expect(page.getByRole('alert').filter({hasText:'グループの登録は未完了'})).toBeVisible()
 expect(await records(page)).toEqual([first]);expect((await service.getPredictionJournal({raceDate:race.raceDate})).registrations).toEqual([first])
 await expect(page.getByLabel('3番の前で区切る',{exact:true})).not.toBeChecked()
 await page.getByRole('button',{name:'登録状態を再読込',exact:true}).click()
 await expect(panel).toContainText('変更は未登録です。')
 await page.getByRole('button',{name:'グループ登録を更新',exact:true}).click();await expect(panel).toContainText('表示中のグループは登録済みです。')
 expect(attempts[2]).toEqual(attempts[1]);expect(await records(page)).toHaveLength(2)
})
