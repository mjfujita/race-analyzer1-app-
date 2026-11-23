import {useEffect,useMemo,useState} from 'react'
import {readCloudRace,loadRuntimeModel} from './cloudStore.js'
import {loadModel} from './modelStore.js'
import {readOddsEvents,oddsStorageKey} from './oddsHistory.js'
import {buildAceAssessment} from './aceAssessment.js'

function readInputs(userId,race){
  try{return {cloud:readCloudRace(userId,race),events:readOddsEvents(oddsStorageKey(userId,race)),model:loadModel(userId),runtimeModels:loadRuntimeModel(userId)}}
  catch(problem){return {error:problem instanceof SyntaxError?'オッズの保存形式を読み取れません。既存記録は上書きしていません。':problem.message}}
}

/** A single read-only calculation path for group summaries and full horse details. */
export function useAceAssessment({userId,race,horses,statistics,asOf,cloudRevision,review,enabled=true}){
  const [inputs,setInputs]=useState(()=>readInputs(userId,race))
  useEffect(()=>{setInputs(readInputs(userId,race))},[userId,race,cloudRevision])
  return useMemo(()=>{
    if(!enabled)return {rows:[],boundary:null}
    try{if(inputs.error)throw new Error(inputs.error);return buildAceAssessment({race,horses,statistics,...inputs,review,asOf})}
    catch(problem){return {rows:[],summary:'ACEの今回予想を表示できません。保存データを確認してください。',error:problem.message}}
  },[enabled,race,horses,statistics,asOf,inputs,review])
}
