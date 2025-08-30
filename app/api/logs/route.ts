import { NextResponse } from "next/server"
import { getLogs } from "@/lib/db"

export const runtime = 'nodejs'

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const owner = searchParams.get("owner") || undefined
  const logs = await getLogs(owner)
  return NextResponse.json({ logs }, { status: 200 })
}
