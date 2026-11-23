import {groupOdds} from './groupAnalysis.js'
import {raceDateISO} from './raceTime.js'

export function matchingGroupPreference(race,preference){
  return preference&&preference.raceId===String(race?.id)&&raceDateISO(preference)===raceDateISO(race)
    &&raceDateISO(race)&&typeof preference.snapshotId==='string'&&preference.snapshotId.length>0
    &&Number.isFinite(preference.threshold)&&preference.threshold>=1.1&&preference.threshold<=5
    &&(preference.boundaries===null||Array.isArray(preference.boundaries)&&new Set(preference.boundaries).size===preference.boundaries.length
      &&preference.boundaries.every(no=>Number.isInteger(no)&&no>=1&&no<=18))?preference:null
}

// Group labels describe the selected prices only. They never alter probabilities.
export function displayGroups({race,field,snapshot,preference}){
  const config=matchingGroupPreference(race,preference)
  const threshold=config?.threshold??1.5
  const sameSnapshot=Boolean(snapshot?.id&&snapshot.id===config?.snapshotId)
  const boundaries=sameSnapshot?config.boundaries:null
  try{return {...groupOdds(field,snapshot?.odds,threshold,boundaries),differentObservation:Boolean(config?.boundaries&&!sameSnapshot)}}
  catch{
    try{return {...groupOdds(field,snapshot?.odds,threshold),reset:true}}
    catch{return {membership:{},complete:false,manual:false,threshold,reset:true}}
  }
}
