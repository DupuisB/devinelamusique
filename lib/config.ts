// Central app configuration for the daily game
// You can change these values without touching the code.

export const START_DATE_UTC = '2025-08-22' // YYYY-MM-DD (UTC) — day #1

export const FR_PLAYLIST_URL = 'https://www.deezer.com/fr/playlist/14230090421'
export const EN_PLAYLIST_URL = 'https://www.deezer.com/fr/playlist/7873409502'

// Max tracks to fetch per playlist
export const PLAYLIST_FETCH_LIMIT = 500

// Snippet playback durations per attempt (seconds). Must have 6 entries.
export const SNIPPET_SECONDS: number[] = [0.1, 0.5, 2, 4, 8, 15]
export const TRACK_LENGTH = 15
