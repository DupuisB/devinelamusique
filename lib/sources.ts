export type SourceDef = {
  id: string
  provider: 'deezer'
  type: 'editorial_charts' | 'playlist' | 'chart'
  url: string
  language: 'fr' | 'en' | 'other'
  genre: string
  limit?: number
}

// Edit this list to control which charts/playlists are used.
// You can paste Deezer URLs (web or API); we will detect kind and IDs automatically.
export const SOURCES: SourceDef[] = [
  {
    id: 'playlist-11928321221-rap-fr',
    provider: 'deezer',
    type: 'playlist',
    url: 'https://www.deezer.com/fr/playlist/11928321221',
    language: 'fr',
    genre: 'rap',
  },
  {
    id: 'playlist-4676818664-rap-en',
    provider: 'deezer',
    type: 'playlist',
    url: 'https://www.deezer.com/fr/playlist/4676818664',
    language: 'en',
    genre: 'rap',
  },
  {
    id: 'playlist-1189520191-pop-fr',
    provider: 'deezer',
    type: 'playlist',
    url: 'https://www.deezer.com/fr/playlist/1189520191',
    language: 'fr',
    genre: 'pop',
  },
  {
    id: 'playlist-7873409502-pop-en',
    provider: 'deezer',
    type: 'playlist',
    url: 'https://www.deezer.com/fr/playlist/7873409502',
    language: 'en',
    genre: 'pop',
  },

]
