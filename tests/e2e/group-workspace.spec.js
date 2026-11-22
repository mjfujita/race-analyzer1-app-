import { expect, test } from '@playwright/test'
import { race, horses, demoSnapshots } from '../../dev/fixtures.js'
import { createCompanionService, createCompanionHandler } from '../../server/companion.js'
import { memoryStore, request } from '../fixtures/companion.js'

const odds = { 1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100 }
async function openGroups(page,state='groups-flow') {
  await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
  await page.addInitScript(({ race,state,events,odds }) => {
    const key = `race-ability-odds:v1:synthetic-demo-${state}:${race.raceDate}:${race.id}`
    if (!localStorage.getItem(key)) localStorage.setItem(key,JSON.stringify(events.map(s => ({ ...s,odds }))))
  },{ race,state,events:demoSnapshots(),odds })
  await page.goto(`/market-preview.html?state=${state}`)
}
async function stored(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k => k.startsWith('race-forecast-ledger:')))))
}
async function thirdOnlyC(page) {
  const third = page.getByRole('group',{ name:'3着のグループ' })
  for (const label of ['A','B','D']) await third.getByRole('checkbox',{ name:label,exact:true }).uncheck()
}

test('group formation freezes independently of edits, survives reload, and reconciles a positional miss',async ({ page }) => {
  const errors = []; page.on('pageerror',e => errors.push(e.message))
  await openGroups(page)
  await expect(page.getByRole('heading',{ name:'グループ・買い目比較',exact:true })).toBeVisible()
  await expect(page.getByRole('table',{ name:'グループと能力の比較' }).getByRole('row')).toHaveCount(9)
  await thirdOnlyC(page)
  await page.getByLabel('判断の根拠・不確かな点').fill('Bを勝ち候補。Aの２着と３着を比較。')
  await page.getByRole('button',{ name:'グループと比較案を固定保存',exact:true }).click()
  const frozen = page.getByRole('region',{ name:'保存したグループ判断' })
  await expect(frozen).toContainText('8点・投入予定 800円')
  const first = (await stored(page)).groupPlans[0]
  expect(first.slots).toEqual([['B'],['A'],['C']])
  expect(first.mode).toBe('live')
  expect((await stored(page)).forecasts).toEqual([])
  expect((await stored(page)).purchases).toEqual([])
  await page.getByLabel('2番の前で区切る').check()
  await expect(frozen).toContainText('保存した着順：B → A → C')
  expect((await stored(page)).groupPlans[0]).toEqual(first)
  await page.reload()
  await expect(frozen).toContainText('8点・投入予定 800円')
  const results = [3,5,1,2,4,6,7,8].map((horseNo,i) => ({ horseNo,rank:i+1 }))
  await page.evaluate(async ({ race,horses,results }) => {
    const { applyCloudData } = await import('/src/cloudStore.js')
    await applyCloudData('synthetic-demo-groups-flow',race,horses,{ race:{ ...race,horses },observations:[{ kind:'LIVE_RACE',eventId:'synthetic-result',retrievedAt:'2026-11-15T07:00:00Z',payload:{ raceId:race.id,raceDate:race.raceDate,releaseFieldSize:8,priceStatus:'final-visible',results } }] })
  },{ race,horses,results })
  await page.getByRole('button',{ name:'同期データを再読込（開発確認）' }).click()
  await expect(frozen).toContainText('結果 3→5→1（B→C→A）')
  await expect(frozen).toContainText('候補に上位３頭：含む ／ 着順・券種：不一致')
  expect(errors).toEqual([])
  await page.screenshot({ path:'.qa/groups-desktop.png',fullPage:true })
  await page.setViewportSize({ width:390,height:844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path:'.qa/groups-mobile.png',fullPage:true })
})

test('budget errors are recoverable; explicit purchases and official payouts are distinct from plans',async ({ page }) => {
  await openGroups(page,'groups-purchase')
  await thirdOnlyC(page)
  await page.getByLabel('同じ候補で３連複',{ exact:false }).check()
  await page.getByLabel('１レースの予算上限').fill('500')
  await expect(page.getByRole('button',{ name:'グループと比較案を固定保存' })).toBeDisabled()
  await page.getByLabel('１レースの予算上限').fill('10100')
  await expect(page.getByRole('alert')).toContainText('予算上限')
  await page.getByLabel('１レースの予算上限').fill('10000')
  await page.getByRole('button',{ name:'グループと比較案を固定保存' }).click()
  await expect(page.getByRole('region',{ name:'保存したグループ判断' })).toContainText('8点・投入予定 800円')
  expect((await stored(page)).purchases).toEqual([])
  await page.getByText('この案の実購入・払戻を記録する',{ exact:true }).click()
  await page.getByLabel('実購入した買い目と金額').fill('3連複 1-3-5 100')
  await page.getByRole('button',{ name:'実購入を保存する' }).click()
  await page.getByLabel('3連複 1−3−5の100円あたり払戻').fill('1200')
  await page.getByRole('button',{ name:'正式払戻を保存する' }).click()
  await expect(page.getByText('このレースの実購入の精算済み損益：1,100円。予想だけの試算は含みません。')).toBeVisible()
  const ledger = await stored(page)
  expect(ledger.purchases[0].forecastId).toBe(ledger.groupPlans[0].id)
  expect(ledger.settlements).toHaveLength(1)
})

test('missing, corrupt and unavailable storage never overwrite records; post-cutoff save is research',async ({ page }) => {
  await page.goto('/market-preview.html?state=empty')
  await page.getByRole('button',{ name:'グループ・買い目',exact:true }).click()
  await expect(page.getByText('実オッズの取得待ちです。能力・適性から記録・取込みできます。')).toBeVisible()
  await expect(page.getByRole('button',{ name:'グループと比較案を固定保存' })).toBeDisabled()
  await openGroups(page,'groups-late')
  await page.clock.setFixedTime(new Date('2026-11-15T07:00:00Z'))
  await page.getByRole('button',{ name:'見送りを固定保存',exact:true }).click()
  await expect(page.getByRole('region',{ name:'保存したグループ判断' })).toContainText('見送り・購入案０円')
  expect((await stored(page)).groupPlans[0].mode).toBe('replay')
  expect((await stored(page)).groupPlans[0].allocations).toEqual([])
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find(k => k.startsWith('race-forecast-ledger:'))
    localStorage.setItem(key,'{broken')
  })
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('上書きせず保護')
  await expect(page.getByRole('button',{ name:'グループと比較案を固定保存' })).toBeDisabled()
  await expect(page.getByRole('button',{ name:'保存済み記録を再同期' })).toBeDisabled()
})

test('browser to authenticated API to immutable store: offline retry obtains receipt and survives cloud-only reload',async ({ page }) => {
  const now = '2026-11-15T06:29:00.000Z', state = 'groups-connected', ownerId = `synthetic-demo-${state}`
  let serverNow = now
  const service = createCompanionService({ store:memoryStore(),ownerId,now:() => Date.parse(serverNow),schedule:async () => 'scheduled' })
  const handler = createCompanionHandler({ service,ownerId,authenticateUser:async token => token === 'group-test-token' ? { id:ownerId } : null })
  await service.ingestBundle({ schemaVersion:1,kind:'race-companion-bundle',generatedAt:now,status:{ state:'ready' },
    races:[{ raceId:race.id,raceDate:race.raceDate,race:{ ...race,horses },snapshots:[{ ...demoSnapshots().find(s => s.id === 'demo-1'),odds }],observations:[] }] })
  await page.clock.setFixedTime(new Date(now))
  await page.addInitScript(({ ownerId }) => localStorage.setItem('sb-ojolpyqetwqqnlzhsrgq-auth-token',JSON.stringify({
    access_token:'group-test-token',refresh_token:'synthetic-refresh',expires_at:Date.now()/1000+3600,user:{ id:ownerId,email:'test@example.invalid' },
  })),{ ownerId })
  let failUpload = true
  await page.route('**/api/companion*',async route => {
    const req = route.request()
    if (req.method() === 'POST' && failUpload) return route.fulfill({ status:503,json:{ error:{ message:'synthetic offline' } } })
    const response = await request(handler,{ method:req.method(),token:req.headers().authorization?.slice(7),query:Object.fromEntries(new URL(req.url()).searchParams),body:req.postData() ?? undefined })
    await route.fulfill({ status:response.status,headers:response.headers,json:response.body })
  })
  await page.goto(`/market-preview.html?state=${state}`)
  await expect(page.getByRole('table',{ name:'グループと能力の比較' }).getByRole('row')).toHaveCount(9)
  await thirdOnlyC(page)
  await page.getByRole('button',{ name:'グループと比較案を固定保存' }).click()
  await expect(page.getByRole('alert')).toContainText('ブラウザの記録は保持')
  expect((await stored(page)).groupPlans).toHaveLength(1)
  failUpload = false
  await page.getByRole('button',{ name:'保存済み記録を再同期' }).click()
  const frozen = page.getByRole('region',{ name:'保存したグループ判断' })
  await expect(frozen).toContainText('締切前の受領確認済み')
  const pulled = await service.pullLedger({ raceId:race.id,raceDate:race.raceDate })
  expect(pulled.ledger.forecasts).toEqual([])
  expect(pulled.ledger.groupPlans).toHaveLength(1)
  expect(pulled.receipts).toBeUndefined()
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (!k.startsWith('sb-')) localStorage.removeItem(k)
  })
  await page.reload()
  await expect(frozen).toContainText('締切前の受領確認済み')
  expect((await stored(page)).groupPlans).toHaveLength(1)
  serverNow = '2026-11-15T07:00:00.000Z'
  await page.clock.setFixedTime(new Date(serverNow))
  await service.ingestBundle({ schemaVersion:1,kind:'race-companion-bundle',generatedAt:serverNow,status:{ state:'ready' },
    races:[{ raceId:race.id,raceDate:race.raceDate,race:{ ...race,horses },snapshots:[],observations:[{
      kind:'LIVE_RACE',eventId:'complete-result',retrievedAt:serverNow,payload:{ raceId:race.id,raceDate:race.raceDate,
        releaseFieldSize:8,priceStatus:'final-visible',results:[3,5,1,2,4,6,7,8].map((horseNo,i) => ({ horseNo,rank:i+1 })) },
    }] }] })
  await page.route('https://*.supabase.co/storage/**',route => route.fulfill({ status:503,json:{ message:'synthetic database unavailable' } }))
  await page.goto('/')
  await page.getByRole('navigation',{ name:'開催メニュー',exact:true }).getByRole('button',{ name:'振り返り',exact:true }).click()
  const groupReview = page.getByRole('region',{ name:'グループ判断の振り返り' })
  await expect(groupReview).toContainText('結果 3→5→1（B→C→A）')
  await expect(groupReview).toContainText('0/1（0.0%）')
  await expect(groupReview).toContainText('購入・精算待ち')
  await groupReview.getByRole('button',{ name:'グループ判断と購入記録を開く' }).click()
  await expect(page.getByRole('heading',{ name:'グループ・買い目比較',exact:true })).toBeVisible()
  await expect(page.getByRole('region',{ name:'保存したグループ判断' })).toContainText('結果 3→5→1（B→C→A）')
})
