import { NextResponse } from "next/server"
import { appendLog, generateId, getAllRules, getRulesByOwner, saveRule, updateRule, type StoredRule } from "@/lib/server/storage"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    // Map incoming flexible payload to StoredRule shape
    const rule: StoredRule = {
      id: generateId("rule"),
      ownerAddress: body.ownerAddress,
      type: (body.type || "rebalance").toLowerCase(),
      targets: Array.isArray(body.targets) ? body.targets : body.coins || [],
      rotateTopN: body.rotateTopN,
      maxSpendUSD: Number(body.maxSpendUSD ?? body.maxSpendUsd ?? 0),
      maxSlippage: Number(body.maxSlippage ?? body.maxSlippagePercent ?? 0),
      trigger: body.trigger || mapTrigger(body),
      cooldownMinutes: Number(body.cooldownMinutes ?? 0),
      status: (body.status || "active").toLowerCase(),
      createdAt: now,
    }
    if (!rule.ownerAddress) {
      return NextResponse.json({ error: "Missing ownerAddress (connect wallet)" }, { status: 400 })
    }
    await saveRule(rule)
    await appendLog({
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
  const owner = searchParams.get("owner")
  if (!owner) {
    return NextResponse.json({ error: "Missing owner query param", rules: [] }, { status: 400 })
  }
  const rules = await getRulesByOwner(owner)
  return NextResponse.json({ rules }, { status: 200 })
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json()
    const { id, ...changes } = body || {}
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 })
    const updated = await updateRule(id, changes)
    if (!updated) return NextResponse.json({ error: "Rule not found" }, { status: 404 })
    await appendLog({
      id: generateId("log"),
      ownerAddress: updated.ownerAddress,
      ruleId: updated.id,
      action: "rule_updated",
      details: changes,
      status: "success",
      createdAt: new Date().toISOString(),
    })
    return NextResponse.json({ rule: updated }, { status: 200 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Invalid JSON" }, { status: 400 })
  }
}

function mapTrigger(body: any) {
  if (body.triggerType === "priceDrop") return { type: "price_drop_pct", value: Number(body.dropPercent || 0) }
  if (body.triggerType === "trend") return { type: "trend_pct", value: Number(body.trendThreshold || 0), window: body.trendWindow || "24h" }
  if (body.triggerType === "momentum") return { type: "momentum", value: Number(body.momentumThreshold || 0), lookbackDays: Number(body.momentumLookback || 0) }
  return { type: "price_drop_pct", value: 0 }
}
