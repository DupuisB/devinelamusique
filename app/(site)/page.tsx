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

export default function HomePage() {
  const [genre, setGenre] = useState<string>('all')
  const [lang, setLang] = useState<'all' | 'fr' | 'en'>('all')
  const { data, isLoading } = useSWR<{ songs: Song[] }>(`/api/songs?${new URLSearchParams({
    ...(genre !== 'all' ? { genre } : {}),
    ...(lang !== 'all' ? { lang } : {})
  })}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [round, setRound] = useState<RoundState>({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0 })
  const [query, setQuery] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)

  const songs = data?.songs ?? []

  // pick a random answer when songs load or filters change
  useEffect(() => {
    if (songs.length) {
      const answer = songs[Math.floor(Math.random() * songs.length)]
      setRound({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0, answer })
      setQuery('')
      if (audioRef.current) audioRef.current.pause()
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

  const snippetSecondsByAttempt = [1, 2, 4, 7, 10, 15]

  function play() {
    if (!round.answer) return
    const audio = audioRef.current
    if (!audio) return
    audio.src = round.answer.preview
    audio.currentTime = 0
    // Limit playback length by stopping after X seconds
    const duration = snippetSecondsByAttempt[Math.min(round.snippetIndex, snippetSecondsByAttempt.length - 1)]
    audio.play()
    const onTime = () => {
      if (audio.currentTime >= duration) {
        audio.pause()
        audio.removeEventListener('timeupdate', onTime)
      }
    }
    audio.addEventListener('timeupdate', onTime)
  }

  function submitGuess(guess: Song) {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    const correct = normalize(guess.title) === normalize(round.answer.title) && normalize(guess.artist) === normalize(round.answer.artist)
    const nextAttempts = [...round.attempts, `${guess.title} — ${guess.artist}`]
    if (correct) {
  setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, status: 'won' }))
      return
    }
    const nextReveal = Math.min(round.revealIndex + 1, 5)
    const nextSnippet = Math.min(round.snippetIndex + 1, snippetSecondsByAttempt.length - 1)
    const lost = nextAttempts.length >= 6
  setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
  }

  function normalize(s: string) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  }

  function resetRound() {
    if (!songs.length) return
    const answer = songs[Math.floor(Math.random() * songs.length)]
    setRound({ attempts: [], status: 'idle', revealIndex: 0, snippetIndex: 0, answer })
    setQuery('')
    if (audioRef.current) audioRef.current.pause()
  }

  function formatDuration(seconds: number) {
    const m = Math.floor(seconds / 60)
    const s = Math.floor(seconds % 60)
    return `${m}:${String(s).padStart(2, '0')}`
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

      <section style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
  <select value={genre} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setGenre(e.target.value)} style={selectStyle}>
          <option value="all">Tous genres</option>
          <option value="rap">Rap</option>
          <option value="pop">Pop</option>
          <option value="electro">Electro</option>
          <option value="rock">Rock</option>
        </select>
  <select value={lang} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setLang(e.target.value as 'all' | 'fr' | 'en')} style={selectStyle}>
          <option value="all">Toutes langues</option>
          <option value="fr">Français</option>
          <option value="en">Anglais</option>
        </select>
        <button onClick={resetRound} style={buttonStyle}>Nouvelle chanson</button>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
        <button onClick={play} style={{ ...buttonStyle, fontSize: 18 }}>▶️ Écouter l'extrait</button>
        <audio ref={audioRef} preload="none" />
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

      {(round.status === 'won' || round.status === 'lost') && (
        <section style={{ marginTop: 16, textAlign: 'center' }}>
          <div style={{ fontSize: 18, marginBottom: 8 }}>
            {round.status === 'won' ? 'Bravo !' : 'Raté.'}
          </div>
          <div>
            C'était: <b>{round.answer?.title}</b> — {round.answer?.artist}
          </div>
          <button onClick={resetRound} style={{ ...buttonStyle, marginTop: 12 }}>Rejouer</button>
        </section>
      )}

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
