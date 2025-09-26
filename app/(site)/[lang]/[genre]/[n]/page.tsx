'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import useSnippetPlayer from '@/lib/useSnippetPlayer'
import useSWR from 'swr'
import useSWRImmutable from 'swr/immutable'
import { useParams, useRouter, useSearchParams } from 'next/navigation'
import { START_DATE_UTC, SNIPPET_SECONDS, TRACK_LENGTH, RESET_OFFSET_HOURS } from '@/lib/config'

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
  revealIndex: number
  snippetIndex: number
}

const fetcher = (url: string) => fetch(url).then(r => r.json())

type DailyResponse = { song: Song; n: number; date: string; lang?: 'fr' | 'en'; genre?: 'all' | 'rap' }

function DailyGame() {
  const router = useRouter()
  const params = useParams<{ lang: string; genre: string; n: string }>()
  const searchParams = useSearchParams()
  const rawLang = String(params?.lang || 'fr').toLowerCase()
  const lang = (rawLang === 'en' ? 'en' : 'fr') as 'fr' | 'en'
  const rawN = String(params?.n || '')
  const rawGenre = String(params?.genre || 'all').toLowerCase()

  // Genre from URL (default: all)
  const urlGenre = (rawGenre === 'rap' ? 'rap' : 'all') as 'all' | 'rap'
  const [genre, setGenre] = useState<'all' | 'rap'>(urlGenre)

  // Small translations map
  type LangKey = 'fr' | 'en'
  const translations: Record<LangKey, {
    title: string
    loading: string
    listen: string
    pause: string
    skip: string
    today: string
    prevDay: string
    nextDay: string
    all: string
    rap: string
    fr: string
    en: string
    placeholder: string
    won: string
    lost: string
    hintLabels: string[]
    footer: string
    skipped: string
  }> = {
    fr: {
      title: 'Devine la Musique',
      loading: 'Chargement',
      listen: "▶️ Écouter",
      pause: '⏸️ Pause',
      skip: '⏭️ Passer',
      today: "Aujourd'hui",
      prevDay: '< Jour préc.',
      nextDay: 'Jour suiv. >',
      all: 'Tous',
      rap: 'Rap',
      fr: 'FR',
      en: 'EN',
      placeholder: "Tape le titre ou l'artiste",
      won: 'Bravo !',
      lost: 'Raté.',
      hintLabels: ['Durée', 'Genre', 'Année', 'Album', 'Artiste'],
      footer: "Jour #{day} · {date} · Utilise l'API Deezer.",
      skipped: '⏭️ Passé',
    },
    en: {
      title: 'Guess the Song',
      loading: 'Loading',
      listen: "▶️ Play",
      pause: '⏸️ Pause',
      skip: '⏭️ Skip',
      today: 'Today',
      prevDay: '< Prev. day',
      nextDay: 'Next day >',
      all: 'All',
      rap: 'Rap',
      fr: 'FR',
      en: 'EN',
      placeholder: 'Type title or artist',
      won: 'Well done!',
      lost: 'Missed.',
      hintLabels: ['Duration', 'Genre', 'Year', 'Album', 'Artist'],
      footer: "Day #{day} · {date} · Uses the Deezer API.",
      skipped: '⏭️ Skipped',
    }
  }

  const t = translations[lang as LangKey]

  // Sync genre state on URL change
  useEffect(() => {
    setGenre(urlGenre)
  }, [urlGenre])

  const { data: daily, isLoading } = useSWR<DailyResponse>(
    `/api/daily?${new URLSearchParams({ n: rawN, lang, genre })}`,
    fetcher,
    { revalidateOnFocus: false }
  )

  const [round, setRound] = useState<RoundState>({ attempts: [], status: 'idle', revealIndex: -1, snippetIndex: 0 })
  const [query, setQuery] = useState('')
  const { audioRef, playSnippet, pause, playhead, isPlaying } = useSnippetPlayer()
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimerRef = useRef<number | null>(null)

  // Use dayNumber from API; no fallback while loading
  const dayNumber = daily?.n
  const todayN = dateToDayNumber(new Date())

  const { data: remote } = useSWRImmutable(
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

  useEffect(() => {
    if (daily?.song) {
      setRound({ attempts: [], status: 'idle', revealIndex: -1, snippetIndex: 0, answer: daily.song })
      setQuery('')
      if (audioRef.current) try { audioRef.current.pause() } catch {}
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

  useEffect(() => {
    if (!round.answer || !daily?.date) return
    const msg = `Morceau du jour · #${dayNumber} · ${daily.date}`
    showNotice(msg)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.answer, dayNumber, daily?.date])

  useEffect(() => {
    if (!round.answer || !dayNumber) return
    const key = storageKeyForDay(dayNumber, lang, genre)
    try {
      const raw = localStorage.getItem(key)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && parsed.answerId === round.answer.id) {
          setRound((r: RoundState) => ({
            ...r,
            attempts: Array.isArray(parsed.attempts) ? parsed.attempts.slice(0, 6) : [],
            revealIndex: Number.isFinite(parsed.revealIndex) ? Math.min(parsed.revealIndex, 5) : -1,
            snippetIndex: Number.isFinite(parsed.snippetIndex) ? Math.min(parsed.snippetIndex, SNIPPET_SECONDS.length - 1) : 0,
            status: parsed.status === 'won' || parsed.status === 'lost' ? parsed.status : 'idle',
          }))
        }
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round.answer?.id, dayNumber, genre])

  useEffect(() => {
    if (!round.answer || !dayNumber) return
    const key = storageKeyForDay(dayNumber, lang, genre)
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
  }, [round.answer?.id, round.attempts, round.revealIndex, round.snippetIndex, round.status, dayNumber, lang, genre])

  // Show loading while essential data missing
  if (isLoading || !daily || dayNumber === undefined) {
    return (
      <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
        <h1 style={{ textAlign: 'center', marginTop: 16 }}>{t.title}</h1>
        <div style={{ textAlign: 'center', opacity: 0.7, marginTop: 24 }}>
          {t.loading} #{rawN}...
        </div>
      </main>
    )
  }

  function togglePlay() {
    if (!round.answer) return
    const duration = SNIPPET_SECONDS[Math.min(round.snippetIndex, SNIPPET_SECONDS.length - 1)]
    void playSnippet(round.answer.preview, duration)
  }

  function submitGuess(guess: Song) {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    const correct = normalize(guess.title) === normalize(round.answer.title) && normalize(guess.artist) === normalize(round.answer.artist)
    const nextAttempts = [...round.attempts, `${guess.title}  ${guess.artist}`]
    if (correct) {
      setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, status: 'won' }))
      pause()
      if (audioRef.current) try { audioRef.current.currentTime = 0 } catch {}
      return
    }
    const nextReveal = Math.min(round.revealIndex + 1, 5)
    const nextSnippet = Math.min(round.snippetIndex + 1, SNIPPET_SECONDS.length - 1)
    const lost = nextAttempts.length >= 6
    setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
    pause()
    if (audioRef.current) try { audioRef.current.currentTime = 0 } catch {}
  }

  function normalize(s: string) {
    return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  }

  function skipAttempt() {
    if (!round.answer || round.status === 'won' || round.status === 'lost') return
    pause()
    const nextAttempts = [...round.attempts, '⏭️ Passé']
    const nextReveal = Math.min(round.revealIndex + 1, 5)
    const nextSnippet = Math.min(round.snippetIndex + 1, SNIPPET_SECONDS.length - 1)
    const lost = nextAttempts.length >= 6
    setRound((r: RoundState) => ({ ...r, attempts: nextAttempts, revealIndex: nextReveal, snippetIndex: nextSnippet, status: lost ? 'lost' : r.status }))
    if (audioRef.current) try { audioRef.current.currentTime = 0 } catch {}
    pause()
  }

  function gotoDay(n: number) {
    if (n < 1) n = 1
    const clamped = Math.min(n, todayN)
    router.push(`/${lang}/${genre}/${clamped}`)
  }

  function gotoToday() {
    const n = todayN
    router.push(`/${lang}/${genre}/${n}`)
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
    round.answer?.length ? formatDuration(round.answer.length) : '',
    round.answer?.genre || '',
    round.answer?.year ? String(round.answer?.year) : '',
    round.answer?.album || '',
    round.answer?.artist || '',
  ]

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
  <h1 style={{ textAlign: 'center', marginTop: 16 }}>{t.title}</h1>
      {notice && (
        <div style={noticeStyle}>{notice}</div>
      )}

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
          }}>{daily.date}</div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button
              onClick={() => { if (genre !== 'all') { pause(); router.push(`/${lang}/all/${dayNumber}`) } }}
              style={{
                ...buttonStyle,
                background: genre === 'all' ? '#2b3f5a' : '#222',
                borderColor: genre === 'all' ? '#4a78b7' : '#333'
              }}
            >{t.all}</button>
            <button
              onClick={() => { if (genre !== 'rap') { pause(); router.push(`/${lang}/rap/${dayNumber}`) } }}
              style={{
                ...buttonStyle,
                background: genre === 'rap' ? '#2b3f5a' : '#222',
                borderColor: genre === 'rap' ? '#4a78b7' : '#333'
              }}
            >{t.rap}</button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            
            <button
              onClick={() => router.push(`/fr/${genre}/${dayNumber}`)}
              style={{
                ...buttonStyle,
                background: lang === 'fr' ? '#2b3f5a' : '#222',
                borderColor: lang === 'fr' ? '#4a78b7' : '#333'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <img src="/FR.svg" alt="Drapeau français" style={{ width: 20, height: 14, display: 'block', objectFit: 'contain' }} />
                <span>{t.fr}</span>
              </span>
            </button>
            <button
              onClick={() => router.push(`/en/${genre}/${dayNumber}`)}
              style={{
                ...buttonStyle,
                background: lang === 'en' ? '#2b3f5a' : '#222',
                borderColor: lang === 'en' ? '#4a78b7' : '#333'
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <img src="/EN.svg" alt="Drapeau anglais" style={{ width: 20, height: 14, display: 'block', objectFit: 'contain' }} />
                <span>{t.en}</span>
              </span>
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <button onClick={() => gotoDay(dayNumber - 1)} style={buttonStyle}>{t.prevDay}</button>
            <button onClick={gotoToday} style={buttonStyle}>{t.today}</button>
            <button onClick={() => gotoDay(dayNumber + 1)} disabled={dayNumber >= todayN} style={{ ...buttonStyle, opacity: dayNumber >= todayN ? 0.5 : 1 }}>{t.nextDay}</button>
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
            {round.status === 'won' ? t.won : t.lost}
          </div>
          <div style={{ fontSize: 18, marginTop: 6 }}>
            C'était: <b>{round.answer?.title}</b>  {round.answer?.artist}
          </div>
          {!!round.answer?.id && (
            <div style={{ marginTop: 12, width: '100%', maxWidth: 560 }}>
              <iframe
                title="Deezer Player"
                src={`https://widget.deezer.com/widget/dark/track/${round.answer.id}`}
                width="100%"
                height="90"
                frameBorder="0"
                allow="encrypted-media; clipboard-write"
                style={{ borderRadius: 12, backgroundColor: 'transparent' }}
              />
            </div>
          )}
        </section>
      )}

      <section style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
  <button onClick={togglePlay} style={{ ...buttonStyle, fontSize: 18 }}>{isPlaying ? t.pause : t.listen}</button>
  <button onClick={skipAttempt} style={{ ...buttonStyle }}>{t.skip}</button>
        <div style={{ marginLeft: 8, display: 'flex', alignItems: 'center' }}>
          <span style={attemptCounterStyle} aria-live="polite" aria-atomic="true">{round.attempts.length}/6</span>
        </div>
        <audio ref={audioRef} preload="none" />
      </section>

      <section style={{ marginTop: 8 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
          <span>{formatDuration(0)}</span>
          <span>Extrait: {formatSnippet(snippetLimitClamped)} • Total: {formatDuration(trackLength)}</span>
        </div>
        <div style={{ position: 'relative', height: 12, background: '#1b1b1b', border: '1px solid #333', borderRadius: 999, overflow: 'hidden' }}>
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${(snippetLimitClamped / trackLength) * 100}%`, background: '#2c3f2f'
          }} />
          <div style={{
            position: 'absolute', left: 0, top: 0, bottom: 0,
            width: `${(Math.min(playhead, snippetLimitClamped) / trackLength) * 100}%`, background: '#5ac46a', transition: 'width 80ms linear'
          }} />
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ position: 'relative' }} className="dlm-input-container">
          <input
            className="dlm-input"
            placeholder={isLoading ? `${t.loading}...` : t.placeholder}
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
            <ul className="dlm-suggestions" style={suggestionsBox}>
              {suggestions.map(s => (
                <li key={`${s.id ?? s.title}-${s.artist}`} style={suggestionItem} onClick={() => { setQuery(''); submitGuess(s) }}>
                  {s.title}  <span style={{ opacity: 0.8 }}>{s.artist}</span>
                </li>
              ))}
            </ul>
          )}

          {/* Small CSS for the input bar on mobile */}
          <style>{`
            /* Keep the input visible on small screens and respect safe-area */
            .dlm-input-container { }
            .dlm-input { box-sizing: border-box; }
            .dlm-suggestions { box-sizing: border-box; }

            @media (max-width: 600px) {
              /* Make the input area sticky to bottom so it stays above the on-screen keyboard
                 while keeping it visually consistent. Add safe-area padding on iOS. */
              .dlm-input-container { position: sticky; bottom: 12px; z-index: 60; padding-top: 8px; }
              .dlm-input { padding: 10px 12px !important; font-size: 15px !important; border-radius: 999px !important; }
              .dlm-suggestions { max-height: 40vh !important; margin-bottom: env(safe-area-inset-bottom); border-radius: 12px !important; }
              .dlm-suggestions li { padding-top: 10px !important; padding-bottom: 10px !important; }
              /* Give the page extra bottom padding to avoid content being covered */
              main { padding-bottom: 18vh; }
            }
          `}</style>
        </div>
      </section>

      <section style={{ marginTop: 16 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
          {[...Array(6)].map((_, i) => {
            const txt = round.attempts[i]
              const isSkip = txt === t.skipped
            const expected = round.answer ? `${round.answer.title}  ${round.answer.artist}` : ''
            const isFullCorrect = Boolean(txt) && round.answer && normalize(txt!) === normalize(expected)
            const guessedArtist = txt?.split('  ')[1]?.trim() || ''
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
            {t.hintLabels.map((label, i) => {
            const visible = i <= round.revealIndex
            const h = [
              round.answer?.length ? formatDuration(round.answer.length) : '',
              round.answer?.genre || '',
              round.answer?.year ? String(round.answer?.year) : '',
              round.answer?.album || '',
              round.answer?.artist || '',
            ][i]
            return (
              <li key={i} style={{ ...hintItem, opacity: visible ? 1 : 0.3 }}>
                {label}: {visible ? h : '…'}
              </li>
            )
          })}
        </ul>
      </section>

      <footer style={{ marginTop: 48, textAlign: 'center', opacity: 0.7 }}>
  {t.footer.replace('{day}', String(dayNumber)).replace('{date}', daily.date)}
      </footer>
    </main>
  )
}

export default function Page() {
  return (
    <Suspense fallback={<main style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}><h1 style={{ textAlign: 'center', marginTop: 16 }}>Devine la Musique</h1><div style={{ textAlign: 'center', opacity: 0.7, marginTop: 12 }}>Chargement…</div></main>}>
      <DailyGame />
    </Suspense>
  )
}

// Metadata is handled by head.tsx for now.

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid #333', background: '#1a1a1a', color: '#eee', fontSize: 16,
}
const buttonStyle: React.CSSProperties = { padding: '10px 14px', borderRadius: 12, border: '1px solid #333', background: '#222', color: '#eee', cursor: 'pointer' }
const suggestionsBox: React.CSSProperties = { position: 'absolute', top: '100%', left: 0, right: 0, background: '#1a1a1a', border: '1px solid #333', borderRadius: 12, marginTop: 6, maxHeight: 260, overflowY: 'auto', zIndex: 10 }
const suggestionItem: React.CSSProperties = { padding: '10px 12px', borderBottom: '1px solid #222', cursor: 'pointer' }
const attemptBox: React.CSSProperties = { border: '1px solid #333', minHeight: 44, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#1a1a1a' }
const attemptCounterStyle: React.CSSProperties = {display: 'inline-block',  padding: '8px 12px',  borderRadius: 999,  background: '#163a22',  color: '#cfe9f5',  fontWeight: 800,  fontSize: 18,  lineHeight: 1,  minWidth: 56,  textAlign: 'center',  boxShadow: '0 4px 12px rgba(0,0,0,0.35)'}
const hintItem: React.CSSProperties = { padding: '8px 10px', border: '1px solid #333', borderRadius: 12, background: '#1a1a1a' }
const noticeStyle: React.CSSProperties = { position: 'fixed', left: '50%', bottom: 20, transform: 'translateX(-50%)', zIndex: 9999, padding: '10px 16px', borderRadius: 999, border: '1px solid #2a2a2a', background: 'rgba(20, 34, 42, 0.95)', color: '#cfe9f5', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', maxWidth: '90vw', textAlign: 'center', pointerEvents: 'none' }

// Date utilities

const ORIGIN_UTC = new Date(START_DATE_UTC + 'T00:00:00Z')
function startOfDayUTC(d: Date) {
  const offsetMs = RESET_OFFSET_HOURS * 3600000
  const shifted = new Date(d.getTime() + offsetMs)
  const y = shifted.getUTCFullYear()
  const m = shifted.getUTCMonth()
  const day = shifted.getUTCDate()
  const ms = Date.UTC(y, m, day) - offsetMs
  return new Date(ms)
}
function dateToDayNumber(d: Date): number {
  const date = startOfDayUTC(d)
  const ms = date.getTime() - ORIGIN_UTC.getTime()
  return Math.floor(ms / 86400000) + 1
}
function storageKeyForDay(n: number, lang: 'fr' | 'en', genre: 'all' | 'rap' = 'all') {
  const g = genre === 'rap' ? 'rap' : 'all'
  return `dlm_daily_${lang}_${g}_${n}`
}
