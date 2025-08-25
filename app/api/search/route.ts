import { NextRequest } from 'next/server'

type Suggestion = {
  id: number
  title: string
  artist: string
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const q = (searchParams.get('q') || '').trim()
  const limit = Math.min(Number(searchParams.get('limit') || 10), 20)
  if (!q || q.length < 2) {
    return new Response(JSON.stringify({ suggestions: [] as Suggestion[] }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${limit}`, { cache: 'no-store' })
    const json = await res.json()
    const data: any[] = json?.data || []
    const suggestions: Suggestion[] = data.map((t) => ({ id: t.id, title: t.title || t.title_short, artist: t.artist?.name })).filter(s => s.title && s.artist)
    return new Response(JSON.stringify({ suggestions }), { headers: { 'content-type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ suggestions: [] as Suggestion[] }), { headers: { 'content-type': 'application/json' }, status: 200 })
  }
}
