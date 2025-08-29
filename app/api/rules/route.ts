import { NextResponse } from "next/server"
import { appendLog, generateId, getAllRules, getRulesByOwner, saveRule, type StoredRule } from "@/lib/server/storage"

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const now = new Date().toISOString()
    // Map incoming flexible payload to StoredRule shape
    const rule: StoredRule = {
      id: generateId("rule"),
      ownerAddress: body.ownerAddress || "0x0000000000000000000000000000000000000000",
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
  const rules = owner ? await getRulesByOwner(owner) : await getAllRules()
  return NextResponse.json({ rules }, { status: 200 })
}

function mapTrigger(body: any) {
  if (body.triggerType === "priceDrop") return { type: "price_drop_pct", value: Number(body.dropPercent || 0) }
  if (body.triggerType === "trend") return { type: "trend_pct", value: Number(body.trendThreshold || 0), window: body.trendWindow || "24h" }
  if (body.triggerType === "momentum") return { type: "momentum", value: Number(body.momentumThreshold || 0), lookbackDays: Number(body.momentumLookback || 0) }
  return { type: "price_drop_pct", value: 0 }
}
