import { NextResponse } from "next/server"
import { createRule, getRules as dbGetRules, createLog, type Rule, updateRule as dbUpdateRule, getRuleById as dbGetRuleById, deleteRule as dbDeleteRule } from "@/lib/db"

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

  await createRule(rule)
  await createLog({
      id: generateId("log"),
      ownerAddress: rule.ownerAddress,
      ruleId: rule.id,
      action: "rule_created",
      details: rule,
      status: "success",
      createdAt: now,
    })

    return NextResponse.json({ id: rule.id, rule }, { status: 201 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const owner = searchParams.get("owner") || undefined
  if (!owner) {
    const rules = await dbGetRules()
    return NextResponse.json({ rules }, { status: 200 })
  }
  const zero = "0x0000000000000000000000000000000000000000"
  const [mine, unassigned] = await Promise.all([dbGetRules(owner), dbGetRules(zero)])
  // newest first
  const rules = [...mine, ...unassigned].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  return NextResponse.json({ rules }, { status: 200 })
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const id = String(body.id || "")
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })

    const allowed: Partial<Rule> = {}
    if (body.status && (body.status === 'active' || body.status === 'paused')) allowed.status = body.status
    if (Array.isArray(body.targets)) allowed.targets = body.targets.map(String)
    if (body.type) allowed.type = String(body.type)
    if (body.rotateTopN != null) allowed.rotateTopN = Number(body.rotateTopN)
    if (body.maxSpendUSD != null) allowed.maxSpendUSD = Number(body.maxSpendUSD)
    if (body.maxSlippage != null) allowed.maxSlippage = Number(body.maxSlippage)
    if (body.cooldownMinutes != null) allowed.cooldownMinutes = Number(body.cooldownMinutes)
    if (body.trigger && typeof body.trigger === 'object') allowed.trigger = body.trigger

  const before = await dbGetRuleById(id)
  const updated = await dbUpdateRule(id, allowed)
    if (!updated) return NextResponse.json({ error: "Rule not found" }, { status: 404 })

    const now = new Date().toISOString()
  await createLog({
      id: generateId('log'),
      ownerAddress: updated.ownerAddress,
      ruleId: id,
      action: 'rule_updated',
      details: { before, after: updated, changes: allowed },
      status: 'success',
      createdAt: now,
    })

    return NextResponse.json({ rule: updated }, { status: 200 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid JSON'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const id = String(searchParams.get('id') || '')
    const owner = String(searchParams.get('owner') || '')
    if (!id || !owner) return NextResponse.json({ error: 'Missing id or owner' }, { status: 400 })

    const existing = await dbGetRuleById(id)
    if (!existing) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    if (existing.ownerAddress.toLowerCase() !== owner.toLowerCase()) {
      return NextResponse.json({ error: 'Not owner' }, { status: 403 })
    }

    const ok = await dbDeleteRule(id, owner)
    if (!ok) return NextResponse.json({ error: 'Delete failed' }, { status: 500 })

    const now = new Date().toISOString()
    await createLog({
      id: generateId('log'),
      ownerAddress: existing.ownerAddress,
      ruleId: id,
      action: 'rule_deleted',
      details: { before: existing },
      status: 'success',
      createdAt: now,
    })

    return NextResponse.json({ ok: true }, { status: 200 })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Invalid request'
    return NextResponse.json({ error: msg }, { status: 400 })
  }
}

type TriggerBody = {
  triggerType?: 'priceDrop' | 'trend' | 'momentum' | string
  dropPercent?: number | string
  trendThreshold?: number | string
  trendWindow?: string
  momentumThreshold?: number | string
  momentumLookback?: number | string
}

function mapTrigger(body: TriggerBody) {
  const t = String(body.triggerType || '')
  if (t === "priceDrop") return { type: "price_drop_pct", value: Number(body.dropPercent ?? 0) }
  if (t === "trend") return { type: "trend_pct", value: Number(body.trendThreshold ?? 0), window: body.trendWindow || "24h" }
  if (t === "momentum") return { type: "momentum", value: Number(body.momentumThreshold ?? 0), lookbackDays: Number(body.momentumLookback ?? 0) }
  return { type: "price_drop_pct", value: 0 }
}

function generateId(prefix: string) {
  const rnd = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now()}_${rnd}`
}
