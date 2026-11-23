import {test,expect} from '@playwright/test'
async function expand(page){for(const item of await page.locator('.rca-group-horse-details > summary').all())if(!await item.evaluate(el=>el.parentElement.open))await item.click()}

test('all-horse table shows matching groups, shares manual cuts at the same observation and preserves probabilities',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-11-15T06:30:00Z'))
 await page.goto('/market-preview.html?state=groups-anchor-labels')
 await expand(page)
 const cards=page.locator('.rca-group-horses')
 const labels={}
 for(const group of await cards.all()){
  const label=(await group.getAttribute('aria-label'))[0]
  for(const button of await group.getByRole('button').all())labels[Number((await button.getAttribute('aria-label')).match(/^\d+/)[0])]=label
 }
 await page.getByRole('button',{name:'軸候補・妙味判断',exact:true}).click()
 await page.getByText('全頭の妙味と人気の推移',{exact:true}).click()
 const table=page.getByRole('table',{name:'全頭の軸候補比較',exact:true})
 await expect(table.getByRole('columnheader').first()).toHaveText('グループ・馬番・馬名')
 for(const [no,label] of Object.entries(labels))await expect(table.getByRole('rowheader').filter({hasText:new RegExp(`${no}番 `)}).getByLabel(`グループ ${label}`,{exact:true})).toBeVisible()
 const probabilities=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[row.querySelector('th').textContent.replace(/^[A-Z—]/,''),...Array.from(row.querySelectorAll('td')).slice(0,2).map(td=>td.textContent)]))
 await page.getByRole('button',{name:'グループ・買い目',exact:true}).click()
 const cut=page.getByLabel('1番の前で区切る',{exact:true});await cut.setChecked(!await cut.isChecked())
 await expand(page)
 const expected={}
 for(const group of await cards.all())for(const button of await group.getByRole('button').all())expected[Number((await button.getAttribute('aria-label')).match(/^\d+/)[0])]=(await group.getAttribute('aria-label'))[0]
 await page.getByRole('button',{name:'軸候補・妙味判断',exact:true}).click()
 await page.getByText('全頭の妙味と人気の推移',{exact:true}).click()
 await expect(page.getByText('グループは表示中の単勝オッズで分類（グループ画面の手動区切り）。能力の順位ではありません。',{exact:true})).toBeVisible()
 for(const [no,label] of Object.entries(expected))await expect(table.getByRole('rowheader').filter({hasText:new RegExp(`${no}番 `)}).getByLabel(`グループ ${label}`,{exact:true})).toBeVisible()
 expect(await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>[row.querySelector('th').textContent.replace(/^[A-Z—]/,''),...Array.from(row.querySelectorAll('td')).slice(0,2).map(td=>td.textContent)]))).toEqual(probabilities)
 await page.getByLabel('オッズの観測時刻').selectOption('demo-1')
 await expect(page.getByText('別の観測時点の手動区切りは適用していません。',{exact:false})).toBeVisible()
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await table.scrollIntoViewIfNeeded();await page.screenshot({path:'.qa/anchor-groups-mobile.jpg',fullPage:false})
 expect(errors).toEqual([])
})
