import { expect, test } from '@playwright/test'
import { race, horses, demoSnapshots } from '../../dev/fixtures.js'

const savedLedger = page => page.evaluate(() => {
  const key = Object.keys(localStorage).find(name => name.startsWith('race-forecast-ledger:v1:'))
  return JSON.parse(localStorage.getItem(key))
})

test('one selected axis keeps frozen probabilities, prices and trends after saving and reload', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
  await page.goto('/market-preview.html?state=anchors')
  await expect(page.getByRole('heading', { name: '妙味のある候補から軸を1頭選ぶ' })).toBeVisible()
  await expect(page.getByLabel('予算上限（円）')).toHaveCount(0)
  const comparison = page.getByRole('table', { name: '軸候補の比較', exact: true })
  await expect(comparison.getByRole('columnheader')).toHaveText(['馬番・馬名', '推定勝率', '推定3着内率', '単勝オッズ', '単勝期待回収率'])
  await expect(comparison.getByRole('row')).toHaveCount(4)
  await expect(comparison.getByRole('row').nth(1)).toContainText('1 架空馬A')
  await expect(comparison.getByRole('row').nth(2)).toContainText('比較馬')
  await page.getByRole('region', { name: '妙味のある候補から軸を1頭選ぶ', exact: true }).screenshot({ path: '.qa/anchor-comparison-desktop.png' })
  const save = page.getByRole('button', { name: '軸馬1頭と判断を固定保存', exact: true })
  await expect(save).toBeDisabled()
  const candidates = page.getByRole('radio', { name: /番 架空馬.* を軸にする/ })
  expect(await candidates.count()).toBeGreaterThanOrEqual(1)
  expect(await candidates.count()).toBeLessThanOrEqual(2)
  await candidates.first().check()
  await page.getByLabel('軸馬を選んだ理由・判断メモ').fill('3着内率と現在の妙味を確認して1頭を選択')
  await save.click()
  const frozen = page.getByLabel('保存時の軸馬と判断')
  await expect(frozen).toContainText('固定した軸馬 1番 架空馬A')
  await expect(frozen).toContainText('単勝変化 -16.7%')
  const originalSummary = await frozen.textContent()
  const ledger = await savedLedger(page)
  expect(ledger.forecasts).toHaveLength(2)
  expect(ledger.forecasts[0].kind).toBe('ace')
  expect(ledger.forecasts[0].parameters.anchorSelection.selected).toBeNull()
  expect(ledger.forecasts[1].kind).toBe('user')
  expect(ledger.forecasts[1].parameters.anchorSelection.selected).toBe(1)
  const selectedHorse = ledger.forecasts[1].field.find(horse => horse.no === 1)
  const selectedPrice = ledger.forecasts[1].inputs.winOdds[1]
  await expect(comparison.getByRole('row').nth(1).getByRole('cell')).toHaveText([
    `${(selectedHorse.probability * 100).toFixed(1)}%`, '70.3%', `${selectedPrice.toFixed(1)}倍`, `${(selectedHorse.probability * selectedPrice * 100).toFixed(1)}%`,
  ])
  await expect(page.getByRole('table', { name: '保存時の予想比較', exact: true }).getByRole('columnheader')).toHaveText([
    '馬番・馬名', '推定勝率', '推定3着内率', '単勝オッズ', '単勝期待回収率',
  ])
  expect(ledger.forecasts[1].allocations).toEqual([])
  expect(ledger.purchases).toEqual([])
  expect(ledger.forecasts[1].metrics.invested).toBe(0)
  expect(ledger.forecasts[1].field.map(horse => horse.probability)).toEqual(ledger.forecasts[0].field.map(horse => horse.probability))
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  const card = comparison.getByRole('row').first()
  await expect(card.getByRole('rowheader')).toBeInViewport()
  await expect(card.locator('[data-label="単勝オッズ"]')).toBeInViewport()
  await expect(card.locator('[data-label="単勝期待回収率"]')).toBeInViewport()
  await page.getByRole('region', { name: '妙味のある候補から軸を1頭選ぶ', exact: true }).screenshot({ path: '.qa/anchor-comparison-mobile.png' })
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: '.qa/single-anchor-mobile.png', fullPage: true })
  await page.reload()
  await expect(frozen).toHaveText(originalSummary)
  await page.getByText('判断条件を確認・変更', { exact: true }).click()
  await page.getByLabel('オッズ下落の想定（%）').fill('80')
  await expect(frozen).toHaveText(originalSummary)
  await expect(page.getByText('このレースは見送り', { exact: false }).first()).toBeVisible()
  await expect(comparison.getByRole('radio')).toHaveCount(0)
  await page.getByRole('button', { name: '見送りを固定保存', exact: true }).click()
  await expect(frozen).toContainText('このレースは見送り')
  const skipped = await savedLedger(page)
  expect(skipped.forecasts.at(-1).parameters.anchorSelection.suggested).toEqual([])
  expect(skipped.forecasts.at(-1).parameters.anchorSelection.selected).toBeNull()
  expect(skipped.forecasts.at(-1).parameters.anchorSelection.decision).toBe('skip')
  await page.getByLabel('オッズ下落の想定（%）').fill('81')
  await expect(page.getByRole('button', { name: /を固定保存/ })).toBeDisabled()
})

test('a user can explicitly skip a race that has a qualifying candidate', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
  await page.goto('/market-preview.html?state=anchors-manual-skip')
  await page.getByRole('radio', { name: '今回は見送る' }).check()
  await page.getByRole('button', { name: '見送りを固定保存', exact: true }).click()
  await expect(page.getByLabel('保存時の軸馬と判断')).toContainText('このレースは見送り')
  const ledger = await savedLedger(page)
  expect(ledger.forecasts[0].parameters.anchorSelection.decision).toBe('pending')
  expect(ledger.forecasts[1].parameters.anchorSelection.decision).toBe('skip')
  expect(ledger.forecasts[1].parameters.anchorSelection.selected).toBeNull()
  await expect(page.getByLabel('保存時の軸馬と判断')).toContainText('このレースは見送り')
})

test('missing observations hold the value assessment and prevent saving', async ({ page }) => {
  // Legacy record compatibility fixture; the public navigation no longer exposes anchor selection.
  await page.goto('/market-preview.html?state=anchors-empty')
  await expect(page.getByText('判断保留', { exact: false })).toBeVisible()
  await expect(page.getByRole('button', { name: /軸馬1頭.*保存/ })).toBeDisabled()
})

test('observed place-only value survives reload and never uses a later quote at an earlier observation', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
  await page.goto('/market-preview.html?state=anchors-place')
  const current = { ...demoSnapshots().at(-1), id: 'place-current', odds: Object.fromEntries(horses.map(h => [h.no, 2])) }
  const payload = { race: { ...race, horses }, snapshots: [current], observations: [{ kind: 'LIVE_RACE',
    eventId: 'place-context', retrievedAt: current.retrievedAt, payload: { ...current, winOdds: current.odds,
      quotes: [{ type: '複勝', numbers: [2], odds: 3, upper: 5 }] } }] }
  await page.evaluate(async ({ payload, race, horses }) => {
    const { applyCloudData } = await import('/src/cloudStore.js')
    await applyCloudData('synthetic-demo-anchors-place', race, horses, payload)
  }, { payload, race, horses })
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
  const horse = page.getByRole('radio', { name: '2番 架空馬B を軸にする' })
  await horse.check()
  await expect(page.getByText('複勝に妙味候補', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '軸馬1頭と判断を固定保存', exact: true }).click()
  const frozen = page.getByLabel('保存時の軸馬と判断')
  await expect(frozen).toContainText('固定した軸馬 2番')
  const record = (await savedLedger(page)).forecasts.at(-1)
  expect(record.inputs.quotes.find(q => q.type === '複勝')).toMatchObject({ odds: 3, upper: 5 })
  await page.reload()
  await expect(horse).toBeChecked()
  await expect(page.getByText('複勝に妙味候補', { exact: true })).toBeVisible()
  await page.getByLabel('オッズの観測時刻').selectOption('demo-0')
  // The 15:30 place quote cannot be carried back into the selected 15:10 snapshot.
  await expect(page.getByText('複勝に妙味候補', { exact: true })).toHaveCount(0)
  await expect(frozen).toContainText('固定した軸馬 2番')
})
