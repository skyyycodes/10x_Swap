import 'server-only'
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

// SQLite file under data/
const DB_DIR = path.join(process.cwd(), 'data')
const DB_PATH = path.join(DB_DIR, 'db.sqlite')

// Ensure data directory exists
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

// Open database (shared cache, WAL mode for better concurrency)
const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// Simple migrations: create tables if missing
// We also keep a tiny meta table to allow future migrations
const MIGRATIONS = [`
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT
  );
`, `
  CREATE TABLE IF NOT EXISTS rules (
    id TEXT PRIMARY KEY,
    ownerAddress TEXT NOT NULL,
    type TEXT NOT NULL,
    targets TEXT NOT NULL,           -- JSON string array
    rotateTopN INTEGER,
    maxSpendUSD REAL,
    maxSlippage REAL,
    trigger TEXT,                    -- JSON object
    cooldownMinutes INTEGER,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
`, `
  CREATE TABLE IF NOT EXISTS logs (
    id TEXT PRIMARY KEY,
    ownerAddress TEXT NOT NULL,
    ruleId TEXT,
    action TEXT NOT NULL,
    details TEXT,                    -- JSON object
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(ruleId) REFERENCES rules(id)
  );
`]

for (const sql of MIGRATIONS) db.exec(sql)

// Seed from existing JSON files on first run (if tables are empty)
try {
  const hasRules = db.prepare('SELECT 1 FROM rules LIMIT 1').get()
  if (!hasRules) {
    const rulesJsonPath = path.join(DB_DIR, 'rules.json')
    if (fs.existsSync(rulesJsonPath)) {
      const json = fs.readFileSync(rulesJsonPath, 'utf8')
      const arr = JSON.parse(json || '[]') as any[]
      const insert = db.prepare(`INSERT OR IGNORE INTO rules (id, ownerAddress, type, targets, rotateTopN, maxSpendUSD, maxSlippage, trigger, cooldownMinutes, status, createdAt)
        VALUES (@id, @ownerAddress, @type, @targets, @rotateTopN, @maxSpendUSD, @maxSlippage, @trigger, @cooldownMinutes, @status, @createdAt)`)
      const tx = db.transaction((rows: any[]) => {
        for (const r of rows) insert.run(toDbRule(r as Rule))
      })
      tx(arr)
    }
  }
  const hasLogs = db.prepare('SELECT 1 FROM logs LIMIT 1').get()
  if (!hasLogs) {
    const logsJsonPath = path.join(DB_DIR, 'logs.json')
    if (fs.existsSync(logsJsonPath)) {
      const json = fs.readFileSync(logsJsonPath, 'utf8')
      const arr = JSON.parse(json || '[]') as any[]
      const insert = db.prepare(`INSERT OR IGNORE INTO logs (id, ownerAddress, ruleId, action, details, status, createdAt)
        VALUES (@id, @ownerAddress, @ruleId, @action, @details, @status, @createdAt)`)
      const tx = db.transaction((rows: any[]) => {
        for (const l of rows) insert.run(toDbLog(l as LogEntry))
      })
      tx(arr)
    }
  }
} catch {
  // best-effort seed; ignore errors
}

// Types reflecting JSON structure
export type Rule = {
  id: string
  ownerAddress: string
  type: string
  targets: string[]
  rotateTopN?: number
  maxSpendUSD?: number
  maxSlippage?: number
  trigger?: Record<string, any>
  cooldownMinutes?: number
  status: string
  createdAt: string
}

export type LogEntry = {
  id: string
  ownerAddress: string
  ruleId?: string
  action: string
  details?: Record<string, any>
  status: string
  createdAt: string
}

function toDbRule(rule: Rule) {
  return {
    id: rule.id,
    ownerAddress: rule.ownerAddress,
    type: rule.type,
    targets: JSON.stringify(rule.targets ?? []),
    rotateTopN: rule.rotateTopN ?? null,
    maxSpendUSD: rule.maxSpendUSD ?? null,
    maxSlippage: rule.maxSlippage ?? null,
    trigger: rule.trigger ? JSON.stringify(rule.trigger) : null,
    cooldownMinutes: rule.cooldownMinutes ?? null,
    status: rule.status,
    createdAt: rule.createdAt,
  }
}

function fromDbRule(row: any): Rule {
  return {
    id: row.id,
    ownerAddress: row.ownerAddress,
    type: row.type,
    targets: safeParseArray(row.targets),
    rotateTopN: nOrU(row.rotateTopN),
    maxSpendUSD: nOrU(row.maxSpendUSD),
    maxSlippage: nOrU(row.maxSlippage),
    trigger: safeParseObj(row.trigger),
    cooldownMinutes: nOrU(row.cooldownMinutes),
    status: row.status,
    createdAt: row.createdAt,
  }
}

function toDbLog(log: LogEntry) {
  return {
    id: log.id,
    ownerAddress: log.ownerAddress,
    ruleId: log.ruleId ?? null,
    action: log.action,
    details: log.details ? JSON.stringify(log.details) : null,
    status: log.status,
    createdAt: log.createdAt,
  }
}

function fromDbLog(row: any): LogEntry {
  return {
    id: row.id,
    ownerAddress: row.ownerAddress,
    ruleId: row.ruleId ?? undefined,
    action: row.action,
    details: safeParseObj(row.details),
    status: row.status,
    createdAt: row.createdAt,
  }
}

function safeParseArray(v: any): any[] {
  if (!v) return []
  try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : [] } catch { return [] }
}
function safeParseObj(v: any): Record<string, any> | undefined {
  if (!v) return undefined
  try { const x = JSON.parse(String(v)); return (x && typeof x === 'object') ? x : undefined } catch { return undefined }
}
function nOrU(v: any): number | undefined {
  return v === null || v === undefined ? undefined : Number(v)
}

// Prepared statements
const insertRuleStmt = db.prepare(`
  INSERT INTO rules (id, ownerAddress, type, targets, rotateTopN, maxSpendUSD, maxSlippage, trigger, cooldownMinutes, status, createdAt)
  VALUES (@id, @ownerAddress, @type, @targets, @rotateTopN, @maxSpendUSD, @maxSlippage, @trigger, @cooldownMinutes, @status, @createdAt)
`)

const selectRulesStmt = db.prepare(`
  SELECT * FROM rules
  WHERE (@ownerAddress IS NULL OR ownerAddress = @ownerAddress)
  ORDER BY datetime(createdAt) DESC
`)

const selectRuleByIdStmt = db.prepare(`
  SELECT * FROM rules WHERE id = ?
`)

const insertLogStmt = db.prepare(`
  INSERT INTO logs (id, ownerAddress, ruleId, action, details, status, createdAt)
  VALUES (@id, @ownerAddress, @ruleId, @action, @details, @status, @createdAt)
`)

const selectLogsStmt = db.prepare(`
  SELECT * FROM logs
  WHERE (@ownerAddress IS NULL OR ownerAddress = @ownerAddress)
  ORDER BY datetime(createdAt) DESC
`)

// Public API
export function createRule(rule: Rule): Rule {
  insertRuleStmt.run(toDbRule(rule))
  return rule
}

export function getRules(ownerAddress?: string): Rule[] {
  const rows = selectRulesStmt.all({ ownerAddress: ownerAddress ?? null })
  return rows.map(fromDbRule)
}

export function getRuleById(id: string): Rule | null {
  const row = selectRuleByIdStmt.get(id)
  return row ? fromDbRule(row) : null
}

export function createLog(log: LogEntry): LogEntry {
  insertLogStmt.run(toDbLog(log))
  return log
}

export function getLogs(ownerAddress?: string): LogEntry[] {
  const rows = selectLogsStmt.all({ ownerAddress: ownerAddress ?? null })
  return rows.map(fromDbLog)
}

// Expose db for debugging (not recommended to use elsewhere)
export { db as _db }
