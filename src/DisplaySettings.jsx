import { useState } from 'react'
import { readSettings, saveSettings } from './workspaceSettings.js'

export default function DisplaySettings({ userId, onSaved, onOpenCapture }) {
  const [initial] = useState(() => readSettings(userId))
  const [threshold, setThreshold] = useState(String(initial.value.minTop3))
  const [stress, setStress] = useState(String(initial.value.stress))
  const [error, setError] = useState(initial.error)
  const [message, setMessage] = useState('')
  return <form className="rca-columns" onSubmit={event => {
    event.preventDefault(); setMessage('')
    try {
      const value = saveSettings(userId, { minTop3: threshold === '' ? NaN : Number(threshold), stress: stress === '' ? NaN : Number(stress) })
      onSaved?.(value); setError(''); setMessage('このブラウザの表示条件を保存しました。次に開く未保存のレースに適用し、保存済みの予想は変更しません。')
    } catch (problem) { setError(problem.message) }
  }}><div className="rca-stack">
    <section className="rca-panel"><h2>軸候補の表示条件</h2><p className="rca-muted">モデルの学習とは分けて、候補を表示する条件を設定します。</p><dl className="rca-details"><div><dt>提示する候補</dt><dd>最大2頭</dd></div><div><dt>自分で選ぶ軸馬</dt><dd>1頭</dd></div></dl>
      <label className="rca-setting">推定3着内率の下限（%）<input type="number" min="0" max="100" step="any" value={threshold} onChange={event => setThreshold(event.target.value)} /></label>
      <label className="rca-setting">オッズ下落の想定（%）<input type="number" min="0" max="80" step="any" value={stress} onChange={event => setStress(event.target.value)} /></label>
      <p className="rca-muted">下落想定後の単勝または複勝期待回収率が100%を超える馬を候補にします。複勝価格がなければ複勝期待回収率は未算出です。</p>
      {error && <p role="alert" className="rca-error">{error}</p>}{message && <p role="status" className="rca-notice">{message}</p>}<button type="submit" className="rca-primary">変更を保存</button>
    </section>
    <section className="rca-panel"><h2>表示と記録</h2><dl className="rca-details">{[['時刻の表示','日本時間 / Asia/Tokyo'],['買い方・相手・金額','自分で決定'],['実購入の収支','購入記録と正式払戻から計算'],['保存済み予想','元記録を維持し、訂正履歴を追加']].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></section>
    <section className="rca-panel"><h2>AIによる予想の読み方</h2><p>推定勝率・推定3着内率と、取得した価格での期待回収率を比較します。軸にするか、見送るかは自分で決めます。</p><details><summary>推定値と実績の違い</summary><p className="rca-muted">期待回収率は確率とオッズの積によるモデル試算です。3着内率は未校正の参考値で、実回収率とは別です。人気上昇は、的中や利益を保証する材料ではありません。</p></details></section>
  </div><aside className="rca-stack"><section className="rca-panel"><h2>固定する検証ルール</h2><dl className="rca-details">{[['予想の締切','発走10分前'],['取得・受信時刻の確認','必須'],['未来情報の除外','常時有効'],['性能悪化時の採用停止','常時有効']].map(([k,v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl><p className="rca-muted">締切後の試算は参考記録とし、締切前の予想実績へ混ぜません。</p></section><section className="rca-panel"><h2>取得と復旧</h2><p className="rca-muted">PACI取込、取得エラー、バックアップは取得状況から確認できます。</p><button type="button" className="rca-secondary" onClick={onOpenCapture}>取得状況を開く</button></section></aside></form>
}
