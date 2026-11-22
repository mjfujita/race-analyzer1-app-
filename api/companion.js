import { appRuntime,runtimeFailure } from '../server/appRuntime.js'
export default async function handler(req,res) {
  try { return await appRuntime().companion(req,res) } catch { return runtimeFailure(res) }
}
