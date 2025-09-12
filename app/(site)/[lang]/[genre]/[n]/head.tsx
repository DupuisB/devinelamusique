import type { Metadata } from 'next'
import { headers } from 'next/headers'

type DailyApi = { song?: { title: string; artist: string }, n: number, date: string }

export default async function Head({ params }: { params: { lang: string; genre: string; n: string } }) {
  const lang = params.lang === 'en' ? 'en' : 'fr'
  const genre = params.genre || 'all'
  const n = params.n || ''
  const host = 'https://devinelamusique.fr'

  // fetch the same data the page uses
  let daily: DailyApi | null = null
  try {
    const res = await fetch(`${host}/api/daily?` + new URLSearchParams({ n, lang, genre }), { cache: 'no-store' })
    if (res.ok) daily = await res.json()
  } catch {}

  const title = daily?.song ? `${daily.song.title} — ${daily.song.artist} · Devine la Musique` : (lang === 'en' ? 'Guess the Song · Devine la Musique' : 'Devine la Musique')
  const description = daily?.song ? `Guess the song for day #${daily.n} (${daily.date}). Play a short snippet and try to name the title & artist.` : (lang === 'en' ? 'Guess the song of the day. Play a short snippet and try to name the title & artist.' : "Joue l'extrait et devine le titre et l'artiste.")

  const url = `${host}/${lang}/${genre}/${n}`

  return (
    <>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={url} />

      {/* Open Graph */}
      <meta property="og:site_name" content="Devine la Musique" />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={url} />
      <meta property="og:type" content="website" />
      <meta property="og:locale" content={lang === 'en' ? 'en_US' : 'fr_FR'} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />

      {/* Hreflang alternates */}
      <link rel="alternate" href={`${host}/fr/${genre}/${n}`} hrefLang="fr" />
      <link rel="alternate" href={`${host}/en/${genre}/${n}`} hrefLang="en" />
      <link rel="alternate" href={`${host}/all/${genre}/${n}`} hrefLang="x-default" />
    </>
  )
}
