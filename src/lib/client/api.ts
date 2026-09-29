export type ApiError = Error & { status?: number }

export const api = async <T>(path: string, init: { method?: string; body?: unknown } = {}, f: typeof fetch = fetch): Promise<T> => {
  const res = await f(`/api${path}`, {
    method: init.method,
    headers: { 'content-type': 'application/json' },
    body: init.body ? JSON.stringify(init.body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'algo deu errado'), { status: res.status }) as ApiError
  return data as T
}
