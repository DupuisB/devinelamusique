import { START_DATE_UTC, RESET_OFFSET_HOURS } from '@/lib/config'
import { NextResponse } from 'next/server'

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
  const ORIGIN_UTC = new Date(START_DATE_UTC + 'T00:00:00Z')
  const date = startOfDayUTC(d)
  const ms = date.getTime() - ORIGIN_UTC.getTime()
  return Math.floor(ms / 86400000) + 1
}

export async function GET() {
  const host = 'https://devinelamusique.fr'
  const todayN = dateToDayNumber(new Date())
  const locales = ['fr', 'en']
  const genres = ['all', 'rap']

  let urls: string[] = []
  for (const lang of locales) {
    for (const genre of genres) {
      for (let n = 1; n <= todayN; n++) {
        urls.push(`${host}/${lang}/${genre}/${n}`)
      }
    }
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map(u => `  <url><loc>${u}</loc></url>`)
    .join('\n')}\n</urlset>`

  return new NextResponse(sitemap, {
    headers: { 'Content-Type': 'application/xml' }
  })
}
