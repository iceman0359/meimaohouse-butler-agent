/**
 * AgentContext —— 把「运行时 agent 实例」解析成「数据库身份」。
 *
 * 管家/任意子 agent 启动时用它做一次 upsert（ensureAgent），拿到 agent_id；
 * 之后所有存储调用都以 agent_id 为外键身份，无需再查询。
 * 这是不改 schema 接入任意新子 agent 的关键：spec.id 决定身份，其余字段仅描述。
 */
import type { Db } from './types.js'
import type { AgentRow, NewAgent } from './types.js'

export interface AgentContextInput {
  /** 唯一标识 = SubAgentSpec.id（子 agent）或 'butler'（主 agent） */
  agentKey: string
  role: 'butler' | 'sub'
  name: string
  domain: string
  description: string
  systemPrompt?: string
  /** 模型厂商等运行配置（JSON 存储） */
  config?: Record<string, unknown> | null
  /** 父 agent（子 agent 指向主管家） */
  parentAgentId?: number | null
}

export class AgentContext {
  readonly agentId: number
  readonly agentKey: string
  readonly role: 'butler' | 'sub'
  private constructor(
    private readonly db: Db,
    row: AgentRow,
  ) {
    this.agentId = row.agent_id
    this.agentKey = row.agent_key
    this.role = row.role
  }

  /** 查询 agent（不含创建） */
  static get(db: Db, agentKey: string): AgentContext | undefined {
    const row = db
      .prepare('SELECT * FROM agents WHERE agent_key = ?')
      .get(agentKey) as AgentRow | undefined
    return row ? new AgentContext(db, row) : undefined
  }

  /**
   * 确保 agent 存在并返回身份：不存在则 INSERT，存在则按输入更新描述性字段。
   * 幂等，启动时调用一次即可。parentAgentId 为 undefined 时不清空已有父关系。
   */
  static ensure(db: Db, input: AgentContextInput): AgentContext {
    const existing = AgentContext.get(db, input.agentKey)
    if (existing) {
      db.prepare(
        `UPDATE agents SET name = ?, domain = ?, description = ?, system_prompt = ?, config_json = ?
         WHERE agent_key = ?`,
      ).run(
        input.name,
        input.domain,
        input.description,
        input.systemPrompt ?? null,
        input.config ? JSON.stringify(input.config) : null,
        input.agentKey,
      )
      if (input.parentAgentId !== undefined) {
        db.prepare('UPDATE agents SET parent_agent_id = ? WHERE agent_key = ?').run(
          input.parentAgentId,
          input.agentKey,
        )
      }
      return AgentContext.get(db, input.agentKey)!
    }
    const row: NewAgent = {
      agent_key: input.agentKey,
      role: input.role,
      name: input.name,
      domain: input.domain,
      description: input.description,
      system_prompt: input.systemPrompt ?? null,
      parent_agent_id: input.parentAgentId ?? null,
      config_json: input.config ? JSON.stringify(input.config) : null,
    }
    const info = db
      .prepare(
        `INSERT INTO agents (agent_key, role, name, domain, description, system_prompt, parent_agent_id, config_json)
         VALUES (@agent_key, @role, @name, @domain, @description, @system_prompt, @parent_agent_id, @config_json)`,
      )
      .run(row)
    const created = db
      .prepare('SELECT * FROM agents WHERE agent_id = ?')
      .get(info.lastInsertRowid) as AgentRow
    return new AgentContext(db, created)
  }

  /** 解析用户（按 username 查；不存在则建），返回 user_id */
  resolveUser(username: string, displayName?: string): number {
    const found = this.db.prepare('SELECT user_id FROM users WHERE username = ?').get(username) as
      | { user_id: number }
      | undefined
    if (found) return found.user_id
    const info = this.db
      .prepare('INSERT INTO users (username, display_name) VALUES (?, ?)')
      .run(username, displayName ?? null)
    return Number(info.lastInsertRowid)
  }

  /** 解析会话：存在且属于该用户则复用，否则新建（标题缺省取首条消息摘要） */
  resolveSession(userId: number, sessionId: number | undefined, title?: string): number {
    if (sessionId != null) {
      const found = this.db
        .prepare('SELECT session_id FROM sessions WHERE session_id = ? AND user_id = ?')
        .get(sessionId, userId) as { session_id: number } | undefined
      if (found) return found.session_id
    }
    const info = this.db
      .prepare('INSERT INTO sessions (user_id, agent_id, title) VALUES (?, ?, ?)')
      .run(userId, this.agentId, title ?? '新会话')
    return Number(info.lastInsertRowid)
  }
}
