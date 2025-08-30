import { NextResponse } from 'next/server'
import { START_DATE_UTC, RESET_OFFSET_HOURS } from '@/lib/config'

export const dynamic = 'force-dynamic'

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

export async function GET(request: Request) {
	const url = new URL(request.url)
	const today = dateToDayNumber(new Date())
	const langParam = url.searchParams.get('lang') || 'fr'
	const lang = langParam === 'en' ? 'en' : 'fr'
	const genre = (url.searchParams.get('genre') || '').toLowerCase() === 'rap' ? 'rap' : 'all'
	const qp = genre === 'all' ? '' : `?genre=${genre}`
	return NextResponse.redirect(new URL(`/${lang}/${today}${qp}`, url.origin), 308)
}
