import {createServer} from 'node:http'
import {networkInterfaces} from 'node:os'
import {readFile,readdir} from 'node:fs/promises'
import {resolve,relative,extname} from 'node:path'
import {fileURLToPath} from 'node:url'
import {build} from 'vite'
import config from '../vite.config.js'

const root=fileURLToPath(new URL('..',import.meta.url)),site=resolve(root,'.qa/phone-review/site')
const privateV4=ip=>/^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip)
const interfaces=networkInterfaces()
const addresses=[...(interfaces.en0??[]),...Object.values(interfaces).flat()].filter(row=>row?.family==='IPv4'&&!row.internal&&privateV4(row.address))
const host=addresses[0]?.address
if(!host)throw new Error('Wi-FiのローカルIPv4アドレスがありません。ネットワークへの接続を確認してください。')

await build({...config,configFile:false,root,mode:'phone-review',publicDir:false,
  build:{outDir:site,emptyOutDir:true,rolldownOptions:{input:resolve(root,'market-preview.html')}}})

// Serve only the isolated build. Source, .qa logs, env files and APIs are never mapped.
const files=new Map()
async function collect(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=resolve(directory,entry.name)
    if(entry.isDirectory())await collect(path)
    else if(entry.isFile())files.set('/'+relative(site,path).split('\\').join('/'),await readFile(path))
  }
}
await collect(site)
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm','.svg':'image/svg+xml'}
const server=createServer((req,res)=>{
  res.setHeader('Cache-Control','no-store')
  res.setHeader('X-Content-Type-Options','nosniff')
  res.setHeader('Referrer-Policy','no-referrer')
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{Allow:'GET, HEAD'});return res.end()}
  let path
  try{path=decodeURIComponent(new URL(req.url,'http://review.local').pathname)}catch{res.writeHead(400);return res.end()}
  if(path==='/')path='/market-preview.html'
  const content=files.get(path)
  if(!content){res.writeHead(404);return res.end()}
  res.writeHead(200,{'Content-Type':types[extname(path)]??'application/octet-stream'})
  res.end(req.method==='HEAD'?undefined:content)
})
server.on('error',error=>{console.error(error.code==='EADDRINUSE'?'ポート5174は使用中です。既存サーバーを確認してください。':error.message);process.exitCode=1})
server.listen(5174,host,()=>console.log(`\nスマホ確認用: http://${host}:5174/\n同じWi-Fiのスマホから開けます。架空データのみ。停止はCtrl+C。\nコード変更後はこのコマンドを再起動してください。`))
