import { execFile } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { parseVisibleRace } from '../../collector/capture.mjs'
import { demoSnapshots, horses, odds, race } from '../../dev/fixtures.js'
import { createCompanionHandler, createCompanionService } from '../../server/companion.js'
import { memoryStore, request } from '../fixtures/companion.js'

const ownerId = 'synthetic-demo-connected-test'
const companionToken = 'synthetic-worker-credential-for-integration-test'
const ownerToken = 'synthetic-owner-credential'
const before = '2026-11-15T06:25:00.000Z'
const after = '2026-11-15T09:00:00.000Z'
const game = { raceId: race.id, raceDate: race.raceDate }
const runPython = promisify(execFile)
const fixedClock = `
import runpy
import sys
from unittest.mock import patch

stamp, module = sys.argv[1:3]
sys.argv = [module, *sys.argv[3:]]
with patch("pipeline.ingest.now_iso", return_value=stamp):
    runpy.run_module(module, run_name="__main__", alter_sys=True)
`

test('a browser forecast becomes a worker-verified result without rewriting its saved probabilities', async ({ page }, testInfo) => {
  let clock = before
  let dropSaveResponse = true
  const service = createCompanionService({ store: memoryStore(), ownerId, now: () => Date.parse(clock) })
  const handler = createCompanionHandler({ service, ownerId, companionToken,
    authenticateUser: async token => token === ownerToken ? { id: ownerId } : null })
  const worker = async body => {
    const response = await request(handler, { method: 'POST', token: companionToken, body })
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    return response.body
  }
  const publish = content => worker({
    schemaVersion: 1, kind: 'race-companion-bundle', generatedAt: clock,
    status: { state: 'ready', lastRunAt: clock }, races: [], ...content,
  })
  const snapshots = demoSnapshots().filter(snapshot => Date.parse(snapshot.retrievedAt) <= Date.parse(clock))
  await publish({ races: [{ ...game, race: { ...race, horses }, snapshots, observations: [] }] })

  await page.route('**/api/companion*', async route => {
    const incoming = route.request()
    const response = await request(handler, {
      method: incoming.method(),
      token: incoming.headers().authorization?.slice('Bearer '.length) ?? null,
      query: Object.fromEntries(new URL(incoming.url()).searchParams),
      body: incoming.postData() ?? undefined,
    })
    if (dropSaveResponse && incoming.method() === 'POST' && response.status === 200 && Object.keys(response.body.receipts ?? {}).length) {
      dropSaveResponse = false
      await route.abort('connectionfailed')
    } else {
      await route.fulfill({ status: response.status, headers: response.headers, json: response.body })
    }
  })
  await page.clock.setFixedTime(new Date(before))
  await page.goto('/market-preview.html?state=connected-test')
  await page.evaluate(async access_token => {
    const { supabase } = await import('/src/supabase.js')
    supabase.auth.getSession = async () => ({ data: { session: { access_token } }, error: null })
  }, ownerToken)
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
  await page.getByRole('button', { name: '10分前の予想を固定保存' }).click()
  await expect(page.getByRole('status')).toContainText('クラウドへの同期は再試行待ちです')
  clock = '2026-11-15T06:30:01.000Z'
  await page.clock.setFixedTime(new Date(clock))
  await page.getByRole('button', { name: '同期データを再読込（開発確認）' }).click()
  await expect(page.getByText('締切前受領 11/15 15:25', { exact: true })).toBeVisible()
  await expect(page.getByRole('status')).toContainText('締切前の受領を確認しました')

  const pulled = await worker({ action: 'pull-ledgers', ...game })
  const forecast = pulled.ledger.forecasts[0]
  expect(pulled.receipts).toMatchObject([{ forecastId: forecast.id, receivedAt: before }])
  expect(pulled.ledger.purchases).toHaveLength(0)

  const output = testInfo.outputPath('research')
  await mkdir(output, { recursive: true })
  const path = testInfo.outputPath('worker-input.json')
  const python = (module, ...args) => runPython('python3', ['-c', fixedClock, clock, module, ...args, '--output', output])
  const input = contents => writeFile(path, JSON.stringify(contents))
  const review = async () => {
    await python('pipeline.run', 'review')
    const forecastReview = JSON.parse(await readFile(`${output}/forecast-review.json`, 'utf8'))
    await publish({ forecastReview })
    return forecastReview
  }
  await input([pulled])
  await python('collector.persist', 'ledger', '--input', path)
  expect((await review()).eligibleRaces).toBe(0)
  await page.getByRole('button', { name: '振り返り', exact: true }).click()
  await page.getByRole('button', { name: '振り返りを同期' }).click()
  await expect(page.getByText(/着順待ち · 締切前受領済み/)).toBeVisible()

  clock = after
  await page.clock.setFixedTime(new Date(clock))
  const winnerNo = 3
  const placements = [3, 1, 2, 4, 5, 6, 7, 8]
  const target = { ...game, postTime: race.postTime, fieldSize: horses.length,
    horses: horses.map(horse => ({ horseNo: horse.no, name: horse.name })) }
  const capture = parseVisibleRace({
    oddsLabel: '単勝最終オッズ',
    rows: horses.map(horse => ({
      umaban: horse.no, bamei9m: horse.name, idm: horse.idm, tanodds: odds[horse.no],
      se_tyakujun: placements.indexOf(horse.no) + 1,
    })),
    payoutTables: [['単勝', `${winnerNo}番`, '500円', '3人気']],
  }, target, { retrievedAt: after })
  await input([capture])
  await python('collector.persist', 'persist', '--input', path)
  const reviewed = await review()
  expect(reviewed.eligibleRaces).toBe(1)
  expect(reviewed.races[0]).toMatchObject({ forecastId: forecast.id, winnerNo, state: 'matched', source: 'LIVE' })
  const savedWinner = forecast.field.find(horse => horse.no === winnerNo)
  expect(reviewed.races[0].field.find(horse => horse.no === winnerNo).probability).toBe(savedWinner.probability)

  await page.getByRole('button', { name: '振り返りを同期' }).click()
  await expect(page.getByText(/照合済み .* 着順1位 3番/)).toBeVisible()
  const winner = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: '3番', exact: true }) })
  await expect(winner).toContainText(`${(savedWinner.probability * 100).toFixed(1)}%`)
  await expect(winner.getByRole('cell', { name: '1', exact: true })).toBeVisible()
})
