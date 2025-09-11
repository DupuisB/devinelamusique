import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { START_DATE_UTC, RESET_OFFSET_HOURS } from './lib/config'

export const config = {
  matcher: ['/', '/:lang(fr|en)/:day([0-9]+)', '/:lang(fr|en)/:day([0-9]+)/:path*', '/:lang(fr|en)/:genre*/:day([0-9]+)']
}

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

export function middleware(req: NextRequest) {
  const today = dateToDayNumber(new Date())
  const url = new URL(req.url)
  const path = url.pathname
  
  // Handle root redirect
  if (path === '/') {
    const langParam = url.searchParams.get('lang') || 'fr'
    const lang = langParam === 'en' ? 'en' : 'fr'
    const genre = (url.searchParams.get('genre') || '').toLowerCase() === 'rap' ? 'rap' : 'all'

    // Prefer forwarded host/proto set by proxies (Heroku, Cloudflare, etc.)
    const forwardedHost = req.headers.get('x-forwarded-host')
    const host = forwardedHost || req.headers.get('host') || ''
    const proto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https'

    // If host isn't present, use a relative redirect so Next.js resolves it from the current request
    if (!host) return NextResponse.redirect(`/${lang}/${genre}/${today}`, 308)

    const destination = `${proto}://${host}/${lang}/${genre}/${today}`
    return NextResponse.redirect(destination, 308)
  }

  // Handle legacy URLs with genre as query parameter: /fr/123?genre=rap -> /fr/rap/123
  const legacyMatch = path.match(/^\/([a-z]{2})\/(\d+)$/)
  if (legacyMatch && url.searchParams.has('genre')) {
    const [, lang, day] = legacyMatch
    const genre = (url.searchParams.get('genre') || '').toLowerCase() === 'rap' ? 'rap' : 'all'
    
    const forwardedHost = req.headers.get('x-forwarded-host')
    const host = forwardedHost || req.headers.get('host') || ''
    const proto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https'

    if (!host) return NextResponse.redirect(`/${lang}/${genre}/${day}`, 308)

    const destination = `${proto}://${host}/${lang}/${genre}/${day}`
    return NextResponse.redirect(destination, 308)
  }

  // Handle URLs with invalid genre: /fr/invalidgenre/123 -> /fr/all/123
  const genreMatch = path.match(/^\/([a-z]{2})\/([^\/]+)\/(\d+)$/)
  if (genreMatch) {
    const [, lang, genre, day] = genreMatch
    // If genre is not 'rap' or 'all', redirect to 'all'
    if (genre !== 'rap' && genre !== 'all') {
      const forwardedHost = req.headers.get('x-forwarded-host')
      const host = forwardedHost || req.headers.get('host') || ''
      const proto = req.headers.get('x-forwarded-proto') || req.headers.get('x-forwarded-protocol') || 'https'

      if (!host) return NextResponse.redirect(`/${lang}/all/${day}`, 308)

      const destination = `${proto}://${host}/${lang}/all/${day}`
      return NextResponse.redirect(destination, 308)
    }
  }

  // For valid new URLs (like /fr/rap/123), continue normally
  return NextResponse.next()
}
