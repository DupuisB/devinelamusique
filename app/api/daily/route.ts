import { NextRequest } from 'next/server'
import { EN_PLAYLIST_URL, FR_PLAYLIST_URL, PLAYLIST_FETCH_LIMIT, START_DATE_UTC } from '@/lib/config'

// Reset offset in hours (UTC+2)
const RESET_OFFSET_HOURS = 2

export type Song = {
  id: number
  title: string
  artist: string
  album: string
  year?: number
  length?: number
  cover?: string
  preview: string
  language?: 'fr' | 'en'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // day param is 1-based day count since START_DATE_UTC; default to today
  const todayN = dateToDayNumberUTC(new Date(), START_DATE_UTC)
  const nParam = Number(searchParams.get('n') || todayN)
  const n = Number.isFinite(nParam) && nParam > 0 ? Math.min(nParam, todayN) : todayN
  const langParam = (searchParams.get('lang') || 'fr').toLowerCase()
  const lang: 'fr' | 'en' | 'all' = langParam === 'en' ? 'en' : (langParam === 'all' ? 'all' : 'fr')

  // Fetch chosen playlist(s)
  let merged: Song[] = []
  if (lang === 'fr') {
    merged = await fetchPlaylist(FR_PLAYLIST_URL, 'fr', PLAYLIST_FETCH_LIMIT)
  } else if (lang === 'en') {
    merged = await fetchPlaylist(EN_PLAYLIST_URL, 'en', PLAYLIST_FETCH_LIMIT)
  } else {
    const [fr, en] = await Promise.all([
      fetchPlaylist(FR_PLAYLIST_URL, 'fr', PLAYLIST_FETCH_LIMIT),
      fetchPlaylist(EN_PLAYLIST_URL, 'en', PLAYLIST_FETCH_LIMIT),
    ])
    // Keep playlist order stable: FR playlist tracks then EN playlist tracks
    merged = dedupeById([...fr, ...en])
  }

  if (merged.length === 0) {
    return json({ error: 'No tracks available' }, 500)
  }
  // i-th day gets i-th track (wrap if beyond length)
  const idx = ((n - 1) % merged.length + merged.length) % merged.length
  const song = merged[idx]
  const dateStr = formatDateUTCPlusOffset(dayNumberToDateUTC(n, START_DATE_UTC))
  return json({ song, n, date: dateStr, lang: lang === 'all' ? song.language : lang })
}

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })
}

async function fetchPlaylist(url: string, language: 'fr' | 'en', limit = 300): Promise<Song[]> {
  const idMatch = url.match(/playlist\/(\d+)/)
  const id = idMatch?.[1]
  if (!id) return []
  const apiUrl = `https://api.deezer.com/playlist/${id}`
  const j = await fetchJsonRetry(apiUrl)
  let tracks: any[] = j?.tracks?.data || []
  if ((!tracks || tracks.length === 0) && j?.tracklist) {
    // fall back to tracklist endpoint with limit
    try {
      const tlUrl = j.tracklist.includes('limit=') ? j.tracklist : `${j.tracklist}?limit=${limit}`
      const j2 = await fetchJsonRetry(tlUrl)
      tracks = j2?.data || []
    } catch {}
  }
  // Deezer returns playlist tracks in playlist order; do not sort.
  return tracks.map((t: any) => {
    const s: Song = {
      id: t?.id,
      title: t?.title_short || t?.title,
      artist: t?.artist?.name,
      album: t?.album?.title,
      year: undefined,
      length: typeof t?.duration === 'number' ? t.duration : undefined,
      cover: t?.album?.cover_medium || t?.album?.cover,
      preview: t?.preview,
      language,
    }
    return s
  }).filter((s: Song) => Boolean(s.preview))
}

function dedupeById<T extends { id: number }>(arr: T[]): T[] {
  const seen = new Set<number>()
  const out: T[] = []
  for (const item of arr) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

function startOfDayWithOffset(d: Date, offsetHours = RESET_OFFSET_HOURS) {
  const offsetMs = offsetHours * 3600000
  const shifted = new Date(d.getTime() + offsetMs)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  const ms = Date.UTC(y, m, day) - offsetMs
  return new Date(ms)
}

function parseStartDateUTC(s: string): Date {
  return new Date(s + 'T00:00:00Z')
}

function dateToDayNumberUTC(d: Date, originISO: string): number {
  const origin = startOfDayWithOffset(parseStartDateUTC(originISO))
  const day = startOfDayWithOffset(d)
  const ms = day.getTime() - origin.getTime()
  return Math.floor(ms / 86400000) + 1
}

function dayNumberToDateUTC(n: number, originISO: string): Date {
  const origin = startOfDayWithOffset(parseStartDateUTC(originISO))
  const ms = (n - 1) * 86400000
  return new Date(origin.getTime() + ms)
}

function formatDateUTCPlusOffset(d: Date, offsetHours = RESET_OFFSET_HOURS) {
  // Return YYYY-MM-DD for the date in the target timezone (UTC+offset)
  const shifted = new Date(d.getTime() + offsetHours * 3600000)
  return shifted.toISOString().slice(0, 10)
}

async function fetchJsonRetry(url: string, init?: RequestInit, tries = 3, backoffMs = 250): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', ...(init || {}) })
      if (res.ok) return await res.json()
      if (res.status === 429 || res.status >= 500) {
        await sleep(backoffMs)
        backoffMs *= 2
        continue
      }
      throw new Error(`HTTP ${res.status} for ${url}`)
    } catch (e) {
      lastErr = e
      await sleep(backoffMs)
      backoffMs *= 2
    }
  }
  throw lastErr || new Error(`Failed to fetch ${url}`)
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }
