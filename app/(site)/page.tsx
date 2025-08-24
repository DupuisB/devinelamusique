'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import Fuse from 'fuse.js'
import type { FuseResult } from 'fuse.js'

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

type RoundState = {
  answer?: Song
  attempts: string[]
  status: 'idle' | 'playing' | 'won' | 'lost'
  revealIndex: number // how many hints revealed
  snippetIndex: number // 0..5, controls seconds length
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

type ApiResponse = { songs: Song[]; filters?: { genres?: string[]; languages?: Array<'fr'|'en'|'other'> } }

export default function HomePage() {
  const [genre, setGenre] = useState<string>('all')
  const [lang, setLang] = useState<'all' | 'fr' | 'en' | 'other'>('all')
  const { data, isLoading } = useSWR<ApiResponse>(`/api/songs?${new URLSearchParams({
    ...(genre !== 'all' ? { genre } : {}),
    ...(lang !== 'all' ? { lang } : {})
  })}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [round, setRound] = useState<RoundState>({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0 })
  const [query, setQuery] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const onTimeHandlerRef = useRef<((e: Event) => void) | null>(null)
  const [playhead, setPlayhead] = useState(0) // seconds within current snippet

  const songs = data?.songs ?? []
  const availableGenres: string[] = useMemo(() => ['all', ...Array.from(new Set(data?.filters?.genres ?? []))], [data])
  const availableLangs: Array<'all'|'fr'|'en'|'other'> = useMemo(() => ['all', ...Array.from(new Set((data?.filters?.languages ?? []) as Array<'fr'|'en'|'other'>))], [data])

  // pick a random answer when songs load or filters change
  useEffect(() => {
    if (songs.length) {
      const answer = songs[Math.floor(Math.random() * songs.length)]
      setRound({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0, answer })
      setQuery('')
      if (audioRef.current) audioRef.current.pause()
  setPlayhead(0)
    }
  }, [data])

  const fuse = useMemo(() => new Fuse(songs, {
    keys: [
      { name: 'title', weight: 0.6 },
      { name: 'artist', weight: 0.4 }
    ],
    threshold: 0.3
  }), [songs])

  const suggestions = useMemo<Song[]>(() => {
    if (!query.trim()) return [] as Song[]
    return fuse.search(query).slice(0, 8).map((r: FuseResult<Song>) => r.item)
  }, [query, fuse])

  const snippetSecondsByAttempt = [0.5, 1, 2, 4, 8, 15]
  const snippetLimit = snippetSecondsByAttempt[Math.min(round.snippetIndex, snippetSecondsByAttempt.length - 1)]
  const trackLength = 30
  const snippetLimitClamped = Math.min(snippetLimit, trackLength)

  function play() {
    if (!round.answer) return
    const audio = audioRef.current
    if (!audio) return
    audio.src = round.answer.preview
    audio.currentTime = 0
    setPlayhead(0)
    // Limit playback length by stopping after X seconds
    const duration = snippetSecondsByAttempt[Math.min(round.snippetIndex, snippetSecondsByAttempt.length - 1)]
    // Clean prev handler if any
    if (onTimeHandlerRef.current) {
      audio.removeEventListener('timeupdate', onTimeHandlerRef.current)
    }
    const onTime = () => {
      const t = Math.min(audio.currentTime, duration)
      setPlayhead(t)
      if (t >= duration) {
        audio.pause()
        audio.removeEventListener('timeupdate', onTime)
        onTimeHandlerRef.current = null
      }
    }
    onTimeHandlerRef.current = onTime
    audio.addEventListener('timeupdate', onTime)
    audio.play()
  }

  function submitGuess(guess: Song) {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    const correct = normalize(guess.title) === normalize(round.answer.title) && normalize(guess.artist) === normalize(round.answer.artist)
    const nextAttempts = [...round.attempts, `${guess.title} — ${guess.artist}`]
    if (correct) {
  setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, status: 'won' }))
      setPlayhead(0)
      return
    }
    const nextReveal = Math.min(round.revealIndex + 1, 5)
    const nextSnippet = Math.min(round.snippetIndex + 1, snippetSecondsByAttempt.length - 1)
    const lost = nextAttempts.length >= 6
  setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
    setPlayhead(0)
  }

  function normalize(s: string) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  }

  function skipAttempt() {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    const audio = audioRef.current
    if (audio) audio.pause()
    const nextAttempts = [...round.attempts, '⏭️ Passé']
    const nextReveal = Math.min(round.revealIndex + 1, 5)
    const nextSnippet = Math.min(round.snippetIndex + 1, snippetSecondsByAttempt.length - 1)
    const lost = nextAttempts.length >= 6
    setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
  setPlayhead(0)
  }

  function forfeitRound() {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    // Reveal everything and mark as lost
    const audio = audioRef.current
    if (audio) audio.pause()
    setRound((r: RoundState) => ({
      ...r,
      status: 'lost',
      revealIndex: 4,
      snippetIndex: snippetSecondsByAttempt.length - 1
    }))
  setPlayhead(0)
  }

  function resetRound() {
    if (!songs.length) return
    const answer = songs[Math.floor(Math.random() * songs.length)]
    setRound({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0, answer })
    setQuery('')
    if (audioRef.current) audioRef.current.pause()
  setPlayhead(0)
  }

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
  }
  function formatSnippet(seconds: number) {
    return seconds < 1 ? `${seconds.toFixed(1)}s` : formatDuration(seconds)
  }

  const hintList = [
  round.answer?.length ? formatDuration(round.answer.length) : '—',
    round.answer?.year ? String(round.answer?.year) : '—',
    round.answer?.genre || '—',
    round.answer?.album || '—',
    round.answer?.artist || '—',
  ]

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ textAlign: 'center', marginTop: 16 }}>Devine la Musique</h1>

  {/* Result banner moved below filter section */}

      <section style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <select value={genre} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGenre(e.target.value)} style={selectStyle}>
          {availableGenres.map(g => (
            <option key={g} value={g}>{g === 'all' ? 'Tous genres' : g}</option>
          ))}
        </select>
        <select value={lang} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLang(e.target.value as 'all' | 'fr' | 'en' | 'other')} style={selectStyle}>
          {availableLangs.map(l => (
            <option key={l} value={l}>{l === 'all' ? 'Toutes langues' : l.toUpperCase()}</option>
          ))}
        </select>
        <button onClick={resetRound} style={buttonStyle}>Nouvelle chanson</button>
      </section>

      {(round.status === 'won' || round.status === 'lost') && (
        <section style={{
          marginTop: 8,
          marginBottom: 16,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          padding: 16,
          background: '#181818',
          border: '1px solid #333',
          borderRadius: 16
        }}>
          <div style={{ fontSize: 28, fontWeight: 700 }}>
            {round.status === 'won' ? 'Bravo !' : 'Raté.'}
          </div>
          <div style={{ fontSize: 18, marginTop: 6 }}>
            C'était: <b>{round.answer?.title}</b> — {round.answer?.artist}
          </div>
          {!!round.answer?.id && (
            <div style={{ marginTop: 12, width: '100%', maxWidth: 560 }}>
              <iframe
                title="Deezer Player"
                src={`https://widget.deezer.com/widget/dark/track/${round.answer.id}`}
                width="100%"
                height="90"
                frameBorder="0"
                allowTransparency={true}
                allow="encrypted-media; clipboard-write"
                style={{ borderRadius: 12 }}
              />
            </div>
          )}
          <button onClick={resetRound} style={{ ...buttonStyle, marginTop: 12 }}>Rejouer</button>
        </section>
      )}

      <section style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button onClick={play} style={{ ...buttonStyle, fontSize: 18 }}>▶️ Écouter l'extrait</button>
        <button onClick={skipAttempt} style={{ ...buttonStyle }}>⏭️ Passer</button>
        <button onClick={forfeitRound} style={{ ...buttonStyle }}>Abandonner</button>
        <audio ref={audioRef} preload="none" />
      </section>

      {/* Full track progress bar with snippet window */}
      <section style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
          <span>{formatDuration(0)}</span>
          <span>Extrait: {formatSnippet(snippetLimitClamped)} • Total: {formatDuration(trackLength)}</span>
        </div>
        <div style={{ position: 'relative', height: 12, background: '#1b1b1b', border: '1px solid #333', borderRadius: 999, overflow: 'hidden' }}>
          {/* Snippet window segment */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${(snippetLimitClamped / trackLength) * 100}%`,
            background: '#2c3f2f'
          }} />
          {/* Playback progress within snippet */}
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${(Math.min(playhead, snippetLimitClamped) / trackLength) * 100}%`,
            background: '#5ac46a',
            transition: 'width 80ms linear'
          }} />
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ position: 'relative' }}>
          <input
            placeholder={isLoading ? 'Chargement...' : 'Tape le titre ou l\'artiste'}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && suggestions.length > 0) {
                e.preventDefault()
                submitGuess(suggestions[0])
              }
            }}
            style={inputStyle}
          />
          {!!suggestions.length && (
            <ul style={suggestionsBox}>
              {suggestions.map(s => (
                <li key={s.id} style={suggestionItem} onClick={() => { setQuery(''); submitGuess(s) }}>
                  {s.title} — <span style={{ opacity: 0.8 }}>{s.artist}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {[...Array(6)].map((_, i) => (
            <div key={i} style={attemptBox}>
              {round.attempts[i] ?? ''}
            </div>
          ))}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Indications</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
          {hintList.map((h, i) => (
            <li key={i} style={{ ...hintItem, opacity: i <= round.revealIndex ? 1 : 0.3 }}>
              {['Durée', 'Année', 'Genre', 'Album', 'Artiste'][i]}: {i <= round.revealIndex ? h : '…'}
            </li>
          ))}
        </ul>
      </section>

  {/* Result section moved to top */}

      <footer style={{ marginTop: 48, textAlign: 'center', opacity: 0.7 }}>
        Sources: Deezer charts France. Préviews 30s Deezer. Projet démo.
      </footer>
    </main>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid #333',
  background: '#1a1a1a',
  color: '#eee',
  fontSize: 16,
}

const buttonStyle: React.CSSProperties = {
  padding: '10px 14px',
  borderRadius: 12,
  border: '1px solid #333',
  background: '#222',
  color: '#eee',
  cursor: 'pointer'
}

const selectStyle: React.CSSProperties = {
  ...buttonStyle,
}

const suggestionsBox: React.CSSProperties = {
  position: 'absolute',
  top: '100%',
  left: 0,
  right: 0,
  background: '#1a1a1a',
  border: '1px solid #333',
  borderRadius: 12,
  marginTop: 6,
  maxHeight: 260,
  overflowY: 'auto',
  zIndex: 10,
}

const suggestionItem: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #222',
  cursor: 'pointer'
}

const attemptBox: React.CSSProperties = {
  border: '1px solid #333',
  minHeight: 44,
  borderRadius: 12,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: '#1a1a1a'
}

const hintItem: React.CSSProperties = {
  padding: '8px 10px',
  border: '1px solid #333',
  borderRadius: 12,
  background: '#1a1a1a'
}
