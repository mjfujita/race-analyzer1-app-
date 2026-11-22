import test from 'node:test'
import assert from 'node:assert/strict'
import { createDeviceAuth,createDeviceHandler,checkDeviceOrigin,DEVICE_COOKIE } from '../server/deviceAuth.js'
import { createCompanionHandler } from '../server/companion.js'
import { memoryStore,request } from './fixtures/companion.js'

const origin='https://app.example.test'
const csrf={ origin,host:'app.example.test','x-race-device':'1' }
function setup() {
  let clock=Date.parse('2026-11-23T01:00:00Z')
  const store=memoryStore(),authenticateAccount=async token => token==='owner-token' ? {id:'owner',email:'owner@example.invalid'} : token==='other-token' ? {id:'other'} : null
  const auth=createDeviceAuth({store,ownerId:'owner',authenticateAccount,now:()=>clock})
  const handler=createDeviceHandler({auth,createDbUrl:async()=> 'https://storage.example.test/short-lived-signed-url'})
  const call=(body=null,headers={},token=null) => request(handler,{method:body?'POST':'GET',token,body,headers:{...csrf,...headers}})
  return {store,auth,handler,call,setClock:value=>{clock=value},clock}
}
const setCookie = response => response.headers['Set-Cookie'].split(';')[0]

test('initial registration requires the owner, issues a private cookie, and stores no raw token',async()=>{
  const {call,store}=setup()
  assert.equal((await call({action:'register',label:'PC'})).status,401)
  assert.equal((await call({action:'register'}, {},'other-token')).status,403)
  const issued=await call({action:'register',label:'PC'}, {},'owner-token')
  assert.equal(issued.status,200)
  assert.match(issued.headers['Set-Cookie'],/^__Host-race_device=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=15552000$/)
  const raw=setCookie(issued).split('=')[1]
  assert.equal(JSON.stringify([...store.files.values()]).includes(raw),false)
  assert.equal(JSON.stringify(issued.body).includes(raw),false)
  const session=await call(null,{cookie:setCookie(issued)})
  assert.equal(session.body.session.user.id,'owner')
  assert.equal(session.body.session.device.label,'PC')
  assert.deepEqual((await call()).body,{session:null})
})

test('single-use phone QR cannot be replayed or claimed by two browsers simultaneously',async()=>{
  const {call,store}=setup()
  const pc=await call({action:'register',label:'PC'}, {},'owner-token'),cookie=setCookie(pc)
  const pairing=await call({action:'pair',label:'スマホ'},{cookie})
  assert.equal(pairing.status,200)
  assert.equal(pairing.body.code.length,43)
  const [one,two]=await Promise.all([call({action:'claim',code:pairing.body.code,label:'phone'}),call({action:'claim',code:pairing.body.code,label:'phone'})])
  assert.deepEqual([one.status,two.status].sort(),[200,409])
  const phone=one.status===200?one:two
  assert.equal((await call(null,{cookie:setCookie(phone)})).body.session.user.id,'owner')
  assert.equal((await call({action:'claim',code:pairing.body.code})).status,409)
  assert.equal(JSON.stringify([...store.files.values()]).includes(pairing.body.code),false)
  assert.equal((await call({action:'list'},{cookie})).body.devices.length,2)
})

test('expired QR, revoked issuer and expired device cannot grant access; revoke retains data',async()=>{
  const {call,store,setClock,clock}=setup()
  const pc=await call({action:'register',label:'PC'}, {},'owner-token'),cookie=setCookie(pc)
  const pairing=await call({action:'pair'},{cookie})
  setClock(clock+10*60000+1)
  assert.equal((await call({action:'claim',code:pairing.body.code})).status,410)
  setClock(clock)
  const second=await call({action:'pair'},{cookie})
  const before=store.files.size
  assert.equal((await call({action:'revoke',deviceId:pc.body.device.id},{cookie})).status,200)
  assert.ok(store.files.size>before)
  assert.equal((await call({action:'claim',code:second.body.code})).status,410)
  assert.equal((await call(null,{cookie})).body.session,null)
  const next=await call({action:'register',label:'PC replacement'}, {},'owner-token')
  setClock(clock+181*86400000)
  assert.equal((await call(null,{cookie:setCookie(next)})).body.session,null)
})

test('same-origin and JSON checks guard all device writes and cookie-authenticated application writes',async()=>{
  const {call,auth}=setup()
  assert.equal((await call({action:'register'}, {'x-race-device':undefined},'owner-token')).status,403)
  assert.equal((await call({action:'register'}, {origin:'https://evil.example'},'owner-token')).status,403)
  assert.equal((await call({action:'register'}, {origin:undefined},'owner-token')).status,403)
  assert.equal((await call({action:'register'}, {'content-type':'text/plain'},'owner-token')).status,415)
  const pc=await call({action:'register',label:'PC'}, {},'owner-token'),cookie=setCookie(pc)
  const companion=createCompanionHandler({service:{getDashboard:async()=>({private:true}),requestCapture:async()=>({ok:true})},ownerId:'owner',
    authenticateUser:async()=>null,authenticateDevice:async req=>(await auth.authenticateDevice(req))?.user,checkDeviceWrite:checkDeviceOrigin})
  const invoke=(method,body,headers) => request(companion,{method,token:null,body,query:{dashboard:'1'},headers})
  assert.equal((await invoke('GET',null,{})).status,401)
  assert.equal((await invoke('GET',null,{cookie})).body.private,true)
  assert.equal((await invoke('POST',{action:'request-capture',raceId:'R',raceDate:'20261123'},{cookie})).status,403)
  assert.equal((await invoke('POST',{action:'request-capture',raceId:'R',raceDate:'20261123'},{cookie,...csrf})).status,200)
})

test('private DB URL is fixed to the approved endpoint; malformed and duplicate cookies fail closed',async()=>{
  const {call,handler}=setup()
  assert.equal((await request(handler,{token:null,query:{resource:'race-db'}})).status,401)
  const pc=await call({action:'register',label:'PC'}, {},'owner-token'),cookie=setCookie(pc)
  assert.equal((await request(handler,{token:null,query:{resource:'race-db'},headers:{cookie}})).status,200)
  assert.equal((await request(handler,{token:null,query:{resource:'race-db',path:'another-secret'},headers:{cookie}})).status,400)
  assert.equal((await call(null,{cookie:`${cookie}; ${cookie}`})).body.session,null)
  assert.equal((await call(null,{cookie:`${DEVICE_COOKIE}=not-real`})).body.session,null)
  assert.equal((await call({action:'claim',code:'1234'})).status,400)
})

test('invalid expiry and oversized parsed bodies fail closed without consuming a valid QR',async()=>{
  const {call,store}=setup()
  const pc=await call({action:'register'}, {},'owner-token'),cookie=setCookie(pc)
  const paired=await call({action:'pair'},{cookie})
  const path=[...store.files.keys()].find(p=>p.includes('/pairings/'))
  store.files.get(path).expiresAt='not-a-date'
  assert.equal((await call({action:'claim',code:paired.body.code})).status,410)
  assert.equal((await call({action:'claim',code:'a'.repeat(5000)})).status,413)
  assert.equal([...store.files.keys()].filter(p=>p.includes('/claims/')).length,0)
})
