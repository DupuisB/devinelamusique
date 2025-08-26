type CacheEntry = { ts: number; value: any }

const cache = new Map<string, CacheEntry>()

export function cacheSet(key: string, value: any) {
  cache.set(key, { ts: Date.now(), value })
}

export function cacheGet(key: string, maxAgeSeconds?: number) {
  const e = cache.get(key)
  if (!e) return undefined
  if (typeof maxAgeSeconds === 'number') {
    if (Date.now() - e.ts > maxAgeSeconds * 1000) {
      cache.delete(key)
      return undefined
    }
  }
  return e.value
}

export async function cachedFetch<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
  const existing = cacheGet(key, ttlSeconds)
  if (typeof existing !== 'undefined') return existing as T
  const val = await loader()
  cacheSet(key, val)
  return val
}

export function cacheClear() { cache.clear() }
