export function nearDistanceRecord(race, horse) {
  const target = /^(芝|ダート|障害)\s*(\d+)m/.exec(race.distance ?? '')
  if (!target || !Array.isArray(horse.pastRuns)) return {}
  const similar = horse.pastRuns.filter(run => {
    const distance = /^(芝|ダート|障害)\s*(\d+)m/.exec(run.dist ?? '')
    return distance && distance[1] === target[1] && Math.abs(Number(distance[2]) - Number(target[2])) <= 200
      && Number.isInteger(run.rank) && run.rank > 0 && (!run.field_size || run.rank <= run.field_size)
  })
  return { similarRuns: similar.length, similarTopThree: similar.filter(run => run.rank <= 3).length }
}

export function buildInitialForecast(race, horses) {
  const ranked = horses.filter(horse => Number.isFinite(horse.predictedFavRank) && horse.predictedFavRank > 0)
    .sort((a, b) => a.predictedFavRank - b.predictedFavRank || a.no - b.no)
  const candidates = ranked.filter(horse => horse.predictedFavRank <= 5).map(horse => {
    return { no: horse.no, name: horse.name, rank: horse.predictedFavRank, ...nearDistanceRecord(race, horse) }
  })
  const leaders = candidates.filter(horse => horse.rank === candidates[0]?.rank)
  const axis = leaders.length === 1 ? leaders[0] : null
  const comparison = axis ? candidates.filter(horse => horse.no !== axis.no).flatMap(horse => {
    const pair = [axis.no, horse.no].sort((a, b) => a - b).join('-')
    const reason = `IDM ${axis.rank}位と${horse.rank}位`
    return [{ type: '馬連', pair, reason }, { type: 'ワイド', pair, reason }]
  }) : []
  return {
    candidates, comparison,
    scenario: race.raceScenarioComment || '',
    scenarioTags: race.raceScenarioTags ?? [],
    distance: race.distance ?? '',
  }
}
