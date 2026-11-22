import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { deviceRequest,refreshDeviceSession } from './deviceAuth.js'
import { formatRaceTime } from './raceTime.js'

const suggestedLabel = () => /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'スマートフォン' : 'PC'
const control='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm max-w-full'

export default function DeviceManager() {
  const [devices,setDevices]=useState([]),[currentId,setCurrentId]=useState(null)
  const [label,setLabel]=useState(suggestedLabel),[pair,setPair]=useState(null),[qr,setQr]=useState('')
  const [error,setError]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false)
  const [confirmId,setConfirmId]=useState(null)
  async function load() {
    const d=await deviceRequest('list');setDevices(d.devices);setCurrentId(d.currentId)
  }
  useEffect(() => { let active=true; deviceRequest('list').then(d => { if(active){setDevices(d.devices);setCurrentId(d.currentId)} }).catch(e => { if(active)setError(e.message) });return () => {active=false} },[])
  useEffect(() => {
    if (!pair) return
    const remaining=Date.parse(pair.expiresAt)-Date.now()
    if (remaining<=0) {setPair(null);setQr('');return}
    const timer=setTimeout(() => {setPair(null);setQr('');setMessage('QRコードの期限が切れました。必要なら新しく発行してください。')},remaining)
    return () => clearTimeout(timer)
  },[pair])
  async function act(work) {
    if(busy)return
    setBusy(true);setError('');setMessage('')
    try {await work()} catch(e){setError(e.message)} finally{setBusy(false)}
  }
  return <div className="rca-stack rca-devices"><div className="rca-page-title"><div><h1>端末認証</h1><p>承認したPC・スマートフォンから、ログイン入力なしで利用します。</p></div><button className="rca-secondary" disabled={busy} onClick={() => act(load)}>端末一覧を更新</button></div>
    {error && <p role="alert" className="rca-error">{error}</p>}{message && <p role="status" className="rca-notice">{message}</p>}
    <section className="rca-panel"><h2>この端末</h2><p className="rca-muted">承認情報はこのブラウザに保存されます。Cookieを削除した場合や別のブラウザでは、再承認が必要です。</p>
      {currentId ? <p className="rca-notice">この端末は承認済みです。次回から同じURLを開くだけで利用できます。</p> : <><label className="block my-4">端末の名前<input className={`${control} ml-3`} maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} /></label><button className="rca-primary" disabled={busy || !label.trim()} onClick={() => act(async () => {
        await deviceRequest('register',{label});await refreshDeviceSession();await load();setMessage('この端末を承認しました。ログイン入力は不要です。')
      })}>{busy ? '登録中…' : 'この端末を承認する'}</button></>}
    </section>
    <section className="rca-panel"><h2>スマートフォンを追加</h2><p className="rca-muted">PCでQRコードを表示し、ご自分のスマホのカメラで読み取って「この端末を登録」を押してください。発行から10分間・１回限りです。</p>
      <button className="rca-primary my-4" disabled={busy || !currentId} onClick={() => act(async () => {
        const p=await deviceRequest('pair',{label:'スマートフォン'})
        const url=`${location.origin}/#device-pair=${p.code}`
        const image=await QRCode.toDataURL(url,{width:280,margin:2,errorCorrectionLevel:'M'})
        setPair({...p,url});setQr(image)
      })}>スマホ登録用QRコードを発行</button>
      {!currentId && <p className="rca-muted">先に上のボタンで、このPCを承認してください。</p>}
      {pair && <div className="rca-device-pair"><img src={qr} width="280" height="280" alt="本人のスマートフォンを登録する１回限りのQRコード" /><p>有効期限：{formatRaceTime(pair.expiresAt)}</p><p className="rca-muted">このQRコードは本人のスマホだけで読み取ってください。</p><button className="rca-secondary" onClick={() => act(async () => {await navigator.clipboard.writeText(pair.url);setMessage('登録リンクをコピーしました。ご自分のスマホだけに渡してください。')})}>登録リンクをコピー</button></div>}
    </section>
    <section className="rca-panel"><h2>承認済み端末</h2>{!devices.length && <p className="rca-muted">登録された端末はありません。</p>}
      <div className="rca-device-list">{devices.map(d => <article key={d.id}><div><strong>{d.label}{d.current ? '（この端末）' : ''}</strong><p className="rca-muted">登録 {formatRaceTime(d.createdAt)} ／ 期限 {formatRaceTime(d.expiresAt)}</p><p>{d.revoked ? '解除済み' : Date.parse(d.expiresAt)<Date.now() ? '期限切れ' : '承認中'}</p></div>{!d.revoked && <div>{confirmId===d.id ? <><p>この端末のアクセスを解除します。予想・購入記録は残ります。</p><button className="rca-secondary" disabled={busy} onClick={() => act(async () => {const result=await deviceRequest('revoke',{deviceId:d.id});setConfirmId(null);await load();if(result.current)await refreshDeviceSession();setMessage('端末の承認を解除しました。')})}>解除を確定</button><button className="rca-secondary ml-2" onClick={()=>setConfirmId(null)}>戻る</button></> : <button className="rca-secondary" onClick={()=>setConfirmId(d.id)}>この端末を解除</button>}</div>}</article>)}</div>
    </section>
  </div>
}

export function DeviceGate({ recovery }) {
  const [code]=useState(() => {
    const params=new URLSearchParams(location.hash.slice(1)),value=params.get('device-pair')
    return /^[A-Za-z0-9_-]{43}$/.test(value ?? '') ? value : null
  })
  useEffect(()=>{if(code)history.replaceState(null,'',location.pathname+location.search)},[code])
  const [label,setLabel]=useState(suggestedLabel),[busy,setBusy]=useState(false),[error,setError]=useState(''),[recover,setRecover]=useState(false)
  return <main className="rca-device-gate"><section className="rca-panel"><p className="rca-muted">Race Condition Analyzer · 本人の端末専用</p><h1>{code ? 'この端末を登録' : 'この端末は未承認です'}</h1>
    {code ? <><p>PCで発行したQRコードから、本人のスマートフォンを登録します。</p><label className="block my-5">端末の名前<input className={`${control} block mt-2 w-full`} maxLength={80} value={label} onChange={e=>setLabel(e.target.value)} /></label><button className="rca-primary" disabled={busy || !label.trim()} onClick={async () => {
      setBusy(true);setError('');try {await deviceRequest('claim',{code,label});await refreshDeviceSession()}catch(e){setError(e.message)}finally{setBusy(false)}
    }}>{busy ? '登録中…' : 'この端末を登録'}</button></> : <p>承認済みPCの「端末認証」からQRコードを発行し、この端末で読み取ってください。</p>}
    {error && <p role="alert" className="rca-error mt-4">{error}</p>}
    <p className="rca-muted mt-5">データは公開されません。登録後は同じブラウザでURLを開くだけで使えます。</p>
    <button className="rca-secondary mt-5" aria-expanded={recover} onClick={()=>setRecover(!recover)}>本人確認による復旧</button>
    {recover && recovery}
  </section></main>
}
