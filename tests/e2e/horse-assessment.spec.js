import {test,expect} from '@playwright/test'
import {race,assessmentHorses} from '../../dev/fixtures.js'

async function open(page){
  await page.clock.setFixedTime(new Date('2026-11-15T07:00:00Z'))
  await page.goto('/market-preview.html?state=assessment')
  await page.getByRole('button',{name:'能力・適性',exact:true}).click()
  await expect(page.getByRole('heading',{name:'各馬の能力・今回の評価'})).toBeVisible()
}
async function sync(page){
  const source=time=>({raceId:race.id,raceDate:race.raceDate,retrievedAt:time,observedAt:time,availabilityAt:time,
    sourcePublishedAt:null,timingEvidence:'observed-visible-at',source:'https://jrdb.com/member/n_live_20261115_DEMO260811.html',weather:'雨',going:'重',
    horses:assessmentHorses.map(h=>({horseNo:h.no,horseWeight:480,horseWeightDelta:0,paddockIndex:0})),
    paddockComments:[{horseNo:1,text:'歩様のリズムは一定（架空の取得コメント）'},{horseNo:2,text:'別の馬の取得コメント'}]})
  const early=source('2026-11-15T06:25:00Z'),late=source('2026-11-15T06:45:00Z')
  late.horses=late.horses.map(h=>({...h,horseWeight:492,horseWeightDelta:12,paddockIndex:9}))
  await page.evaluate(async({race,horses,early,late})=>{
    const {applyCloudData}=await import('/src/cloudStore.js')
    await applyCloudData('synthetic-demo-assessment',race,horses,{race:{...race,horses},snapshots:[],context:late,
      observations:[early,late].map((payload,i)=>({kind:'LIVE_RACE',eventId:`synthetic-assessment-${i}`,retrievedAt:payload.retrievedAt,payload}))})
  },{race,horses:assessmentHorses,early,late})
  await page.getByRole('button',{name:'同期データを再読込（開発確認）'}).click()
}

test('each horse has evidence-based assessment, dated history, missing states, and a usable mobile layout',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message))
  await open(page)
  const cards=page.getByRole('region',{name:'各馬の評価',exact:true})
  await expect(cards.getByRole('article')).toHaveCount(8)
  await page.getByLabel('表示する馬').selectOption('1')
  const first=cards.getByRole('article').first()
  await expect(first).toContainText('取得6/7頭')
  await expect(first).toContainText('近走3走：1勝・2着0回・3着1回')
  await expect(first.getByText('未発表・未取得',{exact:true})).toHaveCount(2)
  await first.getByText('過去走の内訳（3走）',{exact:true}).click()
  await expect(first.getByRole('table')).toContainText('2026/11/01')
  await expect(first.getByRole('table')).not.toContainText('2026/11/15')
  await expect(first.getByRole('table')).not.toContainText('2026/11/16')
  await page.setViewportSize({width:390,height:844})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await first.scrollIntoViewIfNeeded()
  await page.screenshot({path:'.qa/assessment-mobile-fixture.png',fullPage:false})
  await page.getByLabel('表示する馬').selectOption('7')
  await expect(cards.getByRole('article')).toContainText('条件適性は判定保留')
  await page.getByLabel('表示する馬').selectOption('8')
  await expect(cards.getByRole('article')).toContainText('出走取消')
  expect(errors).toEqual([])
})

test('verified paddock sync distinguishes zero from missing and later references cannot change the assessment',async({page})=>{
  await open(page)
  await page.getByLabel('表示する馬').selectOption('1')
  const first=page.getByRole('region',{name:'各馬の評価',exact:true}).getByRole('article').first()
  const assessment=await first.getByRole('heading',{name:'今回の評価',exact:true}).locator('..').textContent()
  await sync(page)
  await expect(first).toContainText('480kg（±0kg）')
  await expect(first.locator('dl').last().getByText('0',{exact:true})).toBeVisible()
  await expect(first).toContainText('歩様のリズムは一定')
  await expect(first).not.toContainText('別の馬の取得コメント')
  await expect(first).not.toContainText('492kg')
  await expect(first.getByRole('heading',{name:'今回の評価',exact:true}).locator('..')).toHaveText(assessment)
  await page.getByLabel('発走10分前までに取得した直前情報のみ').uncheck()
  await expect(first).toContainText('492kg（+12kg）')
  await expect(page.getByText('締切後の参考情報を表示中です。事前評価・勝率の補正には使用しません。')).toBeVisible()
  await expect(first.getByRole('heading',{name:'今回の評価',exact:true}).locator('..')).toHaveText(assessment)
  await page.getByLabel('発走10分前までに取得した直前情報のみ').check()
  await page.getByLabel('表示時刻',{exact:true}).selectOption('demo-0')
  await expect(first.getByText('未発表・未取得',{exact:true})).toHaveCount(2)
  await expect(page.getByText(/選択オッズの取得時点.*までの情報に限定しています/)).toBeVisible()
  await page.getByLabel('表示する馬').selectOption('all')
  await page.setViewportSize({width:1440,height:1000})
  await page.evaluate(()=>window.scrollTo(0,0))
  await page.screenshot({path:'.qa/assessment-desktop-fixture.png',fullPage:false})
})
