import {test,expect} from '@playwright/test'
import {race,aceHorses} from '../../dev/fixtures.js'

async function open(page,state='ace-analysis'){
 await page.clock.setFixedTime(new Date('2026-11-15T06:25:00Z'))
 await page.goto(`/market-preview.html?state=${state}`)
 await expect(page.getByRole('heading',{name:'ACEのレース全体の見立て',exact:true})).toBeVisible()
}
async function sync(page){
 const source=(time,index)=>({raceId:race.id,raceDate:race.raceDate,retrievedAt:time,observedAt:time,availabilityAt:time,timingEvidence:'observed-visible-at',
  going:'重',weather:'雨',horses:aceHorses.map(h=>({horseNo:h.no,paddockIndex:index,horseWeight:480,horseWeightDelta:0})),
  paddockComments:[{horseNo:1,text:'架空の歩様コメント'},{horseNo:2,text:'別の馬だけのコメント'}]})
 const early=source('2026-11-15T06:22:00Z',0),late=source('2026-11-15T06:45:00Z',9)
 await page.evaluate(async({race,horses,early,late})=>{
  const {applyCloudData}=await import('/src/cloudStore.js')
  await applyCloudData('synthetic-demo-ace-analysis',race,horses,{race:{...race,horses},context:late,observations:[early,late].map((payload,i)=>({kind:'LIVE_RACE',eventId:`ace-${i}`,retrievedAt:payload.retrievedAt,payload}))})
 },{race,horses:aceHorses,early,late})
 await page.getByRole('button',{name:'同期データを再読込（開発確認）'}).click()
}

test('ACE predicts each horse with inspectable materials and separates later references from the prediction',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await open(page)
 const cards=page.getByRole('region',{name:'各馬の評価',exact:true})
 await expect(cards.getByRole('heading',{name:'ACEの今回予想',exact:true})).toHaveCount(8)
 await page.getByLabel('表示する馬').selectOption('1')
 const ace=page.getByRole('region',{name:'1番のACE予想',exact:true})
 await expect(ace).toContainText('勝ち候補として比較')
 await expect(ace).toContainText('推定勝率')
 await expect(ace).toContainText('推定3着内率')
 await sync(page)
 await ace.locator('summary').click()
 await expect(ace).toContainText('架空の歩様コメント')
 await expect(ace).not.toContainText('別の馬だけのコメント')
 await expect(ace).toContainText('JRDBパドック点0')
 await expect(ace).toContainText('調教指数・コメント未取得')
 await expect(ace).toContainText('騎手架空騎手')
 const before=await ace.innerText()
 await page.clock.setFixedTime(new Date('2026-11-15T07:00:00Z'))
 await page.getByLabel('発走10分前までに取得した直前情報のみ').uncheck()
 await expect(page.getByText('締切後の参考情報を表示中です。事前評価・勝率の補正には使用しません。')).toBeVisible()
 expect(await ace.innerText()).toBe(before)
 await page.getByLabel('表示時刻',{exact:true}).selectOption('demo-0')
 await expect(ace).toContainText('パドック点未取得')
 await expect(ace).not.toContainText('架空の歩様コメント')
 await page.setViewportSize({width:390,height:844})
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await ace.scrollIntoViewIfNeeded();await page.screenshot({path:'.qa/ace-assessment-mobile.jpg',fullPage:false})
 await page.setViewportSize({width:1440,height:1000})
 await page.getByLabel('表示する馬').selectOption('all')
 await page.getByRole('heading',{name:'ACEのレース全体の見立て',exact:true}).scrollIntoViewIfNeeded()
 await page.screenshot({path:'.qa/ace-assessment-desktop.jpg',fullPage:false})
 expect(errors).toEqual([])
})

test('incomplete ability and history leave ACE axis judgments on hold, not fabricated odds or probabilities',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-15T06:25:00Z'))
 await page.goto('/market-preview.html?state=assessment')
 await page.getByRole('button',{name:'能力・適性',exact:true}).click()
 const ace=page.getByRole('region',{name:'1番のACE予想',exact:true})
 await expect(ace).toContainText('軸判断を保留')
 await expect(ace.getByText('推定勝率',{exact:true})).toHaveCount(0)
 await page.getByLabel('表示する馬').selectOption('8')
 await expect(page.getByRole('region',{name:'8番のACE予想',exact:true})).toContainText('出走対象外')
 await page.goto('/market-preview.html?state=error')
 await page.getByRole('button',{name:'能力・適性',exact:true}).click()
 await expect(page.getByRole('alert')).toContainText('オッズの保存形式を読み取れません')
 await expect(page.getByRole('heading',{name:'ACEの今回予想',exact:true})).toHaveCount(0)
})
