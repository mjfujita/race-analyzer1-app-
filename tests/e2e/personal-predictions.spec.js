import {expect,test} from '@playwright/test'
import {race,horses,demoSnapshots} from '../../dev/fixtures.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'
const odds={1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100}
const history=()=>demoSnapshots().filter(s=>s.kind==='observed'&&Date.parse(s.observedAt)<=Date.parse('2026-11-15T06:20:00Z')).map(s=>({...s,odds}))
async function open(page,state='personal-flow',start=true){
 await page.clock.setFixedTime(new Date('2026-11-15T06:25:00Z'))
 await page.addInitScript(({race,state,events})=>{const key=`race-ability-odds:v1:synthetic-demo-${state}:${race.raceDate}:${race.id}`;if(!localStorage.getItem(key))localStorage.setItem(key,JSON.stringify(events))},{race,state,events:history()})
 await page.goto(`/market-preview.html?state=${state}`)
 if(start)await page.getByRole('button',{name:'新しい予想を入力する',exact:true}).click()
}
const journal=page=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-prediction-journal:')))))
async function select(page,position,group){await page.getByRole('group',{name:`${position}着のグループ`,exact:true}).getByRole('checkbox',{name:new RegExp(`^${group}`)}).check()}
async function save(page){await page.getByRole('button',{name:'私の予想を登録する',exact:true}).click()}
async function enterResult(page,numbers,payout='4560'){
 await page.getByText('画像・手入力で結果を登録する',{exact:true}).click()
 for(let i=0;i<3;i++)await page.getByLabel(`${i+1}着の馬番`,{exact:true}).selectOption(String(numbers[i]))
 await page.getByLabel('馬単の確定払戻（100円あたり）',{exact:true}).fill(payout)
 await page.getByLabel('画像名・確認メモ',{exact:true}).fill('架空の結果画像')
 await page.getByRole('button',{name:'結果を登録する',exact:true}).click()
}
test('selection-only exacta freezes groups and sync changes, then matches image result and persists without purchases',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await open(page)
 await expect(page.getByRole('button',{name:'私の予想を登録する',exact:true})).toBeDisabled()
 await select(page,1,'B');await select(page,2,'A')
 await expect(page.getByLabel('1点の予定金額',{exact:true})).toHaveCount(0)
 await expect(page.getByRole('table',{name:'私の予想の買い目'}).locator('tbody tr')).toHaveCount(4)
 await page.getByLabel('予想メモ',{exact:true}).fill('B勝ち・A2着を試す')
 await page.evaluate(({race,events})=>localStorage.setItem(`race-ability-odds:v1:synthetic-demo-personal-flow:${race.raceDate}:${race.id}`,JSON.stringify([{...events[1],id:'new-source',odds:{1:8,2:9,3:3,4:3.5,5:20,6:25,7:80,8:100}},...events])),{race,events:history()})
 await page.getByRole('button',{name:'同期データを再読込（開発確認）'}).click();await save(page)
 const saved=page.getByRole('region',{name:'保存したグループ判断'});await expect(saved).toContainText('馬単 · 4点 · 対象 4頭')
 const first=(await journal(page)).predictions[0];expect(first.snapshot.odds[3]).toBe(8);expect(first.slots).toEqual([['B'],['A'],[]]);expect(first.budget).toBeUndefined()
 await enterResult(page,[3,1,5]);await expect(saved).toContainText('グループ未登録');await expect(saved).toContainText('買い目にあり')
 const day=page.getByRole('table',{name:'予想と結果の組み合わせ'});await expect(day).toContainText('4,560円');await expect(day).toContainText('ユーザー画像')
 await page.reload();await expect(saved).toContainText('B勝ち・A2着を試す');await expect(saved).toContainText('買い目にあり')
 expect((await journal(page)).predictions[0]).toEqual(first)
 expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('race-forecast-ledger:')))).toEqual([])
 expect(errors).toEqual([])
})
test('BOX and third-place axis work without allocations, duplicates or budget caps on mobile',async({page})=>{
 await page.setViewportSize({width:390,height:844});await open(page,'personal-methods')
 await page.getByLabel('買い方',{exact:true}).selectOption('box')
 const box=page.getByRole('group',{name:'BOXにするグループ'});for(const g of ['A','B'])await box.getByRole('checkbox',{name:new RegExp(`^${g}`)}).check()
 await expect(page.getByRole('table',{name:'私の予想の買い目'}).locator('tbody tr')).toHaveCount(12)
 await page.getByLabel('券種',{exact:true}).selectOption('3連複');await expect(page.getByRole('table',{name:'私の予想の買い目'}).locator('tbody tr')).toHaveCount(4)
 await page.getByLabel('券種',{exact:true}).selectOption('3連単');await page.getByLabel('買い方',{exact:true}).selectOption('flow')
 await page.getByLabel('軸グループ',{exact:true}).selectOption('A');await page.getByLabel('軸の着順',{exact:true}).selectOption('2')
 for(const g of ['B','C'])await page.getByRole('group',{name:'相手のグループ'}).getByRole('checkbox',{name:new RegExp(`^${g}`)}).check()
 await expect(page.getByRole('table',{name:'私の予想の買い目'}).locator('tbody tr')).toHaveCount(24)
 await save(page);await expect(page.getByRole('region',{name:'保存したグループ判断'})).toContainText('24点');expect((await journal(page)).predictions[0].slots).toEqual([['B','C'],['B','C'],['A']]);expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
test('result corrections retain original and update day tendency only once per race',async({page})=>{
 await open(page,'personal-correction');await select(page,1,'B');await select(page,2,'A');await save(page);await enterResult(page,[3,1,5])
 await page.getByText('結果を確認・訂正する',{exact:true}).click();await page.getByLabel('1着の馬番',{exact:true}).selectOption('1');await page.getByLabel('2着の馬番',{exact:true}).selectOption('3')
 await page.getByRole('button',{name:'訂正した結果を保存',exact:true}).click()
 const saved=page.getByRole('region',{name:'保存したグループ判断'});await expect(saved).toContainText('買い目になし');expect((await journal(page)).results).toHaveLength(2)
 await expect(page.getByRole('region',{name:'当日の予想・結果一覧'})).toContainText('照合できた0レース')
 await page.reload();await expect(saved).toContainText('グループ未登録')
})
test('authenticated cloud journal restores on a second browser cache and rejects unauthorized writes',async({page})=>{
 const state='personal-connected-journal',ownerId=`synthetic-demo-${state}`,store=memoryStore(),service=createCompanionService({store,ownerId,now:()=>Date.parse('2026-11-15T06:25:00Z')})
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:20:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:20:00Z'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots:history(),observations:[]}]})
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:ownerId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 await page.route('**/api/companion**',async route=>{const req=route.request(),url=new URL(req.url()),body=req.method()==='POST'?req.postDataJSON():undefined,response=await request(handler,{token:null,method:req.method(),body,query:Object.fromEntries(url.searchParams)});await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})})
 await open(page,state);await select(page,1,'B');await select(page,2,'A');await save(page)
 await expect(page.getByRole('region',{name:'保存したグループ判断'})).toContainText('発走前のクラウド受付あり')
 await page.evaluate(()=>{for(const k of Object.keys(localStorage))if(k.startsWith('race-prediction-journal:'))localStorage.removeItem(k)})
 await page.reload();await expect(page.getByRole('region',{name:'保存したグループ判断'})).toContainText('馬単 · 4点')
 expect((await service.getPredictionJournal({raceDate:race.raceDate})).predictions).toHaveLength(1)
})
test('corrupt journal remains intact, and missing odds blocks new predictions',async({page})=>{
 await page.addInitScript(({race})=>localStorage.setItem(`race-prediction-journal:v1:synthetic-demo-personal-corrupt:${race.raceDate}`,'{broken'),{race})
 await open(page,'personal-corrupt',false);await expect(page.getByRole('alert')).toContainText('JSON')
 expect(await page.evaluate(()=>localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('race-prediction-journal:'))))).toBe('{broken')
 await page.goto('/market-preview.html?state=empty');await page.getByRole('button',{name:'私の予想',exact:true}).click();await expect(page.getByRole('button',{name:'新しい予想を入力する',exact:true})).toBeDisabled()
})
test('local preview shows image comparison and day totals without contacting cloud on desktop and mobile',async({page})=>{
 const calls=[];page.on('request',r=>{if(r.url().includes('/api/companion'))calls.push(r.url())})
 await page.goto('/market-preview.html?state=personal-results-local-review')
 const saved=page.getByRole('region',{name:'保存したグループ判断'});await expect(saved).toContainText('予想 A → C → C');await expect(saved).toContainText('A → B → C')
 await expect(page.getByRole('table',{name:'予想と結果の組み合わせ'})).toContainText('12,340円')
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:'.qa/journal-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);await page.screenshot({path:'.qa/journal-mobile.png',fullPage:true});expect(calls).toEqual([])
})
