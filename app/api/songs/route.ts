import { NextRequest } from 'next/server'

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
  const genreFilter = (searchParams.get('genre') as 'rap' | 'pop' | 'electro' | 'rock' | 'all' | null) || 'all'
  const langFilter = (searchParams.get('lang') as 'fr' | 'en' | 'all' | null) || 'all'

  // Build a song pool either from France charts or genre top artists
  let baseSongs: Song[] = []
  if (genreFilter && genreFilter !== 'all') {
    baseSongs = await fetchGenreSongs(genreFilter)
  } else {
    baseSongs = await fetchFranceChartSongs()
  }

  // Language filter
  let songs = baseSongs.filter((s: Song) => (langFilter === 'all' ? true : s.language === langFilter))

  // Cap result size
  songs = songs.slice(0, 50)

  return new Response(JSON.stringify({ songs }), { headers: { 'content-type': 'application/json' } })
}

async function fetchFranceChartSongs(): Promise<Song[]> {
  const res = await fetch('https://api.deezer.com/editorial/110/charts?limit=50', { cache: 'no-store' })
  const json = await res.json()
  const tracks: any[] = json?.tracks?.data || []
  const songs = await enrichTracks(tracks)
  return songs
}

async function fetchGenreSongs(genreKey: 'rap' | 'pop' | 'electro' | 'rock'): Promise<Song[]> {
  const genreId = GENRE_NAME_TO_ID[genreKey]
  const res = await fetch(`https://api.deezer.com/genre/${genreId}/artists`, { cache: 'no-store' })
  const json = await res.json()
  const artists: any[] = json?.data || []
  const topArtists = artists.slice(0, 10)
  const trackLists = await Promise.all(topArtists.map(async (a) => {
    try {
      const r = await fetch(`https://api.deezer.com/artist/${a.id}/top?limit=5`, { cache: 'no-store' })
      const j = await r.json()
      return (j?.data || []) as any[]
    } catch {
      return []
    }
  }))
  const tracks = trackLists.flat()
  const songs = await enrichTracks(tracks)
  return songs
}

async function enrichTracks(tracks: any[]): Promise<Song[]> {
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
      genre: extra?.genre,
      length,
      preview,
      cover,
      language: detectLanguage(title, artist)
    }
  })
  .filter((s: Song) => Boolean(s.preview))

  return songs
}
