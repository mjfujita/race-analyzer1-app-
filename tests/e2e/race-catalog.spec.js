import {test,expect} from '@playwright/test'
import initSqlJs from 'sql.js'
import {gzipSync} from 'node:zlib'
import {race,horses} from '../../dev/fixtures.js'
import {createDeviceAuth,createDeviceHandler,checkDeviceOrigin} from '../../server/deviceAuth.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'

async function connect(page){
  const ownerId='synthetic-catalog-owner',stamp='2026-11-23T00:00:00Z',store=memoryStore()
  const auth=createDeviceAuth({store,ownerId,authenticateAccount:async()=>({id:ownerId})})
  const device=createDeviceHandler({auth,createDbUrl:async()=>'/fixture-old-paci.gz'})
  const service=createCompanionService({store,ownerId,now:()=>Date.parse(stamp)})
  const companion=createCompanionHandler({service,ownerId,authenticateUser:async()=>null,
    authenticateDevice:async req=>(await auth.authenticateDevice(req))?.user,checkDeviceWrite:checkDeviceOrigin})
  const registered=await request(device,{method:'POST',body:{action:'register'},headers:{host:'127.0.0.1:4183',origin:'http://127.0.0.1:4183','x-race-device':'1'}})
  const races=['03','05'].flatMap(placeCode=>Array.from({length:12},(_,i)=>{
    const id=`${placeCode}2656${String(i+1).padStart(2,'0')}`
    return {raceId:id,raceDate:'20261123',race:{...race,id,raceDate:'20261123',placeCode,raceNo:i+1,
      name:`${placeCode==='05'?'東京':'福島'}の当日レース${i+1}`,distance:1600,postTime:`${String(9+Math.floor(i/2)).padStart(2,'0')}${i%2?'30':'00'}`,horses},snapshots:[],observations:[]}
  }))
  await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:stamp,status:{state:'ready'},races})
  const SQL=await initSqlJs(),db=new SQL.Database()
  db.run(`CREATE TABLE jrdb_races (race_key TEXT,race_date TEXT,place_code TEXT,race_no INTEGER,post_time TEXT,distance INTEGER,surface_code TEXT,grade TEXT,field_size INTEGER,race_name TEXT);
    INSERT INTO jrdb_races VALUES ('OLD260101','20261115','03',1,'0940',1150,'2','',2,'保存済みの過去レース');
    CREATE TABLE jrdb_horses (id TEXT); CREATE TABLE jrdb_results (id TEXT);
    CREATE TABLE race_evaluations (race_key TEXT,payload TEXT,evaluator_version TEXT,evaluated_at TEXT); CREATE TABLE race_summaries (race_key TEXT);`)
  const bytes=gzipSync(db.export());db.close()
  const control={fail:false,empty:false,requests:0,release:null}
  const ready=new Promise(resolve=>{control.release=resolve})
  await page.clock.setFixedTime(new Date(stamp))
  await page.setViewportSize({width:390,height:844})
  await page.route('**/fixture-bootstrap',route=>route.fulfill({status:200,headers:registered.headers,json:registered.body}))
  await page.route('**/fixture-old-paci.gz',route=>route.fulfill({status:200,contentType:'application/gzip',body:bytes}))
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),headers=await req.allHeaders()
    if(url.searchParams.has('dashboard')){
      // Simulate a dashboard that never completes before the user leaves the home page.
      return route.abort('timedout')
    }
    if(url.searchParams.has('catalog')){
      control.requests++;await ready
      if(control.fail)return route.fulfill({status:503,json:{error:{message:'同期サーバーに接続できません。'}}})
      if(control.empty)return route.fulfill({json:{schemaVersion:1,date:'20261123',availableRaces:[]}})
    }
    const response=await request(url.pathname==='/api/device'?device:companion,{method:req.method(),token:null,
      headers:{...headers,host:url.host},query:Object.fromEntries(url.searchParams),body:req.postData()??undefined})
    await route.fulfill({status:response.status,headers:response.headers,json:response.body})
  })
  await page.goto('/fixture-bootstrap');await page.goto('/')
  await page.getByRole('button',{name:'過去開催・PACIレース一覧',exact:true}).click()
  await expect(page.getByLabel('開催日')).toHaveValue('20261115')
  return control
}

test('mobile archive loads today from its own API with an old cached PACI and failed dashboard',async({page})=>{
  const control=await connect(page)
  await expect(page.getByText('本日の開催一覧を確認しています…')).toBeVisible()
  await expect(page.getByLabel('開催日')).toBeDisabled()
  control.release()
  await expect(page.getByLabel('開催日')).toHaveValue('20261123')
  await expect(page.getByLabel('開催日').getByRole('option')).toHaveText(['2026/11/23 (月) (24R)','2026/11/15 (日) (1R)'])
  await expect(page.getByRole('button',{name:/^\d+R /})).toHaveCount(24)
  await expect(page.getByRole('region',{name:'選択開催の取込件数'})).toContainText('24')
  await expect(page.getByRole('region',{name:'選択開催の取込件数'})).toContainText('192')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({path:'.qa/catalog-mobile-fixture.png',fullPage:true})
  await page.getByLabel('開催日').selectOption('20261115')
  await page.getByRole('button',{name:'開催一覧を再取得'}).click()
  await expect(page.getByRole('button',{name:'開催一覧を再取得'})).toBeEnabled()
  await expect(page.getByLabel('開催日')).toHaveValue('20261115')
  await page.getByLabel('開催日').selectOption('20261123')
  await page.getByRole('button',{name:'1R 09:00 東京の当日レース1 芝1600m ・ 8頭',exact:true}).click()
  await expect(page.getByRole('heading',{name:'東京1R 東京の当日レース1'})).toBeVisible()
  expect(control.requests).toBeGreaterThanOrEqual(2)
})

test('catalog failures are visible and retry replaces the old-only archive with today',async({page})=>{
  const control=await connect(page);control.fail=true;control.release()
  await expect(page.getByRole('alert')).toContainText('本日の開催一覧を取得できませんでした。')
  await expect(page.getByLabel('開催日')).toHaveValue('20261115')
  control.fail=false
  await page.getByRole('button',{name:'開催一覧を再取得'}).click()
  await expect(page.getByLabel('開催日')).toHaveValue('20261123')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByLabel('開催日').selectOption('20261123')
  control.empty=true
  await page.getByRole('button',{name:'開催一覧を再取得'}).click()
  await expect(page.getByText('本日の同期済みレースはまだありません。保存済みPACIから過去の開催を選べます。')).toBeVisible()
  await expect(page.getByLabel('開催日')).toHaveValue('20261115')
})
