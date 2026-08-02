// auth_admin.js — ログイン用アカウントの確認 / パスワードリセット（個人利用・本人用）
//
// .env.local の SUPABASE_PROJECT_URL / SUPABASE_SERVICE_ROLE_KEY を使う。
// パスワードは Supabase 側でハッシュ化されており復元不可。できるのは確認とリセットのみ。
//
// 使い方:
//   node scripts/auth_admin.js list                         # 登録メール一覧を表示
//   node scripts/auth_admin.js reset <email> <newpassword>  # パスワードを新しい値に変更
//
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import WebSocket from 'ws'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = {}
for (const line of readFileSync(resolve(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const t = line.trim()
  if (!t || t.startsWith('#')) continue
  const i = t.indexOf('=')
  if (i > 0) env[t.slice(0, i).trim()] = t.slice(i + 1).trim()
}

const sb = createClient(env.SUPABASE_PROJECT_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: WebSocket },
})

const [cmd, arg1, arg2] = process.argv.slice(2)

async function list() {
  const { data, error } = await sb.auth.admin.listUsers()
  if (error) throw error
  console.log(`登録ユーザー数: ${data.users.length}`)
  for (const u of data.users) {
    console.log(`  email=${u.email} | 確認済=${!!u.email_confirmed_at} | 最終ログイン=${u.last_sign_in_at || 'なし'} | 作成=${(u.created_at || '').slice(0, 10)}`)
  }
}

async function reset(email, newPassword) {
  if (!email || !newPassword) {
    console.error('使い方: node scripts/auth_admin.js reset <email> <newpassword>')
    process.exit(1)
  }
  const { data, error } = await sb.auth.admin.listUsers()
  if (error) throw error
  const u = data.users.find((x) => (x.email || '').toLowerCase() === email.toLowerCase())
  if (!u) {
    console.error(`❌ ${email} は登録されていません。list で確認してください。`)
    process.exit(1)
  }
  const { error: uErr } = await sb.auth.admin.updateUserById(u.id, {
    password: newPassword,
    email_confirm: true,
  })
  if (uErr) throw uErr
  console.log(`✅ ${email} のパスワードを更新しました。新しいパスワードでログインできます。`)
}

try {
  if (cmd === 'reset') await reset(arg1, arg2)
  else await list()
} catch (e) {
  console.error('ERROR:', e.message || e)
  process.exit(1)
}
