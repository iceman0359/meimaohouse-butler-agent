/**
 * 数据库检查模块 —— 只读查看 schema 与数据。
 *
 * 三种用法：
 *   1. CLI：npm run db:inspect [表名]              （examples/db-inspect.ts）
 *   2. Web：GET /api/db/tables · /api/db/table/<名> （apps/butler-web/db.html 页面）
 *   3. 外部 GUI（DBeaver / DB Browser / VS Code SQLite 插件）直接打开 ./data/butler.db
 *
 * 安全：表名一律先从 sqlite_master 白名单校验，杜绝拼接注入。
 */
import type { Db } from './types.js'

export interface TableInfo {
  name: string
  kind: 'table' | 'view' | 'index'
  rowCount: number
  ddl: string
}

export interface ColumnInfo {
  cid: number
  name: string
  type: string
  notnull: number
  dflt_value: string | null
  pk: number
}

const SQLITE_INTERNAL = /^sqlite_/i

/** 列出全部用户表（含行数与建表 DDL），按名称排序 */
export function listTables(db: Db): TableInfo[] {
  const rows = db
    .prepare("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string; type: string; sql: string }>
  return rows.map((r) => ({
    name: r.name,
    kind: r.type as 'table' | 'view',
    rowCount: r.type === 'table' ? (db.prepare(`SELECT COUNT(*) AS n FROM "${r.name}"`).get() as { n: number }).n : 0,
    ddl: r.sql,
  }))
}

/** 表的列结构（PRAGMA table_info） */
export function describeTable(db: Db, tableName: string): ColumnInfo[] {
  assertKnownTable(db, tableName)
  return db.prepare(`PRAGMA table_info("${tableName}")`).all() as ColumnInfo[]
}

/** 表的索引 */
export function listIndexes(db: Db, tableName?: string): Array<{ name: string; tbl_name: string; sql: string | null }> {
  const rows = db
    .prepare("SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string; tbl_name: string; sql: string | null }>
  return tableName ? rows.filter((r) => r.tbl_name === tableName) : rows
}

/** 读取表数据（按 rowid 升序，限制条数） */
export function selectRows(db: Db, tableName: string, limit = 50, offset = 0): Array<Record<string, unknown>> {
  assertKnownTable(db, tableName)
  const l = Math.max(1, Math.min(Number(limit) || 50, 500))
  const o = Math.max(0, Number(offset) || 0)
  return db.prepare(`SELECT * FROM "${tableName}" ORDER BY rowid LIMIT ${l} OFFSET ${o}`).all() as Array<
    Record<string, unknown>
  >
}

/** 全库统计（表 → 行数），快速总览 */
export function dbSummary(db: Db): { table: string; rows: number }[] {
  return listTables(db).map((t) => ({ table: t.name, rows: t.rowCount }))
}

/** 白名单校验：只允许 sqlite_master 里真实存在的表/视图 */
function assertKnownTable(db: Db, tableName: string): void {
  if (SQLITE_INTERNAL.test(tableName)) throw new Error(`内部表不可直接访问: ${tableName}`)
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?")
    .get(tableName)
  if (!row) throw new Error(`未知表: ${tableName}`)
}
