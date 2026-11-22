import {test,expect} from '@playwright/test'
import {createDeviceAuth,createDeviceHandler,checkDeviceOrigin} from '../../server/deviceAuth.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'
import initSqlJs from 'sql.js'
import {gzipSync} from 'node:zlib'

test('PC approval and one-use phone pairing survive reload, while revocation blocks the phone',async({browser})=>{
  const ownerId='synthetic-device-owner',token='synthetic-device-account',store=memoryStore()
  const authenticateAccount=async t=>t===token?{id:ownerId,email:'device@example.invalid'}:null
  const auth=createDeviceAuth({store,ownerId,authenticateAccount})
  const device=createDeviceHandler({auth,createDbUrl:async()=>{throw Error('fixture DB absent')}})
  const service=createCompanionService({store,ownerId,schedule:async()=>'unconfirmed'})
  const companion=createCompanionHandler({service,ownerId,authenticateUser:authenticateAccount,
    authenticateDevice:async req=>(await auth.authenticateDevice(req))?.user,checkDeviceWrite:checkDeviceOrigin})
  let code
  async function wire(context){
    await context.route('https://*.supabase.co/**',route=>route.fulfill({status:503,json:{message:'fixture unavailable'}}))
    await context.route('https://*.supabase.co/auth/v1/logout*',route=>route.fulfill({status:200,json:{}}))
    await context.route('**/api/**',async route=>{
      const req=route.request(),url=new URL(req.url()),headers=await req.allHeaders()
      const response=await request(url.pathname==='/api/device'?device:companion,{
        method:req.method(),token:headers.authorization?.slice(7)??null,
        headers:{...headers,host:url.host},query:Object.fromEntries(url.searchParams),body:req.postData()??undefined,
      })
      if(response.body?.code)code=response.body.code
      await route.fulfill({status:response.status,headers:response.headers,json:response.body})
    })
  }
  const pc=await browser.newContext({baseURL:'http://127.0.0.1:4183',viewport:{width:1280,height:960}})
  const phone=await browser.newContext({baseURL:'http://127.0.0.1:4183',viewport:{width:390,height:844},userAgent:'iPhone synthetic browser'})
  try{
    await wire(pc);await wire(phone)
    const page=await pc.newPage(),mobile=await phone.newPage(),errors=[]
    page.on('pageerror',e=>errors.push(e.message));mobile.on('pageerror',e=>errors.push(e.message))
    await page.addInitScript(({ownerId,token})=>{
      if(!sessionStorage.getItem('fixture-seeded')){
        sessionStorage.setItem('fixture-seeded','1')
        localStorage.setItem('sb-ojolpyqetwqqnlzhsrgq-auth-token',JSON.stringify({access_token:token,refresh_token:'fixture',expires_at:Date.now()/1000+3600,user:{id:ownerId}}))
      }
    },{ownerId,token})
    await page.goto('/')
    await page.getByRole('button',{name:'端末認証',exact:true}).click()
    await page.getByLabel('端末の名前').fill('本人のPC')
    await page.getByRole('button',{name:'この端末を承認する',exact:true}).click()
    await expect(page.getByText('この端末は承認済みです。次回から同じURLを開くだけで利用できます。')).toBeVisible()
    expect((await pc.cookies()).find(c=>c.name==='__Host-race_device')).toMatchObject({httpOnly:true,secure:true,sameSite:'Strict'})
    await expect.poll(()=>page.evaluate(()=>localStorage.getItem('sb-ojolpyqetwqqnlzhsrgq-auth-token'))).toBeNull()
    await page.reload()
    await page.getByRole('button',{name:'端末認証',exact:true}).click()
    await expect(page.getByText('本人のPC（この端末）')).toBeVisible()
    await page.getByRole('button',{name:'スマホ登録用QRコードを発行'}).click()
    await expect(page.getByRole('img',{name:'本人のスマートフォンを登録する１回限りのQRコード'})).toHaveAttribute('src',/^data:image\/png;base64,/)
    await page.screenshot({path:'.qa/device-pc-fixture.png',fullPage:true})
    expect(code).toHaveLength(43)
    await mobile.goto('/')
    await expect(mobile.getByRole('heading',{name:'この端末は未承認です'})).toBeVisible()
    await expect(mobile.getByRole('button',{name:'ログイン',exact:true})).toHaveCount(0)
    await mobile.goto(`/#device-pair=${code}`)
    await expect(mobile.getByRole('heading',{name:'この端末を登録',exact:true})).toBeVisible()
    expect(new URL(mobile.url()).hash).toBe('')
    await mobile.getByLabel('端末の名前').fill('本人のスマホ')
    await mobile.getByRole('button',{name:'この端末を登録',exact:true}).click()
    await expect(mobile.getByRole('heading',{name:'開催情報を確認中',exact:true})).toBeVisible()
    await mobile.reload()
    await mobile.getByRole('button',{name:'端末認証',exact:true}).click()
    await expect(mobile.getByText('本人のスマホ（この端末）')).toBeVisible()
    expect(await mobile.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await mobile.screenshot({path:'.qa/device-phone-fixture.png',fullPage:true})
    const replayResult=await request(device,{method:'POST',token:null,body:{action:'claim',code},headers:{host:'127.0.0.1:4183',origin:'http://127.0.0.1:4183','x-race-device':'1'}})
    expect(replayResult.status).toBe(409)
    await page.getByRole('button',{name:'端末一覧を更新'}).click()
    const phoneRow=page.locator('.rca-device-list article').filter({hasText:'本人のスマホ'})
    await phoneRow.getByRole('button',{name:'この端末を解除',exact:true}).click()
    await phoneRow.getByRole('button',{name:'解除を確定',exact:true}).click()
    await expect(phoneRow.getByText('解除済み', {exact:true})).toBeVisible()
    await mobile.reload()
    await expect(mobile.getByRole('heading',{name:'この端末は未承認です'})).toBeVisible()
    await page.reload()
    await expect(page.getByRole('heading',{name:'開催情報を確認中',exact:true})).toBeVisible()
    expect(errors).toEqual([])
  }finally{await pc.close();await phone.close()}
})

test('cookie-only PACI download uses the protected endpoint and opens a gzip SQLite database',async({page})=>{
  const auth=createDeviceAuth({store:memoryStore(),ownerId:'synthetic-db-owner',authenticateAccount:async()=>({id:'synthetic-db-owner'})})
  const handler=createDeviceHandler({auth,createDbUrl:async()=>'/private-fixture.db.gz'})
  const registered=await request(handler,{method:'POST',body:{action:'register'},headers:{host:'127.0.0.1:4183',origin:'http://127.0.0.1:4183','x-race-device':'1'}})
  await page.route('**/fixture-bootstrap',route=>route.fulfill({status:200,headers:registered.headers,json:registered.body}))
  await page.goto('/fixture-bootstrap')
  const SQL=await initSqlJs(),db=new SQL.Database()
  db.run('CREATE TABLE fixture (name TEXT); INSERT INTO fixture VALUES (\'PACI cookie path\')')
  const bytes=gzipSync(db.export());db.close()
  let privateRequests=0
  await page.route('**/private-fixture.db.gz',route=>route.fulfill({status:200,contentType:'application/gzip',body:bytes}))
  await page.route('**/api/device?resource=race-db',async route=>{
    const req=route.request(),headers=await req.allHeaders()
    expect(headers.authorization).toBeUndefined()
    const response=await request(handler,{token:null,query:{resource:'race-db'},headers})
    expect(response.status).toBe(200);privateRequests++
    await route.fulfill({status:response.status,headers:response.headers,json:response.body})
  })
  await page.goto('/market-preview.html')
  const result=await page.evaluate(async()=>{
    const {loadDb,queryAll}=await import('/src/lib/db.js')
    const db=await loadDb({forceRefresh:true})
    return queryAll(db,'SELECT * FROM fixture')
  })
  expect(result).toEqual([{name:'PACI cookie path'}])
  expect(privateRequests).toBe(1)
})
