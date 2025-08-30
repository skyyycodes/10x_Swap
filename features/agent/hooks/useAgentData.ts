// features/agent/hooks/useAgentData.ts
'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchLogs, fetchRules, runPoller, updateRule } from '../api/client'
import type { Log, Rule } from '@/lib/shared/rules'

export function useAgentData(owner?: string) {
  const [rules, setRules] = useState<Rule[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(false)
  const [seenLogIds, setSeenLogIds] = useState<Set<string>>(new Set())

  async function refresh() {
    if (!owner) return
    setLoading(true)
    try {
      const [r, l] = await Promise.all([fetchRules(owner), fetchLogs(owner)])
      setRules(r)
      setLogs(l)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!owner) {
      setRules([])
      setLogs([])
      setSeenLogIds(new Set())
      return
    }
    refresh()
    const t = setInterval(refresh, 10000)
    return () => clearInterval(t)
  }, [owner])

  async function setRuleStatus(rule: Rule, status: 'active' | 'paused') {
    const updated = await updateRule(rule.id, { status })
    setRules((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
  }

  const lastRunByRule = useMemo(() => {
    const map = new Map<string, Log>()
    for (const log of logs) {
      if (!log.ruleId) continue
      if (!map.has(log.ruleId)) map.set(log.ruleId, log)
    }
    return map
  }, [logs])

  return { rules, logs, loading, refresh, setRuleStatus, lastRunByRule, seenLogIds, setSeenLogIds }
}

export async function forceRunPoller() {
  const res = await runPoller()
  return res
}
