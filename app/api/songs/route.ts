import { NextRequest } from 'next/server'
import { SOURCES, type SourceDef } from '@/lib/sources'

export type Song = {
  id: number
  title: string
  artist: string
  album: string
  year?: number
  genre?: string
  length?: number
  cover?: string
  preview: string
  language?: 'fr' | 'en' | 'other'
  sourceId?: string
}

const GENRE_NAME_TO_ID: Record<string, number> = {
  rap: 116, // Hip-Hop/Rap
  pop: 132,
  electro: 106,
  rock: 152,
}

function mapDeezerGenreName(name?: string): string | undefined {
  if (!name) return undefined
  const g = name.toLowerCase()
  if (g.includes('hip') || g.includes('rap')) return 'rap'
  if (g.includes('pop')) return 'pop'
  if (g.includes('electro') || g.includes('dance') || g.includes('house')) return 'electro'
  if (g.includes('rock')) return 'rock'
  return name
}

function detectLanguage(title: string, artist: string): 'fr' | 'en' | 'other' {
  const frHints = [/l[aâ] /i, /le /i, /la /i, /les /i, /mon /i, /ma /i, /mes /i, /ne /i, /pas /i, /je /i, /tu /i, /toi/i, /moi/i, /avec/i, /sans/i]
  const lower = `${title} ${artist}`.toLowerCase()
  if (frHints.some(r => r.test(lower))) return 'fr'
  const enHints = [/ the /i, / you /i, / love /i, /i\s/i, / don\'t /i, / can\'t /i]
  if (enHints.some(r => r.test(lower))) return 'en'
  return 'other'
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const genreFilterParam = (searchParams.get('genre') as string | null) || 'all'
  const langFilterParam = (searchParams.get('lang') as 'fr' | 'en' | 'other' | 'all' | null) || 'all'

  // Aggregate from configured sources
  const agg = await fetchFromSources(SOURCES)
  const allSongs = dedupeById(agg.songs)

  // Compute dynamic filters from sources
  const availableGenres = Array.from(new Set(agg.genres)).sort()
  const availableLangs = Array.from(new Set(agg.langs)) as Array<'fr' | 'en' | 'other'>

  // Apply filters
  let filtered = allSongs.filter((s: Song) => (langFilterParam === 'all' ? true : s.language === langFilterParam))
  if (genreFilterParam !== 'all') {
    filtered = filtered.filter((s: Song) => s.genre?.toLowerCase() === genreFilterParam.toLowerCase())
  }

  // Fairly interleave songs across sources then cap
  const MAX = 200
  const buckets = new Map<string, Song[]>()
  for (const s of filtered) {
    const key = s.sourceId || 'unknown'
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key)!.push(s)
  }
  // optional: shuffle within each bucket for variety
  for (const arr of buckets.values()) shuffleInPlace(arr)
  const keys = Array.from(buckets.keys())
  const songs: Song[] = []
  while (songs.length < MAX && keys.some(k => (buckets.get(k)?.length || 0) > 0)) {
    for (const k of keys) {
      const arr = buckets.get(k)!
      const next = arr.shift()
      if (next) songs.push(next)
      if (songs.length >= MAX) break
    }
  }

  return new Response(JSON.stringify({ songs, filters: { genres: availableGenres, languages: availableLangs }, debug: { stats: agg.stats } }), { headers: { 'content-type': 'application/json' } })
}

async function fetchFromSources(sources: SourceDef[]): Promise<{ songs: Song[]; genres: string[]; langs: Array<'fr'|'en'|'other'>; stats: Array<{ id: string; genre: string; language: string; fetched: number; kept: number }> }> {
  const outSongs: Song[] = []
  const outGenres: string[] = []
  const outLangs: Array<'fr'|'en'|'other'> = []
  const stats: Array<{ id: string; genre: string; language: string; fetched: number; kept: number }> = []
  for (const src of sources) {
    try {
      const { tracks } = await resolveDeezerSource(src)
      const songs = await enrichTracks(tracks, src)
      outSongs.push(...songs)
      outGenres.push(src.genre)
      outLangs.push(src.language)
      stats.push({ id: src.id, genre: src.genre, language: src.language, fetched: tracks.length, kept: songs.length })
    } catch (e) {
      // ignore source errors to keep others working
    }
    // Gentle delay to mitigate Deezer rate limiting across sources
    await sleep(350)
  }
  return { songs: outSongs, genres: outGenres, langs: outLangs, stats }
}

async function enrichTracks(tracks: any[], src?: SourceDef): Promise<Song[]> {
  const songs: Song[] = tracks.map((t: any) => {
    const title: string = t?.title_short || t?.title
    const artist: string = t?.artist?.name
    const albumId: number | undefined = t?.album?.id
    const albumTitle: string = t?.album?.title
    const length: number | undefined = typeof t?.duration === 'number' ? t.duration : undefined
    const preview: string = t?.preview
    const cover: string | undefined = t?.album?.cover_medium || t?.album?.cover
    // No album detail enrichment here to avoid extra API calls/rate limits
    return {
      id: t?.id,
      title,
      artist,
      album: albumTitle,
      year: undefined,
      genre: src?.genre,
      length,
      preview,
      cover,
      language: src?.language || detectLanguage(title, artist),
      sourceId: src?.id
    }
  })
  .filter((s: Song) => Boolean(s.preview))

  return songs
}

function dedupeById(songs: Song[]): Song[] {
  const seen = new Set<number>()
  const res: Song[] = []
  for (const s of songs) {
    if (!seen.has(s.id)) {
      seen.add(s.id)
      res.push(s)
    }
  }
  return res
}

async function resolveDeezerSource(src: SourceDef): Promise<{ tracks: any[] }> {
  // Accept API URLs or web URLs and map to API endpoints
  let apiUrl = src.url
  const mEditorial = src.url.match(/editorial\/(\d+)\/charts/)
  const mPlaylist = src.url.match(/playlist\/(\d+)/)
  if (mEditorial) {
  apiUrl = `https://api.deezer.com/editorial/${mEditorial[1]}/charts?limit=${src.limit || 200}`
  const json = await fetchJsonRetry(apiUrl)
    return { tracks: json?.tracks?.data || [] }
  }
  if (mPlaylist) {
    const id = mPlaylist[1]
  const json = await fetchJsonRetry(`https://api.deezer.com/playlist/${id}`)
    let tracks: any[] = json?.tracks?.data || []
    // Try direct tracks endpoint first if embedded is empty
    if (!tracks || tracks.length === 0) {
      try {
    const j1 = await fetchJsonRetry(`https://api.deezer.com/playlist/${id}/tracks?limit=${src.limit || 200}`)
        tracks = j1?.data || []
      } catch {
        // ignore
      }
    }
    // Some playlists don’t embed tracks; use the tracklist endpoint
    if ((!tracks || tracks.length === 0) && json?.tracklist) {
      try {
        const tlUrl = json.tracklist.includes('limit=') ? json.tracklist : `${json.tracklist}?limit=${src.limit || 200}`
    const j2 = await fetchJsonRetry(tlUrl)
        tracks = j2?.data || []
      } catch {
        // ignore, keep empty
      }
    }
    return { tracks }
  }
  // Fallback: try as-is expecting a track list
  const json = await fetchJsonRetry(apiUrl)
  const tracks = json?.tracks?.data || json?.data || []
  return { tracks }
}

function shuffleInPlace<T>(arr: T[]) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function fetchJsonRetry(url: string, init?: RequestInit, tries = 3, backoffMs = 250): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', ...(init || {}) })
      if (res.ok) {
        return await res.json()
      }
      // Retry on 429 and 5xx
      if (res.status === 429 || res.status >= 500) {
        await sleep(backoffMs)
        backoffMs *= 2
        continue
      }
      // Non-retryable
      throw new Error(`HTTP ${res.status} for ${url}`)
    } catch (e) {
      lastErr = e
      await sleep(backoffMs)
      backoffMs *= 2
    }
  }
  throw lastErr || new Error(`Failed to fetch ${url}`)
}
