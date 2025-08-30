import { NextResponse } from 'next/server'

// Root route removed — return 404 to avoid automatic redirect here.
export async function GET() {
  return new NextResponse('Not Found', { status: 404 })
}
