// Hint for Next.js to keep this server-only; ignore when running as a plain Node script
try { require('server-only') } catch {}
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

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

// Resolve app data directory (for seeds bundled in the repo)
const APP_DATA_DIR = path.join(process.cwd(), 'data')

// Choose a writable DB directory
const isServerlessProd = !!process.env.VERCEL || (process.env.NODE_ENV === 'production' && !!process.env.NEXT_RUNTIME)
const DEFAULT_DB_DIR = isServerlessProd ? (process.env.TMPDIR || '/tmp') : APP_DATA_DIR
const DB_DIR = process.env.DB_DIR ? path.resolve(process.env.DB_DIR) : DEFAULT_DB_DIR
const DB_FILE = process.env.DB_FILE || 'db.sqlite'
const DB_PATH = (process.env.DB_PATH && path.isAbsolute(process.env.DB_PATH))
  ? (process.env.DB_PATH as string)
  : path.join(DB_DIR, DB_FILE)

if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true })

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

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
    targets TEXT NOT NULL,
    rotateTopN INTEGER,
    maxSpendUSD REAL,
    maxSlippage REAL,
    trigger TEXT,
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
    details TEXT,
    status TEXT NOT NULL,
    createdAt TEXT NOT NULL,
    FOREIGN KEY(ruleId) REFERENCES rules(id)
  );
`]

for (const sql of MIGRATIONS) db.exec(sql)

// Seed
try {
  const hasRules = db.prepare('SELECT 1 FROM rules LIMIT 1').get()
  if (!hasRules) {
    const rulesJsonPath = path.join(APP_DATA_DIR, 'rules.json')
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
    const logsJsonPath = path.join(APP_DATA_DIR, 'logs.json')
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
} catch {}

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
function safeParseArray(v: any): any[] { if (!v) return []; try { const x = JSON.parse(String(v)); return Array.isArray(x) ? x : [] } catch { return [] } }
function safeParseObj(v: any): Record<string, any> | undefined { if (!v) return undefined; try { const x = JSON.parse(String(v)); return (x && typeof x === 'object') ? x : undefined } catch { return undefined } }
function nOrU(v: any): number | undefined { return v === null || v === undefined ? undefined : Number(v) }

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
const updateRuleStmt = db.prepare(`
  UPDATE rules SET
    ownerAddress = @ownerAddress,
    type = @type,
    targets = @targets,
    rotateTopN = @rotateTopN,
    maxSpendUSD = @maxSpendUSD,
    maxSlippage = @maxSlippage,
    trigger = @trigger,
    cooldownMinutes = @cooldownMinutes,
    status = @status
  WHERE id = @id
`)
const deleteRuleStmt = db.prepare(`
  DELETE FROM rules WHERE id = @id AND ownerAddress = @ownerAddress
`)

export const sqliteDriver = {
  async createRule(rule: Rule): Promise<Rule> { insertRuleStmt.run(toDbRule(rule)); return rule },
  async getRules(ownerAddress?: string): Promise<Rule[]> { const rows = selectRulesStmt.all({ ownerAddress: ownerAddress ?? null }); return rows.map(fromDbRule) },
  async getRuleById(id: string): Promise<Rule | null> { const row = selectRuleByIdStmt.get(id); return row ? fromDbRule(row) : null },
  async createLog(log: LogEntry): Promise<LogEntry> { insertLogStmt.run(toDbLog(log)); return log },
  async getLogs(ownerAddress?: string): Promise<LogEntry[]> { const rows = selectLogsStmt.all({ ownerAddress: ownerAddress ?? null }); return rows.map(fromDbLog) },
  async updateRule(id: string, changes: Partial<Rule>): Promise<Rule | null> {
    const existing = sqliteDriver.getRuleById ? (await sqliteDriver.getRuleById(id)) : null
    if (!existing) return null
    const merged: Rule = { ...existing, ...changes, targets: (changes.targets ?? existing.targets) as string[], trigger: changes.trigger ?? existing.trigger, createdAt: existing.createdAt, id: existing.id }
    updateRuleStmt.run(toDbRule(merged));
    return merged
  },
  async deleteRule(id: string, ownerAddress: string): Promise<boolean> {
    const info = deleteRuleStmt.run({ id, ownerAddress })
    return info.changes > 0
  },
}

export { db as _db }
