import { EN_PLAYLIST_URL, FR_PLAYLIST_URL, PLAYLIST_FETCH_LIMIT } from '@/lib/config'

export type SourceDef = {
  id: string
  provider: 'deezer'
  type: 'playlist'
  url: string
  language: 'fr' | 'en'
  limit?: number
}

// Sources driven by config (no genres)
export const SOURCES: SourceDef[] = [
  {
    id: 'playlist-fr',
    provider: 'deezer',
    type: 'playlist',
    url: FR_PLAYLIST_URL,
    language: 'fr',
    limit: PLAYLIST_FETCH_LIMIT,
  },
  {
    id: 'playlist-en',
    provider: 'deezer',
    type: 'playlist',
    url: EN_PLAYLIST_URL,
    language: 'en',
    limit: PLAYLIST_FETCH_LIMIT,
  },
]
