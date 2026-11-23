const pct=n=>`${(n*100).toFixed(1)}%`

export default function AceHorseAssessment({assessment,paddockInfo}){
  if(!assessment)return null
  const a=assessment
  return <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50/60 p-4 min-w-0" aria-label={`${a.no}番のACE予想`}>
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold text-[#0B2545]">ACEの今回予想</h3><span className="rca-pill">{a.role}</span></div>
    <p className="text-sm leading-relaxed mt-3">{a.conclusion}</p>
    {a.probabilities&&<><dl className="grid grid-cols-2 gap-2 mt-3 text-sm">{[['推定勝率',a.probabilities.win],['推定3着内率',a.probabilities.top3],['推定2着率',a.probabilities.second],['推定3着率',a.probabilities.third]].map(([label,n])=><div className="rounded-lg bg-white/80 p-2" key={label}><dt className="text-xs text-slate-500">{label}</dt><dd className="font-bold mt-1">{pct(n)}</dd></div>)}</dl><p className="rca-muted mt-2">勝率・回収率は研究用の試算です。2・3着率は着順モデルによる未校正の参考値です。{a.expectedReturn!==null?`単勝期待回収率の試算 ${pct(a.expectedReturn)}。`:''}</p></>}
    <div className="mt-3 space-y-3 text-sm"><div><h4 className="font-semibold">プラス材料</h4>{a.supports.length?<ul className="mt-1 list-disc pl-5 space-y-1">{a.supports.map(text=><li key={text}>{text}</li>)}</ul>:<p className="rca-muted mt-1">積極的な評価を裏付ける材料は不足しています。</p>}</div>
      <div><h4 className="font-semibold">懸念・確認したい点</h4>{a.concerns.length?<ul className="mt-1 list-disc pl-5 space-y-1">{a.concerns.map(text=><li key={text}>{text}</li>)}</ul>:<p className="rca-muted mt-1">確認できた範囲で追加の懸念は抽出されていません。好走の保証ではありません。</p>}</div></div>
    {paddockInfo?.lateFields.length>0&&<p className="rca-notice mt-3 text-xs">取得状態：{paddockInfo.lateFields.join('・')}は{paddockInfo.reason}に取得済みです。ACEの事前予想には使用していません。下の「パドック・直前情報」で参考情報を確認できます。</p>}
    {paddockInfo?.latestCommentStatus&&<p className="rca-muted mt-3">最新のコメント確認：{paddockInfo.latestCommentStatus}</p>}
    <details className="mt-3"><summary className="text-sm font-semibold text-sky-800 cursor-pointer">精査した材料（確認 {a.knownCount}/{a.factors.length}項目）</summary><p className="rca-muted mt-2">項目数は情報の揃い具合で、評価の信頼度ではありません。</p><dl className="mt-2 space-y-3">{a.factors.map(f=><div key={f.key}><dt className="text-sm font-semibold">{f.label} · {f.known?'取得材料あり':'比較材料不足'}</dt><dd className="text-xs leading-relaxed text-slate-600 mt-1 whitespace-pre-wrap break-words">{f.text}</dd></div>)}</dl></details>
  </section>
}
