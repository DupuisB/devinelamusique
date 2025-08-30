type CacheEntry = { ts: number; value: any }

const cache = new Map<string, CacheEntry>()
const persistentKeys = new Set<string>() // Tracks keys for the last 3 days

export function cacheSet(key: string, value: any, isPersistent = false) {
  cache.set(key, { ts: Date.now(), value })
  if (isPersistent) {
    persistentKeys.add(key)
  }
}

export function cacheGet(key: string, maxAgeSeconds?: number) {
  const e = cache.get(key)
  if (!e) return undefined
  if (typeof maxAgeSeconds === 'number' && !persistentKeys.has(key)) {
    if (Date.now() - e.ts > maxAgeSeconds * 1000) {
      cache.delete(key)
      return undefined
    }
  }
  return e.value
}

export async function cachedFetch<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  isPersistent = false
): Promise<T> {
  const existing = cacheGet(key, ttlSeconds)
  if (typeof existing !== 'undefined') return existing as T
  const val = await loader()
  cacheSet(key, val, isPersistent)
  return val
}

export function cacheClear() {
  // Clear only non-persistent keys
  for (const key of cache.keys()) {
    if (!persistentKeys.has(key)) {
      cache.delete(key)
    }
  }
}

export function updatePersistentKeys(dayKeys: string[]) {
  // Update persistent keys for the last 3 days
  persistentKeys.clear()
  dayKeys.forEach((key) => persistentKeys.add(key))
}