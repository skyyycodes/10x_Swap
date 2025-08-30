import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const token = url.searchParams.get('token') || undefined
    const required = process.env.CRON_SECRET || process.env.MIGRATE_SECRET || undefined
    if (required && token !== required) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const driver = (process.env.DB_DRIVER || '').toLowerCase()
    if (driver !== 'turso' && driver !== 'libsql') {
      return NextResponse.json({ ok: true, message: 'SQLite driver selected. No remote migration required.' })
    }
    const { tursoDriver } = await import('@/lib/db/turso')
    await tursoDriver.migrate()
    return NextResponse.json({ ok: true, message: 'Migration completed' })
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'Migration failed' }, { status: 500 })
  }
}
