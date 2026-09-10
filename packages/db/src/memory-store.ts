/**
 * SqliteMemory —— agent-sdk `Memory` 接口的 SQLite 实现。
 *
 * 用它替换进程内 InMemoryMemory，长期记忆重启不丢：
 *   const mem = createSqliteMemory(db, { agentId: chefId, userId })   // 用户级
 *   const mem = createSqliteMemory(db, { agentId: chefId })           // agent 公共级
 * 任意子 agent 用同样的接口与表，互不串数据（agent_id 隔离）。
 */
import type { Db } from './types.js'
import type { Memory } from '@meimaohouse/agent-sdk'
import { MemoryRepository, type MemoryScope } from './repositories.js'

export class SqliteMemory implements Memory {
  private readonly repo: MemoryRepository
  private readonly scope: Required<Pick<MemoryScope, 'agentId'>> & MemoryScope

  constructor(db: Db, scope: MemoryScope) {
    this.repo = new MemoryRepository(db)
    this.scope = { ns: 'default', ...scope }
  }

  async get(key: string): Promise<string | null> {
    return this.repo.get(this.scope, key)
  }

  async set(key: string, value: string): Promise<void> {
    this.repo.set(this.scope, key, value)
  }

  async append(key: string, entry: string): Promise<void> {
    this.repo.append(this.scope, key, entry)
  }

  async del(key: string): Promise<void> {
    this.repo.del(this.scope, key)
  }
}

/** 工厂：与 agent-sdk 的 createMemory() 对位的 SQLite 版 */
export function createSqliteMemory(db: Db, scope: MemoryScope): SqliteMemory {
  return new SqliteMemory(db, scope)
}
