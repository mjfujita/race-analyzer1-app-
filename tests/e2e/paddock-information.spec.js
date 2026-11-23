import {test,expect} from '@playwright/test'
import {race,aceHorses} from '../../dev/fixtures.js'

async function update(page,status='available'){
 const source=(time,late=false)=>({raceId:race.id,raceDate:race.raceDate,retrievedAt:time,observedAt:time,availabilityAt:time,timingEvidence:'observed-visible-at',
  horses:aceHorses.map(h=>({horseNo:h.no,paddockIndex:late&&h.no===1?3.6:null,horseWeight:late?482:480,horseWeightDelta:late?2:0})),
  paddockComments:late&&status==='available'?[{horseNo:1,text:'パドック：歩様は一定（架空）'},{horseNo:1,text:'返し馬：折り合い良好（架空）'}]:[],
  ...(late?{paddockCapture:{status,checkedAt:'2026-11-15T06:44:59Z',fieldSize:8}}:{})})
 const early=source('2026-11-15T06:20:00Z'),late=source('2026-11-15T06:45:00Z',true)
 await page.evaluate(async({race,horses,early,late})=>{
  const {applyCloudData}=await import('/src/cloudStore.js')
  await applyCloudData('synthetic-demo-ace-paddock',race,horses,{race:{...race,horses},context:late,observations:[early,late].map((payload,i)=>({kind:'LIVE_RACE',eventId:`paddock-${i}`,retrievedAt:payload.retrievedAt,payload}))})
 },{race,horses:aceHorses,early,late})
 await page.getByRole('button',{name:'同期データを再読込（開発確認）'}).click()
}
async function open(page){
 await page.clock.setFixedTime(new Date('2026-11-15T07:00:00Z'))
 await page.goto('/market-preview.html?state=ace-paddock')
 await page.getByLabel('表示する馬').selectOption('1')
}

test('late data is labeled acquired and excluded, latest reference is accessible, and ACE probabilities stay protected',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await open(page)
 const ace=page.getByRole('region',{name:'1番のACE予想',exact:true})
 const before=await ace.locator('dl').first().innerText()
 await update(page)
 const paddock=page.getByRole('region',{name:'1番のパドック・直前情報',exact:true})
 await expect(paddock).toContainText('パドック点・コメントは締切後に取得済み')
 await expect(paddock).not.toContainText('歩様は一定（架空）')
 await expect(ace).toContainText('ACEの事前予想には使用していません')
 expect(await ace.locator('dl').first().innerText()).toBe(before)
 await page.getByRole('button',{name:'最新の参考情報を表示',exact:true}).click()
 await expect(paddock).toContainText('482kg（+2kg）')
 await expect(paddock.getByRole('definition').filter({hasText:/^3\.6$/})).toBeVisible()
 await expect(paddock).toContainText('パドック：歩様は一定（架空）')
 await expect(paddock).toContainText('返し馬：折り合い良好（架空）')
 expect(await ace.locator('dl').first().innerText()).toBe(before)
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await paddock.scrollIntoViewIfNeeded();await page.screenshot({path:'.qa/paddock-latest-mobile.jpg',fullPage:false})
 await page.getByLabel('発走10分前までに取得した直前情報のみ').check()
 await page.getByLabel('表示時刻',{exact:true}).selectOption('demo-0')
 await expect(paddock).toContainText('参照時点より後に取得済み')
 expect(errors).toEqual([])
})

test('optional-content unavailability and capture failure are explicit; a blank point is not an invented zero',async({page})=>{
 await open(page)
 const paddock=page.getByRole('region',{name:'1番のパドック・直前情報',exact:true})
 await update(page,'not-provided')
 await expect(paddock).toContainText('このJRDB画面ではコメント提供なし（オプション情報）')
 await expect(paddock).toContainText('旧取得方式のためコメント記録なし')
 await page.getByRole('button',{name:'最新の参考情報を表示',exact:true}).click()
 await expect(paddock).not.toContainText('旧取得方式')
 await page.getByLabel('表示する馬').selectOption('2')
 await expect(page.getByRole('region',{name:'2番のパドック・直前情報',exact:true})).toContainText('画面に点数の記載なし')
 await page.getByLabel('表示する馬').selectOption('1')
 await update(page,'failed')
 await expect(paddock).toContainText('コメント取得に失敗しました')
})
