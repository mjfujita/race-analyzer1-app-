import { test, expect } from '@playwright/test'

const before = { races: 20, logLoss: .91, brier: .42 }
const after = { races: 20, logLoss: .85, brier: .38,
  bins: [{ lower: .3, count: 20, predicted: .32, actual: .35 }] }
const version = { id: 'win-temp-000000000000000000000001', decision: 'adopted', temperature: 1.25,
  trainedThrough: '20261003', testedThrough: '20261018',
  evaluation: { before, after, incumbent: before }, walkForward: { before, after } }
const review = { generatedAt: '2026-11-16T06:00:00Z', totalForecasts: 65, eligibleRaces: 60, actual: { topPickRate: .29 },
  sourceCounts: { BAC: 36, KAB: 3, SED: 513 }, versions: [version], active: [],
  statesByStack: [{ stack: 'test', status: 'paused-degradation', monitor: { before: after, after: before } }],
  races: [{ forecastId: 'race1', raceId: '08265411', raceDate: '20261115', state: 'matched',
    source: 'SED', verified: true, topPick: 2, winnerNo: 1, modelVersion: 'synthetic-base', calibrationId: version.id,
    references: { BAC: { declaredCount: 2, postTime: '1540' } },
    field: [{ no: 1, probability: .32, rank: 1 }, { no: 2, probability: .68, rank: 2 }] },
  { forecastId: 'race2', raceId: '08265412', raceDate: '20261115', state: 'awaiting-results',
    verified: false, topPick: 1, winnerNo: null, modelVersion: 'synthetic-base',
    field: [{ no: 1, probability: .51 }, { no: 2, probability: .49 }] }],
}

test('review shows frozen probability, actual ranks, holdout comparison, and the automatic stop', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(value => localStorage.setItem('synthetic-forecast-review', JSON.stringify(value)), review)
  await page.goto('/market-preview.html?state=review')
  await expect(page.getByRole('heading', { name: '予想の振り返り' })).toBeVisible()
  await expect(page.getByText('劣化を検知し停止')).toBeVisible()
  await expect(page.getByRole('table', { name: '採否に使った独立評価 · 20レース' })).toContainText('0.8500')
  await expect(page.getByRole('table', { name: '時系列バックテスト · 20レース' })).toBeVisible()
  await expect(page.getByRole('table', { name: '独立評価の確率帯別の校正' })).toContainText('35.0%')
  await expect(page.getByText('照合済み (SED) · 締切前受領済み · 予想1位 2番 · 着順1位 1番')).toBeVisible()
  await page.getByText('開催・番組・登録の参考データ').click()
  await expect(page.getByText('BAC · 番組 2頭・発走 1540')).toBeVisible()
  await page.getByLabel('対象レース').selectOption('race2')
  await expect(page.getByText(/着順待ち · 締切前受領の証跡なし/)).toBeVisible()
  await page.getByLabel('対象レース').selectOption('race1')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(391)
  await page.screenshot({ path: '.qa/forecast-review-mobile.png', fullPage: true })
  expect(errors).toEqual([])
})

test('review handles loading, disconnected and empty data', async ({ page }) => {
  await page.goto('/market-preview.html?state=review-loading')
  await expect(page.getByText('振り返りを読み込んでいます。')).toBeVisible()
  await page.goto('/market-preview.html?state=review-error')
  await expect(page.getByRole('alert')).toContainText('同期を完了できませんでした。')
  await page.evaluate(value => localStorage.setItem('synthetic-forecast-review', JSON.stringify(value)),
    { ...review, active: [], statesByStack: [], versions: [], races: [], totalForecasts: 0, eligibleRaces: 0, actual: null })
  await page.goto('/market-preview.html?state=review')
  await expect(page.getByText(/判断を固定保存すると/)).toBeVisible()
})
