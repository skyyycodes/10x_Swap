"use client"

import { useEffect, useMemo, useState } from "react"
import { useAccount } from "wagmi"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useToast } from "@/components/ui/use-toast"

type Rule = {
  id: string
  ownerAddress: string
  type: string
  targets: string[]
  rotateTopN?: number
  maxSpendUSD: number
  maxSlippage: number
  trigger: any
  cooldownMinutes: number
  status: "active" | "paused"
  createdAt: string
}

type Log = {
  id: string
  ownerAddress: string
  ruleId?: string
  action: string
  details?: any
  status: "simulated" | "success" | "failed"
  createdAt: string
}

function formatTrigger(t: any) {
  if (!t) return "—"
  if (t.type === "price_drop_pct") return `Price drop ≥ ${t.value}%`
  if (t.type === "trend_pct") return `Trend ≥ ${t.value}% (${t.window || "24h"})`
  if (t.type === "momentum") return `Momentum ≥ ${t.value}% (${t.lookbackDays}d)`
  return JSON.stringify(t)
}

export default function AgentDashboardPage() {
  const { address } = useAccount()
  const { toast } = useToast()
  const [rules, setRules] = useState<Rule[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [preview, setPreview] = useState<Log | null>(null)
  const [seenLogIds, setSeenLogIds] = useState<Set<string>>(new Set())

  async function fetchData(owner: string) {
    setLoading(true)
    try {
      const [rRes, lRes] = await Promise.all([
        fetch(`/api/rules?owner=${owner}`, { cache: "no-store" }),
        fetch(`/api/logs?owner=${owner}`, { cache: "no-store" }),
      ])
      const rJson = await rRes.json()
      const lJson = await lRes.json()
      setRules(rJson.rules || [])
      const newLogs: Log[] = lJson.logs || []
      // Detect new execution logs and toast
      const prev = seenLogIds
      const newlySeen = new Set(prev)
      for (const log of newLogs) {
        if (!newlySeen.has(log.id)) {
          newlySeen.add(log.id)
          if (log.action === "trade_execute") {
            const simulated = log.status === "simulated"
            const tx = (log.details?.result?.txHash as string | undefined)
            toast({
              title: simulated ? "Simulated trade executed" : "Gasless trade executed",
              description: tx ? `Tx: ${tx.slice(0, 10)}…${tx.slice(-6)}` : undefined,
            })
          } else if (log.action === "preview_trade") {
            toast({ title: "Rule triggered (preview)", description: `Rule ${log.ruleId?.slice(-8)}` })
          }
        }
      }
      setSeenLogIds(newlySeen)
      setLogs(newLogs)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // When disconnected, clear state and do not fetch
    if (!address) {
      setRules([])
      setLogs([])
      setSeenLogIds(new Set())
      return
    }
    fetchData(address)
    // poll logs every 10s for updates
    const t = setInterval(() => fetchData(address), 10000)
    return () => clearInterval(t)
  }, [address])

  async function pauseResume(rule: Rule, to: "active" | "paused") {
    const res = await fetch("/api/rules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: rule.id, status: to }) })
    if (res.ok) {
      toast({ title: `Rule ${to === "active" ? "resumed" : "paused"}` })
  if (address) fetchData(address)
    }
  }

  async function forceRun() {
    const res = await fetch("/api/poller", { method: "POST" })
    if (res.ok) {
      const data = await res.json()
      const count = (data.triggered || []).length
      toast({ title: `Poller ran`, description: `${count} rule(s) triggered.` })
  if (address) fetchData(address)
    }
  }

  const lastRunByRule = useMemo(() => {
    const map = new Map<string, Log>()
    for (const log of logs) {
      if (!log.ruleId) continue
      if (!map.has(log.ruleId)) map.set(log.ruleId, log)
    }
    return map
  }, [logs])

  function nextCheck(rule: Rule) {
    const last = lastRunByRule.get(rule.id)
    if (!rule.cooldownMinutes) return "any moment"
    const lastTime = last ? new Date(last.createdAt).getTime() : 0
    const nextTs = lastTime ? lastTime + rule.cooldownMinutes * 60_000 : Date.now()
    return new Date(nextTs).toLocaleTimeString()
  }

  return (
    <div className="container mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Agent Dashboard</h1>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => address && fetchData(address)} disabled={loading || !address}>Refresh</Button>
          <Button onClick={forceRun} disabled={!address}>Force run</Button>
        </div>
      </div>

      {!address && (
        <Card>
          <CardHeader>
            <CardTitle>Your rules</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Connect your wallet to view and manage your agent rules.</p>
          </CardContent>
        </Card>
      )}

      {address && (
      <Card>
        <CardHeader>
          <CardTitle>Active Rules</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Limits</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead>Next check</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rules.map((r) => {
                const last = lastRunByRule.get(r.id)
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.id.slice(-8)}</TableCell>
                    <TableCell>
                      <Badge variant={r.status === "active" ? "default" : "secondary"}>{r.status}</Badge>
                    </TableCell>
                    <TableCell className="uppercase">{r.type}</TableCell>
                    <TableCell>{r.targets?.slice(0,3).join(", ")}{r.targets?.length>3?` +${r.targets.length-3}`:""}</TableCell>
                    <TableCell>{formatTrigger(r.trigger)}</TableCell>
                    <TableCell className="text-sm">${r.maxSpendUSD} • slip {r.maxSlippage}%</TableCell>
                    <TableCell className="text-xs">{last ? new Date(last.createdAt).toLocaleString() : "—"}</TableCell>
                    <TableCell className="text-xs">{nextCheck(r)}</TableCell>
                    <TableCell className="flex gap-2">
                      {r.status === "active" ? (
                        <Button size="sm" variant="outline" onClick={() => pauseResume(r, "paused")}>Pause</Button>
                      ) : (
                        <Button size="sm" variant="outline" onClick={() => pauseResume(r, "active")}>Resume</Button>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
  )}

  {address && (
  <Card>
        <CardHeader>
          <CardTitle>Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {logs.map((l) => (
              <div key={l.id} className="flex items-start justify-between gap-4 border rounded-md p-3">
                <div className="space-y-1">
                  <div className="text-sm"><span className="font-medium">{l.action}</span> • <span className="text-xs opacity-70">{new Date(l.createdAt).toLocaleString()}</span></div>
                  {l.ruleId && <div className="text-xs text-muted-foreground">Rule: {l.ruleId.slice(-8)}</div>}
                  {l.details && (
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button size="sm" variant="secondary">Preview</Button>
                      </DialogTrigger>
                      <DialogContent className="max-w-2xl">
                        <DialogHeader>
                          <DialogTitle>Log Preview</DialogTitle>
                        </DialogHeader>
                        <pre className="text-xs whitespace-pre-wrap break-words max-h-[60vh] overflow-auto">
                          {JSON.stringify(l.details, null, 2)}
                        </pre>
                      </DialogContent>
                    </Dialog>
                  )}
                </div>
                <Badge variant={l.status === "failed" ? "destructive" : l.status === "success" ? "default" : "secondary"}>{l.status}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
  )}
    </div>
  )
}
