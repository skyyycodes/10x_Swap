import { NextResponse } from "next/server"
import { createRule, getRules as dbGetRules, createLog, type Rule } from "@/lib/db"

export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    // Basic validation and normalization
    const ownerAddress = (body.ownerAddress || "0x0000000000000000000000000000000000000000").toString()
    const type = (body.type || "rebalance").toString()
    const targets = Array.isArray(body.targets) ? body.targets.map(String) : []
    const trigger = body.trigger && typeof body.trigger === "object" ? body.trigger : mapTrigger(body)
    const maxSpendUSD = Number(body.maxSpendUSD ?? 0)
    const maxSlippage = Number(body.maxSlippage ?? 0)
    const cooldownMinutes = Number(body.cooldownMinutes ?? 0)
    if (!ownerAddress || !type) {
      return NextResponse.json({ error: "ownerAddress and type are required" }, { status: 400 })
    }

    const now = new Date().toISOString()
    const rule: Rule = {
      id: generateId("rule"),
      ownerAddress,
      type,
      targets,
      rotateTopN: body.rotateTopN != null ? Number(body.rotateTopN) : undefined,
      maxSpendUSD,
      maxSlippage,
      trigger,
      cooldownMinutes,
      status: (body.status || "active").toString(),
      createdAt: now,
    }

    createRule(rule)
    createLog({
      id: generateId("log"),
      ownerAddress: rule.ownerAddress,
      ruleId: rule.id,
      action: "rule_created",
      details: rule,
      status: "success",
      createdAt: now,
    })

    return NextResponse.json({ id: rule.id, rule }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid JSON" }, { status: 400 })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const owner = searchParams.get("owner") || undefined
  if (!owner) {
    const rules = dbGetRules()
    return NextResponse.json({ rules }, { status: 200 })
  }
  const zero = "0x0000000000000000000000000000000000000000"
  const mine = dbGetRules(owner)
  const unassigned = dbGetRules(zero)
  // newest first
  const rules = [...mine, ...unassigned].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return NextResponse.json({ rules }, { status: 200 })
}

// Note: PATCH/update not implemented in DB-backed version yet.

function mapTrigger(body: any) {
  if (body.triggerType === "priceDrop") return { type: "price_drop_pct", value: Number(body.dropPercent || 0) }
  if (body.triggerType === "trend") return { type: "trend_pct", value: Number(body.trendThreshold || 0), window: body.trendWindow || "24h" }
  if (body.triggerType === "momentum") return { type: "momentum", value: Number(body.momentumThreshold || 0), lookbackDays: Number(body.momentumLookback || 0) }
  return { type: "price_drop_pct", value: 0 }
}

function generateId(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now()}_${rnd}`
}
