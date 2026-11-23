import {test,expect} from '@playwright/test'
import {race,horses,demoSnapshots} from '../../dev/fixtures.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'

test('capture acknowledgement updates live observations, preserves a selected past observation, and exposes failure/expiry',async({page})=>{
  const ownerId='synthetic-demo-groups-connected-capture',store=memoryStore()
  let clock=Date.parse('2026-11-15T06:31:00Z'),mode='ready'
  const service=createCompanionService({store,ownerId,now:()=>clock})
  const handler=createCompanionHandler({service,ownerId,authenticateUser:async()=>({id:ownerId})})
  const ingest=async snapshots=>service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:new Date(clock).toISOString(),
    status:{state:'ready'},races:[{raceId:race.id,raceDate:race.raceDate,race:{...race,horses},snapshots,observations:[]}]})
  await ingest(demoSnapshots().filter(s=>s.time!=='15:30'))
  await page.clock.install({time:new Date(clock)})
  await page.setViewportSize({width:390,height:844})
  await page.route('https://*.supabase.co/**',r=>r.fulfill({status:503,json:{message:'fixture'}}))
  await page.route('**/api/companion**',async route=>{
    const req=route.request(),url=new URL(req.url())
    if(mode==='offline'&&url.searchParams.has('capture'))return route.fulfill({status:503,json:{error:{message:'取得状況に接続できません。'}}})
    const response=await request(handler,{method:req.method(),query:Object.fromEntries(url.searchParams),body:req.postData()??undefined})
    await route.fulfill({status:response.status,headers:response.headers,json:response.body})
  })
  await page.goto('/market-preview.html?state=groups-connected-capture')
  const observation=page.getByLabel('観測時点')
  await expect(observation).toHaveValue('demo-1')
  await page.getByRole('button',{name:'JRDBへ最新取得を依頼',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'PCの取得ワーカーの処理待ち'})).toBeVisible()
  await expect(page.getByRole('button',{name:'PCの取得処理待ち…',exact:true})).toBeDisabled()
  await expect(observation).toHaveValue('demo-1')
  await ingest(demoSnapshots())
  const pending=(await service.pullCommands()).commands[0]
  await service.acknowledgeCommand({id:pending.id,status:'completed'})
  await page.getByRole('button',{name:'取得状況を確認',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'取得・クラウドへの送信が完了'})).toBeVisible()
  await expect(observation).toHaveValue('demo-2')
  await observation.selectOption('demo-0')
  await expect(page.getByRole('button',{name:'最新の観測を表示',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'保存済みデータと同期',exact:true}).click()
  await expect(observation).toHaveValue('demo-0')
  await page.getByRole('button',{name:'最新の観測を表示',exact:true}).click()
  await expect(observation).toHaveValue('demo-2')
  await page.getByRole('button',{name:'JRDBへ最新取得を依頼',exact:true}).click()
  await expect(page.getByRole('button',{name:'PCの取得処理待ち…',exact:true})).toBeVisible()
  const failed=(await service.pullCommands()).commands[0]
  await service.acknowledgeCommand({id:failed.id,status:'failed'})
  await page.getByRole('button',{name:'取得状況を確認',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('取得に失敗しました')
  await page.getByRole('button',{name:'JRDBへ最新取得を依頼',exact:true}).click()
  await expect(page.getByRole('button',{name:'PCの取得処理待ち…',exact:true})).toBeVisible()
  clock+=300001
  await page.getByRole('button',{name:'取得状況を確認',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('5分以内に処理されませんでした')
  mode='offline'
  await page.clock.runFor(10001)
  await expect(page.getByRole('alert').filter({hasText:'取得状況に接続できません'})).toBeVisible()
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
