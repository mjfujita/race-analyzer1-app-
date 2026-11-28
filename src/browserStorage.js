// Only this cloud-derived cache is disposable. Observations, odds, journals,
// registrations, preferences, device approvals and unsent records are not caches.
const CACHE_PREFIX='race-companion-cache:v1:'
export const RACE_CACHE_CHAR_BUDGET=512*1024
export const isStorageQuotaError=error=>error?.name==='QuotaExceededError'||error?.name==='NS_ERROR_DOM_QUOTA_REACHED'||error?.code===22||error?.code===1014

function cachedRaces(storage,userId,except){
  if(typeof userId!=='string'||!userId)return []
  const prefix=`${CACHE_PREFIX}${userId}:`,rows=[]
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i)
    if(typeof key!=='string'||key===except||!key.startsWith(prefix))continue
    const raw=storage.getItem(key)
    let fetchedAt=0
    try{fetchedAt=Date.parse(JSON.parse(raw)?.fetchedAt)||0}catch{/* Old cache copies are still safe to fetch again. */}
    rows.push({key,size:key.length+(raw?.length??0),fetchedAt})
  }
  return rows.sort((a,b)=>a.fetchedAt-b.fetchedAt||a.key.localeCompare(b.key))
}

/** Retry atomically failed writes after evicting only same-owner cloud copies. */
export function setBrowserValue(storage,key,value,userId,{cache=false}={}){
  const temporary=cache&&typeof userId==='string'&&key.startsWith(`${CACHE_PREFIX}${userId}:`)
  let candidates=null
  if(temporary){
    candidates=cachedRaces(storage,userId,key)
    let size=key.length+value.length+candidates.reduce((sum,row)=>sum+row.size,0)
    while(size>RACE_CACHE_CHAR_BUDGET&&candidates.length){
      const oldest=candidates.shift();storage.removeItem(oldest.key);size-=oldest.size
    }
  }
  try{storage.setItem(key,value);return}
  catch(error){if(!isStorageQuotaError(error))throw error}
  candidates??=cachedRaces(storage,userId,key)
  for(const row of candidates){
    storage.removeItem(row.key)
    try{storage.setItem(key,value);return}
    catch(error){if(!isStorageQuotaError(error))throw error}
  }
  throw Object.assign(new Error('ブラウザーの保存容量が不足しています。予想・グループ・購入記録は削除していません。今回の端末への保存は完了していません。'),{name:'StorageCapacityError',code:'browser_storage_full'})
}

// Odds keys contain a raw owner followed by the date and race ID.
export function oddsStorageOwner(key){
  const prefix='race-ability-odds:v1:'
  if(typeof key!=='string'||!key.startsWith(prefix))return null
  const tail=key.slice(prefix.length),race=tail.lastIndexOf(':'),date=tail.lastIndexOf(':',race-1)
  return date>0?tail.slice(0,date):null
}
