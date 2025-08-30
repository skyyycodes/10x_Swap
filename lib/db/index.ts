import { sqliteDriver, type Rule as SRule, type LogEntry as SLog } from './sqlite'
// Turso is optional; import lazily
let turso: any = null
try { turso = require('./turso') } catch {}

export type Rule = SRule
export type LogEntry = SLog

function pickDriver() {
  const driver = (process.env.DB_DRIVER || '').toLowerCase()
  if (driver === 'turso' || driver === 'libsql') {
    if (!turso?.tursoDriver) throw new Error('Turso driver selected but not available')
    return turso.tursoDriver
  }
  return sqliteDriver
}

let initPromise: Promise<void> | null = null
async function ensureInit() {
  if (initPromise) return initPromise
  const driver = (process.env.DB_DRIVER || '').toLowerCase()
  if (driver === 'turso' || driver === 'libsql') {
    if (turso?.tursoDriver?.migrate) {
      initPromise = turso.tursoDriver.migrate().catch((e: any) => {
        // If migration fails due to permissions or existing tables, continue
        console.warn('DB migrate warning:', e?.message || e)
      }).then(() => {})
    } else {
      initPromise = Promise.resolve()
    }
  } else {
    initPromise = Promise.resolve()
  }
  return initPromise
}

export async function createRule(rule: Rule): Promise<Rule> { await ensureInit(); return pickDriver().createRule(rule) }
export async function getRules(ownerAddress?: string): Promise<Rule[]> { await ensureInit(); return pickDriver().getRules(ownerAddress) }
export async function getRuleById(id: string): Promise<Rule | null> { await ensureInit(); return pickDriver().getRuleById(id) }
export async function createLog(log: LogEntry): Promise<LogEntry> { await ensureInit(); return pickDriver().createLog(log) }
export async function getLogs(ownerAddress?: string): Promise<LogEntry[]> { await ensureInit(); return pickDriver().getLogs(ownerAddress) }
export async function updateRule(id: string, changes: Partial<Rule>): Promise<Rule | null> { await ensureInit(); return pickDriver().updateRule(id, changes) }
export async function deleteRule(id: string, ownerAddress: string): Promise<boolean> { await ensureInit(); return pickDriver().deleteRule(id, ownerAddress) }
