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
  let songs = allSongs.filter((s: Song) => (langFilterParam === 'all' ? true : s.language === langFilterParam))
  if (genreFilterParam !== 'all') {
    songs = songs.filter(s => s.genre?.toLowerCase() === genreFilterParam.toLowerCase())
  }

  // Cap result size
  songs = songs.slice(0, 50)

  return new Response(JSON.stringify({ songs, filters: { genres: availableGenres, languages: availableLangs } }), { headers: { 'content-type': 'application/json' } })
}

async function fetchFromSources(sources: SourceDef[]): Promise<{ songs: Song[]; genres: string[]; langs: Array<'fr'|'en'|'other'> }> {
  const outSongs: Song[] = []
  const outGenres: string[] = []
  const outLangs: Array<'fr'|'en'|'other'> = []
  for (const src of sources) {
    try {
      const { tracks } = await resolveDeezerSource(src)
      const songs = await enrichTracks(tracks, src)
      outSongs.push(...songs)
      outGenres.push(src.genre)
      outLangs.push(src.language)
    } catch (e) {
      // ignore source errors to keep others working
    }
  }
  return { songs: outSongs, genres: outGenres, langs: outLangs }
}

async function enrichTracks(tracks: any[], src?: SourceDef): Promise<Song[]> {
  // Gather unique album ids
  const albumIds = Array.from(new Set(tracks.map(t => t?.album?.id).filter(Boolean))) as number[]
  // Fetch album details in parallel (limit concurrency naive by slicing)
  const albumMap = new Map<number, { year?: number, genre?: string }>()
  await Promise.all(albumIds.slice(0, 60).map(async (id) => {
    try {
      const r = await fetch(`https://api.deezer.com/album/${id}`, { cache: 'no-store' })
      const j = await r.json()
      const dateStr: string | undefined = j?.release_date
      const year = dateStr ? Number(dateStr.slice(0, 4)) : undefined
      const gname: string | undefined = j?.genres?.data?.[0]?.name
      albumMap.set(id, { year, genre: mapDeezerGenreName(gname) })
    } catch {
      // ignore
    }
  }))

  const songs: Song[] = tracks.map((t: any) => {
    const title: string = t?.title_short || t?.title
    const artist: string = t?.artist?.name
    const albumId: number | undefined = t?.album?.id
    const albumTitle: string = t?.album?.title
    const length: number | undefined = typeof t?.duration === 'number' ? t.duration : undefined
    const preview: string = t?.preview
    const cover: string | undefined = t?.album?.cover_medium || t?.album?.cover
    const extra = albumId ? albumMap.get(albumId) : undefined
    return {
      id: t?.id,
      title,
      artist,
      album: albumTitle,
      year: extra?.year,
      genre: src?.genre || extra?.genre,
      length,
      preview,
      cover,
      language: src?.language || detectLanguage(title, artist)
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
    apiUrl = `https://api.deezer.com/editorial/${mEditorial[1]}/charts?limit=${src.limit || 50}`
    const res = await fetch(apiUrl, { cache: 'no-store' })
    const json = await res.json()
    return { tracks: json?.tracks?.data || [] }
  }
  if (mPlaylist) {
    const id = mPlaylist[1]
    const res = await fetch(`https://api.deezer.com/playlist/${id}`, { cache: 'no-store' })
    const json = await res.json()
    return { tracks: json?.tracks?.data || [] }
  }
  // Fallback: try as-is expecting a track list
  const res = await fetch(apiUrl, { cache: 'no-store' })
  const json = await res.json()
  const tracks = json?.tracks?.data || json?.data || []
  return { tracks }
}
