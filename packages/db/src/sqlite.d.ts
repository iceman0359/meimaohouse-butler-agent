/**
 * better-sqlite3 最小类型声明（本仓库用到的 API 面）。
 * 避免额外安装 @types/better-sqlite3；如后续安装了官方 types 包，删除本文件即可。
 */
declare module 'better-sqlite3' {
  export interface RunResult {
    changes: number | bigint
    lastInsertRowid: number | bigint
  }

  export interface Statement<Bind extends unknown[] = unknown[], Result = unknown> {
    run(...params: Bind): RunResult
    get(...params: Bind): Result
    all(...params: Bind): Result[]
    iterate(...params: Bind): IterableIterator<Result>
  }

  export interface Database {
    open: boolean
    inTransaction: boolean
    exec(sql: string): this
    prepare<Bind extends unknown[] = unknown[], Result = unknown>(sql: string): Statement<Bind, Result>
    pragma(source: string, options?: { simple?: boolean }): unknown
    transaction<F extends (...args: never[]) => unknown>(fn: F): F
    close(): this
  }

  interface DatabaseConstructor {
    new (path: string, options?: Record<string, unknown>): Database
  }

  const Database: DatabaseConstructor
  export default Database
}
