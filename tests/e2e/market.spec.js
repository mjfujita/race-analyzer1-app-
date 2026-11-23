import { test, expect } from '@playwright/test'

test('research forecast → actual purchase → settlement → correction survives reload', async ({ page }) => {
  const errors=[]
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/market-preview.html')
  await expect(page.getByRole('heading',{name:'市場評価と買い方'})).toBeVisible()
  await page.getByLabel('各券種の実オッズ',{exact:true}).fill('複勝 1 2.8-3.4\n馬連 1-2 15.0\nワイド 1-2 5.8\n3連単 1-2-3 90')
  await page.getByRole('button',{name:'研究用の試算を固定保存'}).click()
  await expect(page.getByRole('status')).toContainText('固定保存しました')
  await page.getByLabel('実購入した買い目と金額').fill('単勝 1 1000\n馬連 1-2 500')
  await page.getByRole('button',{name:'実購入を保存する',exact:true}).click()
  await page.getByLabel('単勝 1の100円あたり払戻',{exact:true}).fill('500')
  await page.getByLabel('馬連 1−2の100円あたり払戻',{exact:true}).fill('0')
  await page.getByRole('button',{name:'正式払戻を保存する',exact:true}).click()
  await expect(page.getByText('精算済み損益',{exact:true}).locator('..')).toContainText('3,500円')
  await page.reload()
  await expect(page.getByText('精算済み損益',{exact:true}).locator('..')).toContainText('3,500円')
  await page.getByLabel('単勝 1の100円あたり払戻',{exact:true}).fill('300')
  await page.getByRole('button',{name:'払戻訂正を追記する',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('訂正')
  await page.getByLabel('訂正理由（必須）',{exact:true}).last().fill('架空の訂正テスト')
  await page.getByRole('button',{name:'払戻訂正を追記する',exact:true}).click()
  await expect(page.getByText('精算済み損益',{exact:true}).locator('..')).toContainText('1,500円')
  const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:'JSONを書き出す',exact:true}).click()])
  expect(download.suggestedFilename()).toContain('race-record')
  expect(errors).toEqual([])
})

test('market decomposition and sorting work and price changes never alter ability', async ({ page }) => {
  await page.goto('/market-preview.html')
  await page.getByRole('button',{name:'市場評価差',exact:true}).click()
  await expect(page.getByRole('heading',{name:'実力と市場の評価差'})).toBeVisible()
  const first = page.getByRole('row').filter({hasText:'架空馬A'})
  const ability = await first.locator('td').first().textContent()
  await page.getByLabel('価格の感度').selectOption('70')
  await expect(first.locator('td').first()).toHaveText(ability)
  await page.getByRole('button',{name:'実オッズ',exact:true}).click()
  await page.getByText('評価差の内訳',{exact:true}).click()
  await expect(page.getByText('log(pF/q) = log(pF/q基準) + log(q基準/q)。',{exact:false})).toBeVisible()
})

test('invalid budget, incomplete data, corrupt storage, and unauthenticated state are visible', async ({ page }) => {
  await page.goto('/market-preview.html')
  await page.getByLabel('予算上限（円）',{exact:true}).fill('-1')
  await expect(page.getByRole('alert')).toContainText('予算')
  await expect(page.getByRole('button',{name:'研究用の試算を固定保存'})).toHaveCount(0)
  await page.goto('/market-preview.html?state=empty')
  await expect(page.getByText('締切以前の記録なし',{exact:true})).toHaveCount(1)
  await page.goto('/market-preview.html?state=error')
  await expect(page.getByRole('alert')).toBeVisible()
  await page.route('**/api/device',route=>route.fulfill({json:{session:null}}))
  await page.goto('/')
  await expect(page.getByRole('heading',{name:'この端末は未承認です'})).toBeVisible()
  await page.getByRole('button',{name:'本人確認による復旧'}).click()
  await expect(page.getByText('メールアドレス',{exact:true})).toBeVisible()
})

test('mobile layout keeps controls accessible without page overflow', async ({ page }) => {
  await page.setViewportSize({width:390,height:844})
  await page.goto('/market-preview.html')
  await expect(page.getByRole('heading',{name:'市場評価と買い方'})).toBeVisible()
  const width=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,viewport:innerWidth}))
  expect(width.scroll).toBeLessThanOrEqual(width.viewport+1)
})

test('HJC import fills official payout only after refund confirmation, then settles explicitly', async ({ page }) => {
  await page.goto('/market-preview.html')
  await page.getByRole('button',{name:'研究用の試算を固定保存'}).click()
  await page.getByLabel('実購入した買い目と金額').fill('単勝 1 1000')
  await page.getByRole('button',{name:'実購入を保存する',exact:true}).click()
  const data={schemaVersion:1,kind:'race-market-observations',observations:[{
    eventId:'synthetic-hjc',kind:'HJC',retrievedAt:'2026-11-15T07:30:00.000Z',sourceHash:'synthetic',
    payload:{raceId:'DEMO260811',raceDate:'20261115',format:'HJC-4a',status:'published',refunds:null,
      payouts:[{key:'単勝:1',type:'単勝',numbers:[1],per100:500}]},
  }]}
  await page.getByLabel('観測データJSONを取り込む').setInputFiles({name:'synthetic-observations.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(data))})
  await expect(page.getByRole('button',{name:'HJCから払戻を照合して入力'})).toBeDisabled()
  await page.getByLabel('主催者情報で、この購入馬券に取消・返還がないことを確認しました').check()
  await page.getByRole('button',{name:'HJCから払戻を照合して入力'}).click()
  await expect(page.getByLabel('単勝 1の100円あたり払戻')).toHaveValue('500')
  await expect(page.getByText('精算済みの払戻',{exact:true}).locator('..')).toContainText('0円')
  await page.getByRole('button',{name:'正式払戻を保存する',exact:true}).click()
  await expect(page.getByText('精算済みの払戻',{exact:true}).locator('..')).toContainText('5,000円')
})

test('learned conditions model imports with declared feature contract and reaches final explanation', async ({ page }) => {
  await page.goto('/market-preview.html')
  await page.getByRole('button',{name:'市場評価差',exact:true}).click()
  await page.getByText('学習モデルと検証結果',{exact:true}).click()
  const model={schemaVersion:1,modelType:'idm-conditions-v1',featureSchema:'race-ability-last5-v1',id:'synthetic-conditions',
    temperature:10,coefficients:{distance:1,venue:0.5,course:-0.2},featureSpec:{version:1,priorRate:0.25,priorStrength:3,
      window:5,distanceTolerance:200,fields:{distance:['distance_top3','distance_runs'],venue:['venue_top3','venue_runs'],course:['course_top3','course_runs']}},
    trainedThrough:'2025-01-01',status:'research',generatedAt:'2026-11-15T10:00:00.000Z',validation:{},selection:{selected:'challenger'}}
  await page.getByLabel('モデルJSONを読込').setInputFiles({name:'synthetic-model.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(model))})
  await expect(page.getByText(/適用中 synthetic-conditions/)).toBeVisible()
  await page.getByRole('button',{name:'最終予想・記録',exact:true}).click()
  await page.getByText('能力上位候補の根拠を確認',{exact:true}).click()
  await expect(page.getByText(/同じ競馬場・距離/).first()).toBeVisible()
  await expect(page.getByText(/作成・採用時刻が締切前と確認できない/)).toBeVisible()
})

test('two tabs saving from stale views retain both actual purchases', async ({ page, context }) => {
  await page.goto('/market-preview.html')
  await page.getByRole('button',{name:'研究用の試算を固定保存'}).click()
  await expect(page.getByRole('status')).toContainText('固定保存しました')
  const second = await context.newPage()
  await second.goto('/market-preview.html')
  await page.getByLabel('実購入した買い目と金額').fill('単勝 1 1000')
  await second.getByLabel('実購入した買い目と金額').fill('単勝 2 500')
  await Promise.all([
    page.getByRole('button',{name:'実購入を保存する',exact:true}).click(),
    second.getByRole('button',{name:'実購入を保存する',exact:true}).click(),
  ])
  await expect(page.getByRole('status')).toContainText('実購入の記録を保存しました')
  await expect(second.getByRole('status')).toContainText('実購入の記録を保存しました')
  await page.reload()
  await expect(page.getByText('実購入の総額',{exact:true}).locator('..')).toContainText('1,500円')
  const saved=await page.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('race-forecast-ledger:')).map(key=>JSON.parse(localStorage.getItem(key))))
  expect(saved).toHaveLength(1)
  expect(saved[0].purchases).toHaveLength(2)
  await second.close()
})
