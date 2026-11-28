import {test,expect} from '@playwright/test'
async function expand(page){for(const item of await page.locator('.rca-group-horse-details > summary').all())if(!await item.evaluate(el=>el.parentElement.open))await item.click()}
async function labels(page){const labels={};for(const group of await page.locator('.rca-group-horses').all())for(const button of await group.getByRole('button').all())labels[Number((await button.getAttribute('aria-label')).match(/^\d+/)[0])]=(await group.getAttribute('aria-label'))[0];return labels}
async function composer(page){
 await page.getByRole('button',{name:'私の予想',exact:true}).click()
 await page.getByRole('button',{name:'新しい予想を入力する',exact:true}).click()
 await page.getByText('グループの確率・中心馬を確認',{exact:true}).click()
 return page.getByRole('table',{name:'保存時の各馬の確率',exact:true})
}
test('personal horse probabilities show matching manual groups without reintroducing anchor navigation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.clock.setFixedTime(new Date('2026-11-15T06:31:00Z'))
 await page.goto('/market-preview.html?state=groups-anchor-labels')
 await expand(page);const original=await labels(page)
 const table=await composer(page)
 await expect(table.getByRole('columnheader')).toHaveText(['群・馬','1着','2着','3着','3着内'])
 for(const [no,g] of Object.entries(original))await expect(table.getByRole('rowheader').filter({hasText:new RegExp(`^${g} ${no} `)})).toHaveCount(1)
 const probabilities=await table.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll('td')).map(td=>td.textContent)))
 await page.getByRole('button',{name:'入力をやめて戻る',exact:true}).click()
 await page.getByRole('button',{name:'グループ・買い目',exact:true}).click()
 const cut=page.getByLabel('1番の前で区切る',{exact:true});await cut.setChecked(!await cut.isChecked())
 await expand(page);const expected=await labels(page)
 const changed=await composer(page)
 for(const [no,g] of Object.entries(expected))await expect(changed.getByRole('rowheader').filter({hasText:new RegExp(`^${g} ${no} `)})).toHaveCount(1)
 expect(await changed.locator('tbody tr').evaluateAll(rows=>rows.map(row=>Array.from(row.querySelectorAll('td')).map(td=>td.textContent)))).toEqual(probabilities)
 await expect(page.getByRole('button',{name:/軸候補/})).toHaveCount(0)
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 expect(errors).toEqual([])
})
