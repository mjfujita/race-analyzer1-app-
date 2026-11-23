export const race = { id: 'DEMO260811', raceDate: '20261115', raceNo: 11, name: '市場評価テスト（架空）', placeCode: '08',
  postTime: '1540', fieldSize: 8, releaseFieldSize: 8, weather: '晴', going: '良', surface: '芝', distance: '芝2200m' }
export const horses = [60, 58, 54, 52, 50, 49, 47, 46].map((idm, index) => ({
  id: `synthetic-${index + 1}`, no: index + 1, frameNo: index + 1, idm, name: `架空馬${String.fromCharCode(65 + index)}`,
  predictedFavRank: index + 1, abilityScore: 90 - index * 5,
  pastRuns: [{ rank: index < 3 ? 2 : 5, field_size: 12, dist: '芝2200m', going: '良' }],
}))
export const statistics = horses.map(horse => ({ horse_no: horse.no, idm: horse.idm, frame_no: horse.frameNo,
  running_style: 1 + (horse.no % 4), distance_runs: 3, distance_top3: 2, venue_runs: 4, venue_top3: 2, course_runs: 2, course_top3: 1 }))

export const assessmentHorses=horses.map((h,i)=>({...h,idm:i===1?60:i===3?null:h.idm,cancelled:i===7,
  name:i===0?'架空の長い馬名で表示幅を確認する馬':h.name,
  pastRuns:i===6?[]:[
    {date:'20261101',rank:1,field_size:12,dist:'芝2200m',placeCode:'08',going:'良',last3f:34.1},
    {date:'20261020',rank:3,field_size:14,dist:'芝2000m',placeCode:'05',going:'重',last3f:35.4},
    {date:'20261010',rank:7,field_size:12,dist:'ダート1800m',placeCode:'08',going:'良',last3f:37.1},
    {date:'20261115',rank:1,field_size:12,dist:'芝2200m'},
    {date:'20261116',rank:1,field_size:12,dist:'芝2200m'},
  ]}))
export const assessmentStatistics=assessmentHorses.map(h=>({horse_no:h.no,idm:h.idm}))
export const earlierRaces = [1, 2, 3, 4].map(no => ({ race_no: no, post_time: `${10 + no}00`, distance: 1800,
  field_size: 12, surface_code: no % 2 ? '1' : '2' }))
export const odds = { 1: 5, 2: 3.1, 3: 5, 4: 6.7, 5: 8, 6: 10, 7: 11.4, 8: 16 }
export function demoSnapshots() {
  return [
    { schemaVersion: 2, id: 'demo-baseline', raceId: race.id, raceDate: race.raceDate, kind: 'baseline', time: '14:50',
      observedAt: '2026-11-15T05:50:00.000Z', sourcePublishedAt: '2026-11-15T05:50:00.000Z', retrievedAt: '2026-11-15T05:51:00.000Z',
      source: 'synthetic-demo', revisionOf: null, odds: { 1: 4, 2: 3.8, 3: 5, 4: 7, 5: 8, 6: 10, 7: 12, 8: 15 } },
    ...['15:10', '15:20', '15:30'].map((time, i) => ({ schemaVersion: 2, id: `demo-${i}`, raceId: race.id, raceDate: race.raceDate,
      kind: 'observed', time, observedAt: `2026-11-15T06:${10 + 10 * i}:00.000Z`, sourcePublishedAt: `2026-11-15T06:${10 + 10 * i}:00.000Z`,
      retrievedAt: `2026-11-15T06:${10 + 10 * i}:00.000Z`, source: 'synthetic-demo', revisionOf: null,
      odds: { ...odds, 1: odds[1] + (2 - i) * 0.5 } })),
  ]
}

export const aceHorses=horses.map(h=>({...h,jockey:'架空騎手',trainer:'架空厩舎',weightCarried:55,
  pastRuns:[{date:'20261101',rank:h.no<=3?2:6,field_size:12,dist:'芝2200m',placeCode:'08',going:'良',last3f:34.5},
    {date:'20261020',rank:3,field_size:12,dist:'芝2000m',placeCode:'05',going:'重'},
    {date:'20261001',rank:4,field_size:12,dist:'芝2200m',placeCode:'08',going:'良'}]}))
