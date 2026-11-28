import {test,expect} from '@playwright/test'
import {race,horses,demoSnapshots} from '../../dev/fixtures.js'
import {createPrediction,createJournalResult} from '../../src/predictionJournal.js'
import {createCompanionService,createCompanionHandler} from '../../server/companion.js'
import {memoryStore,request} from '../fixtures/companion.js'
test('frequency percentages, average group sizes, patterns and condition filters stay consistent on mobile',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message))
 await page.goto('/market-preview.html?state=results-local-review')
 const table=page.getByRole('table',{name:'全レースのグループ別着順回数'})
 const a=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'A群',exact:true})})
 await expect(a).toContainText('2.0頭');await expect(a).toContainText('存在 2／2レース');await expect(a).toContainText('50.0%')
 const patterns=page.getByRole('heading',{name:'よく出たグループの組み合わせ',exact:true});await expect(patterns).toBeVisible()
 await expect(page.getByText('1／2レース（50.0%）',{exact:true})).toHaveCount(4)
 const ace=page.getByRole('region',{name:'ACEの事前予測との比較'});await expect(ace).toContainText('比較可能 0／2レース');await expect(ace).toContainText('過去の結果から予測確率を作り直しません。')
 await page.getByLabel('グループ傾向の馬場').selectOption('ダート');await expect(page.getByRole('region',{name:'当日の全レース・グループ傾向'})).toContainText('グループ集計 1レース');await expect(a).toContainText('存在 1／1レース');await expect(a).toContainText('100.0%')
 await page.getByLabel('グループ傾向の馬場').selectOption('');await page.getByLabel('グループ傾向のレース種別').selectOption('新馬');await expect(table.locator('tbody tr')).toHaveCount(0)
 await expect(page.getByRole('region',{name:'当日の全レース・グループ傾向'})).toContainText('グループ集計 0レース')
 await page.getByLabel('グループ傾向のレース種別').selectOption('')
 await page.setViewportSize({width:1280,height:1000});await page.screenshot({path:'.qa/tendency-metrics-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 for(const cell of await table.locator('tbody tr').first().locator('td').all()){const b=await cell.boundingBox();expect(b.x).toBeGreaterThanOrEqual(0);expect(b.x+b.width).toBeLessThanOrEqual(390)}
 await page.screenshot({path:'.qa/tendency-metrics-mobile.png',fullPage:true});expect(errors).toEqual([])
})
test('authenticated frozen pre-race probabilities produce expected counts only for matching records',async({page})=>{
 const state='results-connected-metrics',ownerId=`synthetic-demo-${state}`,store=memoryStore();let now=Date.parse('2026-11-15T06:25:00Z')
 const service=createCompanionService({store,ownerId,now:()=>now})
 const other={...race,id:'DEMO260812',raceNo:12,placeCode:'05',postTime:'1550',surface:'ダート',name:'2歳未勝利'}
 const odds={1:3,2:3.5,3:8,4:9,5:20,6:25,7:80,8:100},snapshot={...demoSnapshots()[2],odds}
 const probabilities={asOf:snapshot.retrievedAt,horses:[],groups:['A','B','C','D'].map((label,i)=>({label,status:'ready',count:2,totalCount:2,fieldSize:8,win:[.4,.3,.2,.1][i],second:[.3,.3,.2,.2][i],third:[.2,.3,.3,.2][i]}))}
 await service.ingestBundle({schemaVersion:1,kind:'race-companion-bundle',generatedAt:'2026-11-15T06:25:00Z',status:{state:'ready',lastRunAt:'2026-11-15T06:25:00Z'},races:[race,other].map(r=>({raceId:r.id,raceDate:r.raceDate,race:{...r,horses},snapshots:[{...snapshot,id:'snapshot-'+r.id,raceId:r.id}],observations:[]}))})
 for(const r of [race,other])await service.saveJournalRecord(createPrediction({race:r,field:horses,snapshot:{...snapshot,id:'snapshot-'+r.id,raceId:r.id},type:'3連単',slots:[['A'],['B'],['C']],probabilities},'2026-11-15T06:25:00Z','pre-'+r.id))
 now=Date.parse('2026-11-15T07:15:00Z')
 for(const [r,numbers] of [[race,[1,3,5]],[other,[4,2,7]]])await service.saveJournalRecord(createJournalResult({raceId:r.id,raceDate:r.raceDate,numbers},'2026-11-15T07:00:00Z','result-'+r.id))
 const handler=createCompanionHandler({service,ownerId,companionToken:'collector-secret-0123456789012345',authenticateDevice:async()=>({id:ownerId}),checkDeviceWrite:()=>{},authenticateUser:async()=>null})
 await page.route('**/api/companion**',async route=>{const req=route.request(),url=new URL(req.url()),response=await request(handler,{token:null,method:req.method(),body:req.method()==='POST'?req.postDataJSON():undefined,query:Object.fromEntries(url.searchParams)});await route.fulfill({status:response.status,contentType:'application/json',body:JSON.stringify(response.body)})})
 await page.clock.setFixedTime(new Date('2026-11-15T07:15:00Z'));await page.goto('/market-preview.html?state='+state)
 const ace=page.getByRole('region',{name:'ACEの事前予測との比較'});await expect(ace).toContainText('比較可能 2／2レース')
 const table=page.getByRole('table',{name:'ACEの想定回数と実績'})
 const a=table.getByRole('row').filter({has:page.getByRole('rowheader',{name:'A群',exact:true})})
 await expect(a).toContainText('ACE想定 0.8回');await expect(a).toContainText('実績 1回');await expect(a).toContainText('差 +0.2回')
 await page.getByLabel('グループ傾向の会場').selectOption('東京');await expect(ace).toContainText('比較可能 1／1レース');await expect(a).toContainText('ACE想定 0.4回')
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
 await page.screenshot({path:'.qa/tendency-ace-comparison-mobile.png',fullPage:true})
 const saved=await service.getPredictionJournal({raceDate:race.raceDate});expect(saved.predictions).toHaveLength(2);expect(saved.registrations).toHaveLength(0);expect(saved.results).toHaveLength(2)
})
