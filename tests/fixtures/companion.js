export function memoryStore() {
  const files = new Map()
  return {
    files,
    get: async path => files.has(path) ? structuredClone(files.get(path)) : null,
    putImmutable: async (path, value) => {
      if (files.has(path)) return { created: false, existing: structuredClone(files.get(path)) }
      files.set(path, structuredClone(value)); return { created: true }
    },
    list: async (prefix, { limit = 2000, order = 'asc', complete = false } = {}) => {
      const entries = new Map()
      for (const path of files.keys()) {
        if (!path.startsWith(`${prefix}/`)) continue
        const rest = path.slice(prefix.length + 1), name = rest.split('/')[0]
        entries.set(name, { name, path: `${prefix}/${name}`, folder: rest.includes('/') })
      }
      return [...entries.values()].sort((a, b) => order === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name)).slice(0, limit + (complete ? 1 : 0))
    },
  }
}

export async function request(handler, { method = 'GET', token = 'owner-token', body, query = {}, headers = {} } = {}) {
  const result = { status: null, body: null, headers: {} }
  const res = { setHeader: (key, value) => { result.headers[key] = value }, status: code => { result.status = code; return res }, json: value => { result.body = value; return res } }
  await handler({ method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'content-type': 'application/json', ...headers }, body, query }, res)
  return result
}
