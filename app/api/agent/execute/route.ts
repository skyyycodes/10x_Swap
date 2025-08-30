import { NextResponse } from "next/server"
import { getRuleById, createLog, type LogEntry } from "@/lib/db"
import { getAgent } from "@/lib/agent"
import { resolveTokenByCoinrankingId } from "@/lib/tokens"

export const runtime = "nodejs"

async function fetchPrice(baseUrl: string, coinId: string): Promise<number | null> {
  try {
    const res = await fetch(`${baseUrl}/api/price?coin=${encodeURIComponent(coinId)}`, { cache: 'no-store' })
    if (!res.ok) return null
  const data = (await res.json().catch(() => null)) as unknown
  const p = (typeof data === 'object' && data !== null && 'price' in data)
    ? (data as { price?: unknown }).price
    : (typeof data === 'object' && data !== null && 'data' in data && typeof (data as any).data === 'object' && (data as any).data !== null && 'price' in (data as any).data)
      ? (data as { data?: { price?: unknown } }).data?.price
      : undefined
    const n = Number(p)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    return null
  }
}

function getBaseUrl(req: Request) {
  const host = req.headers.get('host') || 'localhost:3000'
  const isLocal = host.includes('localhost') || host.startsWith('127.0.0.1')
  const protocol = isLocal ? 'http' : 'https'
  return `${protocol}://${host}`
}

function generateId(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now()}_${rnd}`
}


export async function POST(req: Request) {
  try {
  const body = (await req.json().catch(() => ({}))) as unknown
  const ruleId = (typeof body === 'object' && body && 'ruleId' in body) ? (body as { ruleId?: string }).ruleId : undefined
    if (!ruleId || typeof ruleId !== 'string') {
      return NextResponse.json({ error: 'Missing ruleId' }, { status: 400 })
    }

  const rule = await getRuleById(ruleId)
    if (!rule) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const baseUrl = getBaseUrl(req)
    const targets: string[] = Array.isArray(rule.targets) ? rule.targets : []
    const spendTotal = Number(rule.maxSpendUSD ?? 0)
    const perLegSpend = targets.length > 0 ? spendTotal / targets.length : 0

    const prices: Record<string, number | null> = {}
    await Promise.all(targets.map(async (coinId) => { prices[coinId] = await fetchPrice(baseUrl, coinId) }))

    const legs = targets.map((coinId) => {
      const token = resolveTokenByCoinrankingId(coinId)
      const price = prices[coinId]
      const qty = price && price > 0 ? perLegSpend / price : 0
      return { coinId, symbol: token?.symbol ?? null, side: 'buy' as const, price: price ?? 0, qty, spendUSD: perLegSpend }
    })
    const plan = { totalSpendUSD: spendTotal, legs }

    let txHash: string | undefined
    let txStatus: 'submitted' | 'simulated' = 'simulated'
  try {
      const agent = await getAgent()
      const first = legs[0]
      if (first && first.price > 0 && first.qty > 0) {
        const outSymbol = first.symbol || first.coinId // fall back to coinId string if symbol unknown
        const amountStr = String(first.qty)
  const result = await agent.smartSwap({ tokenInSymbol: 'ETH', tokenOutSymbol: outSymbol, amount: amountStr, slippage: rule.maxSlippage ?? 0.5 })
  txHash = (typeof result === 'object' && result && 'hash' in result) ? (result as { hash?: string }).hash : undefined
        txStatus = 'submitted'
      }
    } catch {
      txStatus = 'simulated'
    }

    const now = new Date().toISOString()
    const log: LogEntry = {
      id: generateId('log'),
      ownerAddress: rule.ownerAddress,
      ruleId: rule.id,
      action: 'execute_rule',
      details: { rule, prices, plan, txHash, txStatus },
      status: 'success',
      createdAt: now,
    }
  await createLog(log)

    return NextResponse.json({ success: true, logEntry: log }, { status: 200 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Execution failed'
    return NextResponse.json({ success: false, error: msg }, { status: 500 })
  }
}
