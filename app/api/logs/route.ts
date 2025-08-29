import { NextResponse } from "next/server"
import { getAllLogs } from "@/lib/server/storage"

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const owner = searchParams.get("owner")
  const logs = await getAllLogs()
  const filtered = owner
    ? logs.filter((l) => l.ownerAddress.toLowerCase() === owner.toLowerCase())
    : logs
  return NextResponse.json({ logs: filtered }, { status: 200 })
}
