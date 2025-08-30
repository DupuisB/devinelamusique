import { NextRequest } from 'next/server'
import { EN_PLAYLIST_URL, FR_PLAYLIST_URL, RAP_EN_PLAYLIST_URL, RAP_FR_PLAYLIST_URL, PLAYLIST_FETCH_LIMIT, START_DATE_UTC, RESET_OFFSET_HOURS } from '@/lib/config'
import { cachedFetch } from '@/lib/cache'
import { info, warn, error } from '@/lib/logger'

// Reset offset in hours (UTC+2) — now sourced from shared config

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
  albumId?: number
  artistId?: number
  genre?: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // day param is 1-based day count since START_DATE_UTC; default to today
  const todayN = dateToDayNumberUTC(new Date(), START_DATE_UTC)
  const nParam = Number(searchParams.get('n') || todayN)
  const n = Number.isFinite(nParam) && nParam > 0 ? Math.min(nParam, todayN) : todayN
  const langParam = (searchParams.get('lang') || 'fr').toLowerCase()
  const lang: 'fr' | 'en' | 'all' = langParam === 'en' ? 'en' : (langParam === 'all' ? 'all' : 'fr')
  const genreParam = (searchParams.get('genre') || 'all').toLowerCase()
  const genre: 'all' | 'rap' = genreParam === 'rap' ? 'rap' : 'all'

  // Fetch chosen playlist(s)
  let merged: Song[] = []
  try {
    const pick = async (which: 'fr' | 'en') => {
      if (which === 'fr') {
        const url = genre === 'rap' ? RAP_FR_PLAYLIST_URL : FR_PLAYLIST_URL
        return cachedFetch(`playlist:${genre}:fr`, 60 * 30, () => fetchPlaylist(url, 'fr', PLAYLIST_FETCH_LIMIT))
      } else {
        const url = genre === 'rap' ? RAP_EN_PLAYLIST_URL : EN_PLAYLIST_URL
        return cachedFetch(`playlist:${genre}:en`, 60 * 30, () => fetchPlaylist(url, 'en', PLAYLIST_FETCH_LIMIT))
      }
    }

    if (lang === 'fr') {
      merged = await pick('fr')
    } else if (lang === 'en') {
      merged = await pick('en')
    } else {
      const [fr, en] = await Promise.all([pick('fr'), pick('en')])
      merged = dedupeById([...fr, ...en])
    }
  } catch (e) {
    error('failed to fetch playlists', e)
    merged = []
  }

  if (merged.length === 0) {
    return json({ error: 'No tracks available' }, 500)
  }
  // i-th day gets i-th track (wrap if beyond length)
  const idx = ((n - 1) % merged.length + merged.length) % merged.length
  const song = merged[idx]
  // Enrich selected song with genre and fallback year when possible (single extra API calls only for chosen track)
  if (song) {
    try {
      if (song.albumId) {
        try {
          const albumJson = await cachedFetch(`album:${song.albumId}`, 60 * 60, () => fetchJsonRetry(`https://api.deezer.com/album/${song.albumId}`))
          if (!song.year && albumJson?.release_date) {
            const y = Number(String(albumJson.release_date).slice(0, 4))
            if (Number.isFinite(y)) song.year = y
          }
          const gid = albumJson?.genre_id
          if (gid) {
            try {
              const gjson = await cachedFetch(`genre:${gid}`, 60 * 60 * 24, () => fetchJsonRetry(`https://api.deezer.com/genre/${gid}`))
              if (gjson?.name) song.genre = gjson.name
            } catch {
              // ignore genre lookup errors
            }
          }
        } catch {
          warn(`album fetch failed for ${song.albumId}`)
        }
      }
      if (!song.genre && song.artistId) {
        try {
          const artistJson = await cachedFetch(`artist:${song.artistId}`, 60 * 60 * 6, () => fetchJsonRetry(`https://api.deezer.com/artist/${song.artistId}`))
          const gname = artistJson?.genres?.data?.[0]?.name
          if (gname) song.genre = gname
        } catch {
          warn(`artist fetch failed for ${song.artistId}`)
        }
      }
    } catch {
      // defensive
    }
  }

  const dateStr = formatDateUTCPlusOffset(dayNumberToDateUTC(n, START_DATE_UTC))
  return json({ song, n, date: dateStr, lang: lang === 'all' ? song.language : lang, genre })
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
      year: (() => {
        const rd = t?.album?.release_date || t?.release_date || ''
        const y = typeof rd === 'string' && rd.length >= 4 ? Number(rd.slice(0, 4)) : undefined
        return Number.isFinite(y) ? y : undefined
      })(),
      length: typeof t?.duration === 'number' ? t.duration : undefined,
      cover: t?.album?.cover_medium || t?.album?.cover,
      preview: t?.preview,
      language,
      albumId: t?.album?.id,
      artistId: t?.artist?.id,
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
