'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import useSWRImmutable from 'swr/immutable'
import { useRouter, useSearchParams } from 'next/navigation'
import { START_DATE_UTC, SNIPPET_SECONDS, TRACK_LENGTH } from '@/lib/config'

// Avoid static prerender conflicts; this page is client-driven and depends on search params.
export const dynamic = 'force-dynamic'

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

type ApiResponse = { songs: Song[]; filters?: { languages?: Array<'fr'|'en'|'other'> } }
type DailyResponse = { song: Song; n: number; date: string; lang?: 'fr' | 'en' }

function DailyGame() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const paramNRaw = searchParams?.get('n')
  const paramLang = (searchParams?.get('lang') || 'fr').toLowerCase()
  const lang = (paramLang === 'en' ? 'en' : 'fr') as 'fr' | 'en'
  const queryParams = new URLSearchParams({ ...(paramNRaw ? { n: String(paramNRaw) } : {}), lang })
  const { data: daily, isLoading } = useSWR<DailyResponse>(`/api/daily?${queryParams.toString()}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [round, setRound] = useState<RoundState>({ attempts: [], status: 'idle', revealIndex: -1, snippetIndex: 0 })
  const [query, setQuery] = useState('')
  const audioRef = useRef<HTMLAudioElement>(null)
  const onTimeHandlerRef = useRef<((e: Event) => void) | null>(null)
  const [playhead, setPlayhead] = useState(0) // seconds within current snippet
  const [isPlaying, setIsPlaying] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)
  const loggedSummaryRef = useRef(false)

  const dayNumber = daily?.n || dateToDayNumber(new Date())
  const todayN = dateToDayNumber(new Date())
  const songs = daily?.song ? [daily.song] : []

  // Skip catalogue summary in daily mode

  // Set server-provided daily answer
  useEffect(() => {
    if (daily?.song) {
      setRound({ attempts: [], status: 'idle', revealIndex: -1, snippetIndex: 0, answer: daily.song })
      setQuery('')
      if (audioRef.current) audioRef.current.pause()
      setPlayhead(0)
  setIsPlaying(false)
    }
  }, [daily?.song])

  function showNotice(msg: string, ms = 2200) {
    setNotice(msg)
    if (noticeTimerRef.current) {
      window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = null
    }
    noticeTimerRef.current = window.setTimeout(() => {
      setNotice(null)
      noticeTimerRef.current = null
    }, ms)
  }

  // Notify when a new day's puzzle is loaded
  useEffect(() => {
    if (!round.answer) return
  const msg = `Morceau du jour · #${dayNumber} · ${daily?.date || formatDateUTC(dayNumberToDate(dayNumber))}`
    showNotice(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.answer, dayNumber])

  // Disable local suggestions (avoid leaking the daily answer via local dataset)
  const localSuggestions: Song[] = []

  const { data: remote, error: remoteErr } = useSWRImmutable(
    query.trim().length >= 2 ? `/api/search?${new URLSearchParams({ q: query.trim(), limit: '6' })}` : null,
    fetcher
  )
  type RemoteSuggestion = { id: number; title: string; artist: string }
  const remoteSuggestions = (remote?.suggestions as RemoteSuggestion[] | undefined) ?? []

  const suggestions = useMemo<Song[]>(() => {
    return (remoteSuggestions || []).slice(0, 10).map((r: any) => ({ id: r.id, title: r.title, artist: r.artist, album: '', preview: '', language: undefined }))
  }, [remoteSuggestions])

  const snippetLimit = SNIPPET_SECONDS[Math.min(round.snippetIndex, SNIPPET_SECONDS.length - 1)]
  const trackLength = TRACK_LENGTH
  const snippetLimitClamped = Math.min(snippetLimit, trackLength)

  // Persist per-day+lang progress in localStorage
  useEffect(() => {
    if (!round.answer) return
    const key = storageKeyForDay(dayNumber, lang)
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.answerId === round.answer.id) {
          setRound((r: RoundState) => ({
            ...r,
            attempts: Array.isArray(parsed.attempts) ? parsed.attempts.slice(0, 6) : [],
            revealIndex: Number.isFinite(parsed.revealIndex) ? Math.min(parsed.revealIndex, 4) : -1,
            snippetIndex: Number.isFinite(parsed.snippetIndex) ? Math.min(parsed.snippetIndex, SNIPPET_SECONDS.length - 1) : 0,
            status: parsed.status === 'won' || parsed.status === 'lost' ? parsed.status : 'idle',
          }))
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.answer?.id, dayNumber])

  useEffect(() => {
    if (!round.answer) return
    const key = storageKeyForDay(dayNumber, lang)
    try {
      const payload = {
        answerId: round.answer.id,
        attempts: round.attempts,
        revealIndex: round.revealIndex,
        snippetIndex: round.snippetIndex,
        status: round.status,
      }
      localStorage.setItem(key, JSON.stringify(payload))
    } catch {
      // ignore
    }
  }, [round.answer?.id, round.attempts, round.revealIndex, round.snippetIndex, round.status, dayNumber, lang])

  function togglePlay() {
    if (!round.answer) return
    const audio = audioRef.current
    if (!audio) return
    const duration = SNIPPET_SECONDS[Math.min(round.snippetIndex, SNIPPET_SECONDS.length - 1)]
    // If currently playing, pause
    if (!audio.paused) {
      audio.pause()
      setIsPlaying(false)
      return
    }
    // Ensure source is correct
    if (audio.src !== round.answer.preview) {
      audio.src = round.answer.preview
    }
    // Always start the snippet from the beginning to prevent accumulating playhead progress
    try {
      audio.currentTime = 0
    } catch {
      // Some browsers may throw if the media isn't ready yet; ignore and rely on timeupdate handler
    }
    setPlayhead(0)
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
        setIsPlaying(false)
      }
    }
    onTimeHandlerRef.current = onTime
    audio.addEventListener('timeupdate', onTime)
    audio.play()
    setIsPlaying(true)
  }

  function submitGuess(guess: Song) {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    const correct = normalize(guess.title) === normalize(round.answer.title) && normalize(guess.artist) === normalize(round.answer.artist)
    const nextAttempts = [...round.attempts, `${guess.title} — ${guess.artist}`]
    if (correct) {
      setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, status: 'won' }))
      const audio = audioRef.current
      if (audio) audio.pause()
      setIsPlaying(false)
      setPlayhead(0)
      return
    }
  const nextReveal = Math.min(round.revealIndex + 1, 4)
  const nextSnippet = Math.min(round.snippetIndex + 1, SNIPPET_SECONDS.length - 1)
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
  const nextReveal = Math.min(round.revealIndex + 1, 4)
  const nextSnippet = Math.min(round.snippetIndex + 1, SNIPPET_SECONDS.length - 1)
    const lost = nextAttempts.length >= 6
    setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
  setPlayhead(0)
  setIsPlaying(false)
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
  snippetIndex: SNIPPET_SECONDS.length - 1
    }))
  setPlayhead(0)
  setIsPlaying(false)
  }

  function resetRound() {
    if (!round.answer) return
    // Reset attempts for the same daily song
    setRound({ attempts: [], status: 'idle', revealIndex: -1, snippetIndex: 0, answer: round.answer })
    setQuery('')
    if (audioRef.current) audioRef.current.pause()
    setPlayhead(0)
  setIsPlaying(false)
  }

  function gotoDay(n: number) {
    if (n < 1) n = 1
    const clamped = Math.min(n, todayN)
    const sp = new URLSearchParams()
    sp.set('n', String(clamped))
  sp.set('lang', lang)
  router.push(`?${sp.toString()}`)
  }

  function gotoToday() {
    const n = todayN
  const sp = new URLSearchParams({ n: String(n), lang })
  router.push(`?${sp.toString()}`)
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
    round.answer?.album || '—',
    round.answer?.artist || '—',
  ]

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1 style={{ textAlign: 'center', marginTop: 16 }}>Devine la Musique</h1>
      {notice && (
        <div style={noticeStyle}>{notice}</div>
      )}

      {/* Daily header (big number + date) with navigation and language toggle */}
      <section style={{ marginBottom: 12 }}>
        <div style={{
          display: 'grid',
          placeItems: 'center',
          padding: 16,
          background: 'linear-gradient(180deg, #161616, #121212)',
          border: '1px solid #2a2a2a',
          borderRadius: 16,
          boxShadow: '0 8px 32px rgba(0,0,0,0.35)'
        }}>
          <div style={{
            fontSize: 'clamp(40px, 7vw, 72px)',
            lineHeight: 1,
            fontWeight: 900,
            letterSpacing: 0.5,
            textShadow: '0 2px 16px rgba(0,0,0,0.35)'
          }}>#{dayNumber}</div>
          <div style={{
            marginTop: 6,
            fontSize: 'clamp(14px, 2.5vw, 22px)',
            opacity: 0.9
          }}>{daily?.date || formatDateUTC(dayNumberToDate(dayNumber))}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button
              onClick={() => router.push(`?${new URLSearchParams({ n: String(dayNumber), lang: 'fr' })}`)}
              style={{
                ...buttonStyle,
                background: lang === 'fr' ? '#2b3f5a' : '#222',
                borderColor: lang === 'fr' ? '#4a78b7' : '#333'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <img src="/FR.svg" alt="Drapeau français" style={{ width: 20, height: 14, display: 'block', objectFit: 'contain' }} />
                <span>FR</span>
              </span>
            </button>
            <button
              onClick={() => router.push(`?${new URLSearchParams({ n: String(dayNumber), lang: 'en' })}`)}
              style={{
                ...buttonStyle,
                background: lang === 'en' ? '#2b3f5a' : '#222',
                borderColor: lang === 'en' ? '#4a78b7' : '#333'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <img src="/EN.svg" alt="Drapeau anglais" style={{ width: 20, height: 14, display: 'block', objectFit: 'contain' }} />
                <span>EN</span>
              </span>
            </button>
          </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
          <button onClick={() => gotoDay(dayNumber - 1)} style={buttonStyle}>{'<' } Jour préc.</button>
          <button onClick={() => gotoDay(dayNumber + 1)} disabled={dayNumber >= todayN} style={{ ...buttonStyle, opacity: dayNumber >= todayN ? 0.5 : 1 }}>Jour suiv. {'>'}</button>
          <button onClick={gotoToday} style={buttonStyle}>Aujourd'hui</button>
          <button onClick={resetRound} style={buttonStyle}>Rejouer</button>
        </div>
        </div>

      </section>

      {(round.status === 'won' || round.status === 'lost') && (
        <section style={{
          marginTop: 8,
          marginBottom: 16,
          display: 'grid',
          placeItems: 'center',
          textAlign: 'center',
          padding: 16,
          background: round.status === 'won' ? 'linear-gradient(180deg, #143d1b, #0f2f15)' : '#181818',
          border: round.status === 'won' ? '1px solid #2e6b3a' : '1px solid #333',
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
                // remove non-standard allowTransparency to avoid React warning
                allow="encrypted-media; clipboard-write"
                style={{ borderRadius: 12, backgroundColor: 'transparent' }}
              />
            </div>
          )}
          <button onClick={resetRound} style={{ ...buttonStyle, marginTop: 12 }}>Rejouer</button>
        </section>
      )}

      <section style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
  <button onClick={togglePlay} style={{ ...buttonStyle, fontSize: 18 }}>{isPlaying ? '⏸️ Pause' : "▶️ Écouter l'extrait"}</button>
        <button onClick={skipAttempt} style={{ ...buttonStyle }}>⏭️ Passer</button>
        <button onClick={forfeitRound} style={{ ...buttonStyle }}>Abandonner</button>
  <span style={{ marginLeft: 8, fontSize: 14, opacity: 0.8 }}>({round.attempts.length}/6)</span>
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
                 <li key={`${s.title}-${s.artist}`} style={suggestionItem} onClick={() => { setQuery(''); submitGuess(s) }}>
                  {s.title} — <span style={{ opacity: 0.8 }}>{s.artist}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {[...Array(6)].map((_, i) => {
            const txt = round.attempts[i]
            const isSkip = txt === '⏭️ Passé'
            const expected = round.answer ? `${round.answer.title} — ${round.answer.artist}` : ''
            const isFullCorrect = Boolean(txt) && round.answer && normalize(txt!) === normalize(expected)
            // Try to parse artist from "title — artist" format
            const guessedArtist = txt?.split(' — ')[1]?.trim() || ''
            const hasArtistMatch = Boolean(txt) && !isSkip && round.answer && normalize(guessedArtist) === normalize(round.answer.artist)
            const isWrong = Boolean(txt) && !isSkip && round.answer && !isFullCorrect && !hasArtistMatch
            let style: React.CSSProperties = attemptBox
            if (isFullCorrect) {
              style = { ...attemptBox, background: '#163a22', borderColor: '#2f7a4a', color: '#c6f5d8' }
            } else if (isWrong) {
              style = { ...attemptBox, background: '#2a1515', borderColor: '#7a2a2a', color: '#f5c6c6' }
            } else if (hasArtistMatch && !isFullCorrect) {
              style = { ...attemptBox, background: '#3a3415', borderColor: '#8a7a2a', color: '#f7e7a3' }
            }
            return (
              <div key={i} style={style}>
                {txt ?? ''}
              </div>
            )
          })}
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <h3>Indications</h3>
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 6 }}>
      {hintList.map((h, i) => {
            const visible = i <= round.revealIndex
            return (
              <li key={i} style={{ ...hintItem, opacity: visible ? 1 : 0.3 }}>
        {['Durée', 'Année', 'Album', 'Artiste'][i]}: {visible ? h : '…'}
              </li>
            )
          })}
        </ul>
      </section>

  {/* Result section moved to top */}

      <footer style={{ marginTop: 48, textAlign: 'center', opacity: 0.7 }}>
        Jour #{dayNumber} · {formatDateUTC(dayNumberToDate(dayNumber))} · Utilise l'API Deezer.
      </footer>
    </main>
  )
}

export default function HomePage() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}><h1 style={{ textAlign: 'center', marginTop: 16 }}>Devine la Musique</h1><div style={{ textAlign: 'center', opacity: 0.7, marginTop: 12 }}>Chargement…</div></main>}>
      <DailyGame />
    </Suspense>
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

const noticeStyle: React.CSSProperties = {
  position: 'fixed',
  left: '50%',
  bottom: 20,
  transform: 'translateX(-50%)',
  zIndex: 9999,
  padding: '10px 16px',
  borderRadius: 999,
  border: '1px solid #2a2a2a',
  background: 'rgba(20, 34, 42, 0.95)',
  color: '#cfe9f5',
  boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  maxWidth: '90vw',
  textAlign: 'center',
  pointerEvents: 'none',
}

// ===== Daily utilities =====
const ORIGIN_UTC = new Date(START_DATE_UTC + 'T00:00:00Z')

function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

function dateToDayNumber(d: Date): number {
  const date = startOfDayUTC(d)
  const ms = date.getTime() - ORIGIN_UTC.getTime()
  return Math.floor(ms / 86400000) + 1
}

function dayNumberToDate(n: number): Date {
  const ms = (n - 1) * 86400000
  return new Date(ORIGIN_UTC.getTime() + ms)
}

function formatDateUTC(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !isNaN(d.getTime())
}

function storageKeyForDay(n: number, lang: 'fr' | 'en') {
  return `dlm_daily_${lang}_${n}`
}
