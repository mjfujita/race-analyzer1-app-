import { expect, test } from '@playwright/test'
import { race, horses, demoSnapshots } from '../../dev/fixtures.js'
import { createCompanionHandler, createCompanionService } from '../../server/companion.js'
import { memoryStore, request } from '../fixtures/companion.js'

const now = '2026-11-15T06:25:00.000Z'
const ownerId = 'synthetic-dashboard-owner'
const token = 'synthetic-dashboard-access'

async function connect(page, handler, stamp = now) {
  await page.clock.setFixedTime(new Date(stamp))
  await page.addInitScript(({ ownerId, token }) => {
    localStorage.setItem('sb-ojolpyqetwqqnlzhsrgq-auth-token', JSON.stringify({
      access_token: token, refresh_token: 'fixture-refresh-token',
      expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: ownerId, email: 'dashboard@example.invalid' },
    }))
  }, { ownerId, token })
  // The dashboard uses the private companion API independently of the PACI database.
  await page.route('https://*.supabase.co/storage/**', route => route.fulfill({ status: 503, json: { message: 'fixture database unavailable' } }))
  await page.route('**/api/device',route => route.fulfill({ json:{session:route.request().headers().authorization===`Bearer ${token}` ? {user:{id:ownerId},device:null} : null} }))
  await page.route('**/api/companion*', async route => {
    const incoming = route.request()
    const response = await request(handler, {
      method: incoming.method(), token: incoming.headers().authorization?.slice(7) ?? null,
      query: Object.fromEntries(new URL(incoming.url()).searchParams), body: incoming.postData() ?? undefined,
    })
    await route.fulfill({ status: response.status, headers: response.headers, json: response.body })
  })
}

function setup(stamp = now, schedule) {
  const service = createCompanionService({ store: memoryStore(), ownerId, now: () => Date.parse(stamp), schedule })
  const handler = createCompanionHandler({ service, ownerId, authenticateUser: async incoming => incoming === token ? { id: ownerId } : null })
  return { service, handler }
}

test('the signed-in home shows race progress, opens the correct forecast, and links to its review', async ({ page }) => {
  const { service, handler } = setup()
  const nextRace = { ...race, name: '予想を開く対象', horses }
  const missing = { ...race, id: 'DEMO260511', placeCode: '05', name: 'データ不足のレース', postTime: '1536', horses }
  const completed = { ...race, id: 'DEMO260809', name: '照合済みのレース', raceNo: 9, postTime: '1420', horses }
  const currentOdds = demoSnapshots().find(item => item.time === '15:20')
  const partialOdds = { ...currentOdds, id: 'partial', raceId: missing.id, odds: { 1: 3, 2: 4 } }
  const reviewRow = item => ({ forecastId: `review-${item.id}`, raceDate: item.raceDate, raceId: item.id,
    state: 'matched', verified: true, modelVersion: 'synthetic', topPick: 2, winnerNo: 2,
    field: [{ no: 1, probability: 0.4, rank: 2 }, { no: 2, probability: 0.6, rank: 1 }] })
  await service.ingestBundle({
    schemaVersion: 1, kind: 'race-companion-bundle', generatedAt: now,
    status: { state: 'ready', lastRunAt: now, lastFullSyncAt: '2026-11-15T06:24:00.000Z' },
    races: [[nextRace, [currentOdds]], [missing, [partialOdds]], [completed, []]].map(([item, snapshots]) => ({
      raceId: item.id, raceDate: item.raceDate, race: item, snapshots, observations: [],
    })),
    forecastReview: { schemaVersion: 1, ownerId, generatedAt: now, totalForecasts: 2, eligibleRaces: 2,
      statesByStack: [], active: [], versions: [], races: [reviewRow({ ...completed, id: 'other-race' }), reviewRow(completed)] },
  })
  await connect(page, handler)
  const problems = []
  page.on('pageerror', error => problems.push(error.message))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '本日のレース', exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: '最初にやること' })).toBeVisible()
  await expect(page.getByText('最終受信 11/15 15:24')).toBeVisible()
  await expect(page.getByRole('heading', { name: '京都11R 予想を開く対象' })).toBeVisible()
  await expect(page.getByText('判断締切 15:30')).toBeVisible()
  await expect(page.getByText('単勝オッズ取得待ち')).toBeVisible()
  await expect(page.getByText('着順照合済み')).toBeVisible()
  await expect(page.getByText('人気落ち実力馬あり')).toHaveCount(0)
  await page.screenshot({ path: '.qa/race-day-dashboard-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: '.qa/race-day-dashboard-mobile.png', fullPage: true })

  await page.getByRole('button', { name: '軸候補を確認', exact: true }).click()
  await expect(page.getByRole('button', { name: '軸候補', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByLabel('予算上限（円）')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '妙味のある候補から軸を1頭選ぶ' })).toBeVisible()
  await page.getByRole('radio', { name: /番 架空馬.* を軸にする/ }).first().check()
  await expect(page.getByRole('button', { name: /妙味軸候補/ })).toHaveCount(0)
  await page.setViewportSize({ width: 1280, height: 960 })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: '.qa/single-anchor-desktop.png', fullPage: true })
  await expect(page.getByLabel('オッズの観測時刻').locator('option')).toContainText(['最新を自動表示', '15:20'])
  await page.getByRole('button', { name: '軸馬1頭と判断を固定保存' }).click()
  await expect(page.getByText(/クラウドにも保存しました。.*締切前の受領を確認しました。/)).toBeVisible()
  const dashboardButton = page.getByRole('navigation', { name: '開催メニュー', exact: true }).getByRole('button', { name: '本日のレース', exact: true })
  await dashboardButton.click()
  const saved = page.getByRole('button', { name: '京都11Rの保存した予想を見る' })
  await expect(saved).toBeVisible()
  await expect(page.getByText('予想を締切前に受領済み')).toBeVisible()
  await saved.click()
  await page.getByText('保存済み予想・バックアップ',{ exact:true }).click()
  await expect(page.getByText('締切前受領 11/15 15:25', { exact: true })).toBeVisible()

  await dashboardButton.click()
  await page.getByRole('button', { name: '京都9Rの振り返る' }).click()
  await expect(page.getByLabel('対象レース')).toHaveValue(`review-${completed.id}`)
  await dashboardButton.click()
  await page.getByRole('button', { name: '過去開催・PACIレース一覧', exact: true }).last().click()
  await expect(page.getByRole('button', { name: /データ不足のレース/ })).toBeVisible()
  await dashboardButton.click()
  await page.getByRole('button', { name: '同期状況を確認' }).click()
  await expect(page.getByRole('heading', { name: '収集と同期の状態' })).toBeVisible()
  expect(problems).toEqual([])
})

test('the home distinguishes no meeting, an unconfirmed schedule, and API errors', async ({ page }) => {
  let state = 'no-races'
  const stamp = '2026-11-17T00:00:00.000Z'
  const { handler } = setup(stamp, async () => state)
  await connect(page, handler, stamp)
  await page.goto('/')
  await expect(page.getByRole('heading', { name: '本日の開催なし' })).toBeVisible()
  await page.getByRole('button', { name: '予想の振り返りを開く' }).click()
  await expect(page.getByRole('heading', { name: '予想の振り返り', exact: true })).toBeVisible()
  state = 'unconfirmed'
  await page.getByRole('navigation', { name: '開催メニュー', exact: true }).getByRole('button', { name: '本日のレース', exact: true }).click()
  await expect(page.getByRole('heading', { name: '開催情報を確認中' })).toBeVisible()
  state = 'scheduled'
  await page.reload()
  await expect(page.getByRole('heading', { name: '開催情報の取得待ち' })).toBeVisible()
  await page.route('**/api/companion?dashboard=1', route => route.fulfill({
    status: 403, json: { error: { message: 'このデータへのアクセス権がありません。' } },
  }))
  await page.reload()
  await expect(page.getByRole('alert')).toContainText('このデータへのアクセス権がありません。')
  await expect(page.getByRole('heading', { name: '本日の開催なし' })).toHaveCount(0)
})

test('unapproved visitors see device approval before the dashboard', async ({ page }) => {
  await page.route('**/api/device',route=>route.fulfill({json:{session:null}}))
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'この端末は未承認です', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'ログイン', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '本日のレース', exact: true })).toHaveCount(0)
})

test('the four-menu workspace preserves settings, evidence pages and purchase records on desktop and mobile', async ({ page }) => {
  const { service, handler } = setup()
  await service.ingestBundle({ schemaVersion:1,kind:'race-companion-bundle',generatedAt:now,
    status:{ state:'ready',lastRunAt:now,lastFullSyncAt:now },
    races:[{ raceId:race.id,raceDate:race.raceDate,race:{ ...race,horses:horses.map((h,i) => ({ ...h,running_style:String(i%4+1) })) },
      snapshots:demoSnapshots().filter(row => row.time <= '15:20'),observations:[] }] })
  await connect(page,handler)
  const errors = []; page.on('pageerror',e => errors.push(e.message))
  await page.setViewportSize({ width:1440,height:1000 })
  await page.goto('/')
  const main = page.getByRole('navigation',{ name:'開催メニュー',exact:true })
  await expect(main.getByRole('button')).toHaveText(['本日のレース','予想・軸選択','振り返り','データ管理'])
  await expect(page.getByRole('table',{ name:'本日の開催レース' })).toBeVisible()
  await page.screenshot({ path:'.qa/workspace-01-home.png',fullPage:true })
  await main.getByRole('button',{ name:'データ管理' }).click()
  await expect(page.getByRole('heading',{ name:'収集と同期の状態' })).toBeVisible()
  await page.screenshot({ path:'.qa/workspace-07-capture.png',fullPage:true })
  await page.getByRole('button',{ name:'学習・検証',exact:true }).click()
  await expect(page.getByRole('heading',{ name:'学習から採用まで' })).toBeVisible()
  await expect(page.getByRole('heading',{ name:'収集と同期の状態' })).toHaveCount(0)
  await page.screenshot({ path:'.qa/workspace-08-learning.png',fullPage:true })
  await page.getByRole('button',{ name:'表示・運用設定',exact:true }).click()
  await page.getByLabel('推定3着内率の下限（%）').fill('60')
  await page.getByLabel('オッズ下落の想定（%）').fill('15')
  await page.getByRole('button',{ name:'変更を保存',exact:true }).click()
  await expect(page.getByRole('status')).toContainText('このブラウザの表示条件を保存しました')
  await page.screenshot({ path:'.qa/workspace-11-settings.png',fullPage:true })
  await main.getByRole('button',{ name:'本日のレース',exact:true }).click()
  await page.getByRole('button',{ name:'軸候補を確認',exact:true }).click()
  const sub = page.getByRole('navigation',{ name:'選択中のレースの分析' })
  await expect(sub.getByRole('button')).toHaveText(['グループ・買い目','軸候補','能力・適性','オッズ推移','展開・馬場'])
  await expect(page.getByLabel('予算上限（円）')).toHaveCount(0)
  await page.getByText('判断条件を確認・変更',{ exact:true }).click()
  await expect(page.getByLabel('3着内率の下限（%）',{ exact:true })).toHaveValue('60')
  await expect(page.getByLabel('オッズ下落の想定（%）')).toHaveValue('15')
  await page.getByRole('radio',{ name:/番 架空馬.* を軸にする/ }).first().check()
  await page.getByText('判断条件を確認・変更',{ exact:true }).click()
  await page.screenshot({ path:'.qa/workspace-02-axis.png',fullPage:true })
  await page.getByRole('button',{ name:'軸馬1頭と判断を固定保存',exact:true }).click()
  await expect(page.getByRole('status').first()).toContainText('クラウドにも保存しました')
  for (const [name,file] of [['能力・適性','03-ability'],['オッズ推移','04-odds'],['展開・馬場','05-pace']]) {
    await sub.getByRole('button',{ name,exact:true }).click()
    if (name === 'オッズ推移') {
      const prices = page.getByRole('table',{ name:'人気とオッズの変化' })
      const before = await prices.locator('tbody tr').first().locator('td').last().textContent()
      await page.evaluate(async owner => {
        const { saveModel } = await import('/src/modelStore.js')
        saveModel(owner,{ schemaVersion:1,modelType:'idm-temperature',id:'future-generated-fixture',temperature:.1,
          trainedThrough:'2025-01-01',status:'research',generatedAt:'2026-11-15T06:29:00Z',validation:{} })
      },ownerId)
      await sub.getByRole('button',{ name:'能力・適性',exact:true }).click()
      await sub.getByRole('button',{ name:'オッズ推移',exact:true }).click()
      await expect(prices.locator('tbody tr').first().locator('td').last()).toHaveText(before)
    }
    if (name === '展開・馬場') {
      await expect(page.getByText('100.0% → 100.0% → 100.0%',{ exact:true })).toHaveCount(0)
      await expect(page.getByRole('heading',{ name:'脚質の配置を見る' })).toBeVisible()
      await expect(page.getByText(/取得済み 8 \/ 8頭/)).toBeVisible()
    }
    await page.screenshot({ path:`.qa/workspace-${file}.png`,fullPage:true })
    await expect(page.getByText('人気落ち実力馬あり',{ exact:true })).toHaveCount(0)
    await page.setViewportSize({ width:390,height:844 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
    await page.setViewportSize({ width:1440,height:1000 })
  }
  await main.getByRole('button',{ name:'振り返り',exact:true }).click()
  const records = page.getByRole('table',{ name:'保存した軸と結果' })
  await expect(records).toContainText('締切前受領済み')
  await expect(records).toContainText('購入未記録')
  await page.screenshot({ path:'.qa/workspace-06-review.png',fullPage:true })
  await records.getByRole('button',{ name:'記録・購入・精算 →' }).click()
  await expect(page.getByLabel('実購入した買い目と金額')).toBeVisible()
  await expect(page.getByLabel('予算上限（円）')).toHaveCount(0)
  await page.getByLabel('実購入した買い目と金額').fill('単勝 1 100')
  await page.getByRole('button',{ name:'実購入を保存する',exact:true }).click()
  await expect(page.getByRole('status')).toContainText('実購入の記録を保存しました')
  await page.setViewportSize({ width:390,height:844 })
  const mobile = page.getByRole('navigation',{ name:'モバイル開催メニュー' })
  await mobile.getByRole('button',{ name:'予想・軸選択',exact:true }).click()
  const comparison = page.getByRole('table',{ name:'軸候補の比較',exact:true })
  await expect(comparison.locator('[data-label="単勝期待回収率"]').first()).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path:'.qa/workspace-09-mobile.png',fullPage:true })
  await page.reload()
  await mobile.getByRole('button',{ name:'データ管理',exact:true }).click()
  await page.getByRole('button',{ name:'表示・運用設定',exact:true }).click()
  await expect(page.getByLabel('推定3着内率の下限（%）')).toHaveValue('60')
  await expect(page.getByLabel('オッズ下落の想定（%）')).toHaveValue('15')
  expect(errors).toEqual([])
})
