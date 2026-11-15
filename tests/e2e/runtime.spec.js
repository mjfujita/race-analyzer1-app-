import { test, expect } from '@playwright/test'
import { race, horses, odds } from '../../dev/fixtures.js'

function runtimeFixture() {
  const baseModel = { schemaVersion: 1, id: 'synthetic-runtime-base', modelType: 'idm-temperature', temperature: 8,
    status: 'research', trainedThrough: '2025-01-01', generatedAt: '2025-01-02T00:00:00Z', validation: {} }
  const common = { id: 'synthetic-runtime-part', status: 'ready', baseModelId: baseModel.id,
    trainedThrough: '2025-06-01', generatedAt: '2025-06-02T00:00:00Z', validation: {} }
  const runtimeModel = { schemaVersion: 1, kind: 'race-prediction-models', id: 'synthetic-runtime-ready',
    generatedAt: common.generatedAt, adoptedAt: '2025-06-03T00:00:00Z', baseModel,
    contextModel: { ...common, modelType: 'context-logit-v1', features: ['paddock'], coefficients: { paddock: .25 } },
    marketModel: { ...common, modelType: 't10-market-blend-v1', gamma: 1, abilityWeight: .8 },
    closingOddsModel: { ...common, modelType: 'closing-logratio-v1', coefficients: [Math.log(.9), 0, 0, 0, 0], residualLower: -.1, residualUpper: .1 } }
  const snapshot = { schemaVersion: 2, id: 'synthetic-direct-odds', raceId: race.id, raceDate: race.raceDate, kind: 'observed', time: '15:30',
    sourcePublishedAt: null, observedAt: '2026-11-15T06:30:00Z', retrievedAt: '2026-11-15T06:30:00Z', availabilityAt: '2026-11-15T06:30:00Z',
    timingEvidence: 'observed-visible-at', source: 'synthetic-live-capture', odds: { ...odds, 1: 7 }, revisionOf: null }
  const live = { raceId: race.id, raceDate: race.raceDate, postTime: race.postTime, fieldSize: 8, surface: '芝',
    sourcePublishedAt: null, observedAt: '2026-11-15T06:25:00Z', retrievedAt: '2026-11-15T06:25:00Z', availabilityAt: '2026-11-15T06:25:00Z',
    timingEvidence: 'observed-visible-at', weather: '雨', going: '重', winOdds: snapshot.odds,
    horses: horses.map(h => ({ horseNo: h.no, name: h.name, horseWeight: 450 + h.no * 2, horseWeightDelta: 2, paddockIndex: h.no === 1 ? 3 : 0 })),
    paddock: horses.map(h => ({ horseNo: h.no, paddockIndex: h.no === 1 ? 3 : 0 })) }
  const future = { ...live, observedAt: '2026-11-15T06:45:00Z', retrievedAt: '2026-11-15T06:45:00Z', availabilityAt: '2026-11-15T06:45:00Z',
    weather: '晴', going: '良', paddock: horses.map(h => ({ horseNo: h.no, paddockIndex: h.no === 1 ? -10 : 10 })),
    results: [{ horseNo: 3, rank: 1 }, { horseNo: 1, rank: 2 }, { horseNo: 5, rank: 3 }] }
  return { models: { abilityModel: baseModel, runtimeModel }, race: { ...race, horses }, snapshots: [snapshot],
    observations: [{ eventId: 'synthetic-live-before', kind: 'LIVE_RACE', retrievedAt: live.retrievedAt, payload: live, sourceHash: 'synthetic-before' },
      { eventId: 'synthetic-live-later', kind: 'LIVE_RACE', retrievedAt: future.retrievedAt, payload: future, sourceHash: 'synthetic-after' }] }
}

async function applySyntheticSync(page, payload, state = 'normal') {
  await page.evaluate(async ({ payload, race, horses, state }) => {
    const userId = `synthetic-demo-${state}`
    const { applyCloudData, runtimeModelKey } = await import('/src/cloudStore.js')
    // Reconstruct an already-adopted synthetic model; actual sync preserves its adoption date.
    localStorage.setItem(runtimeModelKey(userId), JSON.stringify(payload.models.runtimeModel))
    localStorage.setItem(`race-market-model:v1:${userId}`, JSON.stringify({ ...payload.models.abilityModel, adoptedAt: '2025-06-03T00:00:00Z' }))
    await applyCloudData(userId, race, horses, payload)
  }, { payload, race, horses, state })
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
}

test('legacy odds without dated live context remain readable as research data', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/market-preview.html')
  await page.evaluate(async ({ race, odds }) => {
    const { oddsStorageKey } = await import('/src/oddsHistory.js')
    localStorage.setItem(oddsStorageKey('synthetic-demo-normal', race), JSON.stringify([{ time: '15:30', odds }]))
  }, { race, odds })
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
  await expect(page.getByRole('button', { name: '研究用の試算を固定保存' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('button', { name: '研究用の試算を固定保存' })).toBeVisible()
  expect(errors).toEqual([])
})

test('runtime models and observed-direct data appear after sync, future context stays retrospective', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/market-preview.html')
  const runtime = page.locator('section').filter({ has: page.getByRole('heading', { name: '当日情報を加えた予想と根拠', exact: true }) })
  await expect(runtime.getByText('学習データ待ち', { exact: true })).toHaveCount(3)
  await applySyntheticSync(page, runtimeFixture())
  await expect(runtime.getByText('適用可能', { exact: true })).toHaveCount(3)
  await expect(runtime).toContainText('馬場 重 ／ 天候 雨')
  await expect(runtime.getByText('パドックの相対評価：モデル寄与', { exact: false }).first()).toBeVisible()
  await runtime.getByText('全頭の最終オッズ予測幅', { exact: true }).click()
  const priceRow = runtime.getByRole('row').filter({ hasText: '架空馬A' })
  await expect(priceRow).toContainText('7.0')
  await expect(priceRow).toContainText('6.3')
  await runtime.getByText('取得済みの直前情報・結果を参照', { exact: true }).click()
  await expect(runtime).toContainText('取得着順：1着 3番')
  await expect(runtime).toContainText('天候 晴 ／ 馬場 良')
  await page.getByRole('button', { name: '研究用の試算を固定保存' }).click()
  await expect(page.getByRole('status')).toContainText('固定保存しました')
  const forecast = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.startsWith('race-forecast-ledger:'))
    return JSON.parse(localStorage.getItem(key)).forecasts.at(-1)
  })
  expect(forecast.inputs.sourcePublishedAt).toBeNull()
  expect(forecast.inputs.timingEvidence).toBe('observed-visible-at')
  expect(forecast.inputs.runtimeModels.id).toBe('synthetic-runtime-ready')
  expect(forecast.mode).toBe('replay')
  expect(errors).toEqual([])
  await page.screenshot({ path: '.qa/runtime-final-desktop.png', fullPage: true })
})

test('empty market can receive data without remounting, and malformed runtime is visible without contaminating probabilities', async ({ page }) => {
  await page.goto('/market-preview.html?state=empty')
  await expect(page.getByText('締切以前の記録なし', { exact: true })).toHaveCount(1)
  await applySyntheticSync(page, runtimeFixture(), 'empty')
  await expect(page.getByText('締切以前の記録なし', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '研究用の試算を固定保存' })).toBeVisible()
  const malformed = runtimeFixture().models.runtimeModel
  malformed.contextModel.coefficients.paddock = null
  await page.evaluate(model => localStorage.setItem('race-runtime-model:v1:synthetic-demo-empty', JSON.stringify(model)), malformed)
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
  await expect(page.getByText('条件モデルの係数が不正です。', { exact: true })).toBeVisible()
  await expect(page.getByText('学習データ待ち', { exact: true })).toHaveCount(3)
})

test('market and pace pages show synchronized runtime context on desktop and mobile', async ({ page }) => {
  await page.goto('/market-preview.html')
  await applySyntheticSync(page, runtimeFixture())
  await page.getByRole('button', { name: '市場評価差', exact: true }).click()
  await expect(page.getByRole('button', { name: '統合勝率', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '最終価格予測', exact: true })).toBeVisible()
  await expect(page.getByRole('row').filter({ hasText: '架空馬A' }).first()).toContainText('6.30')
  await page.screenshot({ path: '.qa/runtime-market-desktop.png', fullPage: true })
  await page.getByRole('button', { name: '展開・天候', exact: true }).click()
  await expect(page.getByText('天候 雨 ・ 馬場 重', { exact: false })).toBeVisible()
  await expect(page.getByText('取得 11/15 15:25', { exact: false }).first()).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  const width = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, viewport: innerWidth }))
  expect(width.scroll).toBeLessThanOrEqual(width.viewport + 1)
  await page.screenshot({ path: '.qa/runtime-pace-mobile.png', fullPage: true })
})

test('cloud sync success and 409 conflict both preserve the local immutable purchase history', async ({ page }) => {
  let conflict = false
  const sent = []
  let finishInitialSync
  const pendingInitialSync = new Promise(resolve => { finishInitialSync = resolve })
  await page.route('**/api/companion', async route => {
    expect(route.request().headers().authorization).toBe('Bearer synthetic-test-token')
    const body = route.request().postDataJSON()
    sent.push(body.ledger)
    if (sent.length === 1) await pendingInitialSync
    await route.fulfill({ status: conflict ? 409 : 200, contentType: 'application/json',
      body: JSON.stringify(conflict ? { error: { message: 'synthetic correction conflict' } } : { ledger: body.ledger }) })
  })
  await page.goto('/market-preview.html?state=cloud-test')
  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabase.js')
    // This local dev-only fixture never obtains or submits a real account token.
    supabase.auth.getSession = async () => ({ data: { session: { access_token: 'synthetic-test-token' } }, error: null })
  })
  await page.getByRole('button', { name: '研究用の試算を固定保存' }).click()
  await expect(page.getByRole('button', { name: '研究用の試算を固定保存' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '実購入を保存する', exact: true })).toBeDisabled()
  finishInitialSync()
  await expect(page.getByRole('status')).toContainText('クラウドにも保存しました')
  conflict = true
  await page.getByLabel('実購入した買い目と金額').fill('単勝 1 500')
  await page.getByRole('button', { name: '実購入を保存する', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('別端末の記録と競合')
  await expect(page.getByRole('status')).toContainText('ローカル記録を保持しました')
  await expect(page.getByText('実購入の総額', { exact: true }).locator('..')).toContainText('500円')
  await page.reload()
  await expect(page.getByText('実購入の総額', { exact: true }).locator('..')).toContainText('500円')
  expect(sent).toHaveLength(2)
  expect(sent[0].forecasts).toHaveLength(1)
  expect(sent[1].purchases).toHaveLength(1)
})

test('network failure keeps saved forecasts and purchases available after reload', async ({ page }) => {
  let attempts = 0
  await page.route('**/api/companion', async route => {
    attempts += 1
    await route.abort('connectionfailed')
  })
  await page.goto('/market-preview.html?state=cloud-test')
  await page.evaluate(async () => {
    const { supabase } = await import('/src/supabase.js')
    supabase.auth.getSession = async () => ({ data: { session: { access_token: 'synthetic-test-token' } }, error: null })
  })
  await page.getByRole('button', { name: '研究用の試算を固定保存' }).click()
  await expect(page.getByRole('status')).toContainText('クラウドへの同期は再試行待ち')
  await page.getByLabel('実購入した買い目と金額').fill('馬連 1-2 300')
  await page.getByRole('button', { name: '実購入を保存する', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('クラウドへの同期は再試行待ち')
  await expect(page.getByText('実購入の総額', { exact: true }).locator('..')).toContainText('300円')
  await page.reload()
  await expect(page.getByText('実購入の総額', { exact: true }).locator('..')).toContainText('300円')
  expect(attempts).toBe(2)
})
