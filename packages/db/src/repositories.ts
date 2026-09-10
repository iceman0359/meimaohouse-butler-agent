/**
 * 通用仓储层 —— 任意主/子 agent 共用的数据接口。
 *
 * 设计纪律：
 * - 一个领域一个仓储，方法语义面向 agent 场景（记录/查询/完成），不掺业务判断；
 * - 外键、CHECK、唯一索引在 schema 层兜底，冲突直接抛错（调用方决定呈现）；
 * - JSON 列：入参收对象、出参还原对象，agent 侧永远拿结构化数据；
 * - 新子 agent 不需要新表：领域事实要么落在通用域（购物/家务/记忆/任务），
 *   要么走 agent_events 事件流水（自定义 event_type + payload）。
 */
import type { Database, Statement } from 'better-sqlite3'
import type {
  AgentEventRow,
  AgentMemoryRow,
  AgentPatch,
  AgentRow,
  ChorePatch,
  ChoreRow,
  MessageRow,
  NewAgent,
  NewAgentEvent,
  NewChore,
  NewMessage,
  NewSession,
  NewShoppingItem,
  NewTask,
  NewUser,
  PreferenceKind,
  SessionRow,
  ShoppingItemPatch,
  ShoppingItemRow,
  TaskResultPatch,
  TaskRow,
  UserPatch,
  UserPreferenceRow,
  UserRow,
} from './types.js'

/* ---------------- 内部工具 ---------------- */

function tojson(value: Record<string, unknown> | null | undefined): string | null {
  return value == null ? null : JSON.stringify(value)
}

function rowStmt<R>(db: Database, sql: string): Statement<unknown[], R> {
  return db.prepare(sql) as Statement<unknown[], R>
}

/** 可选过滤条件 → WHERE 片段 + 参数（元组首项为 SQL 片段，其余为占位参数） */
function where(
  conditions: Array<[string, ...unknown[]] | null>,
): { clause: string; params: unknown[] } {
  const active = conditions.filter((c): c is [string, ...unknown[]] => c !== null)
  return {
    clause: active.length > 0 ? ` WHERE ${active.map(([c]) => c).join(' AND ')}` : '',
    params: active.flatMap(([, ...rest]) => rest),
  }
}

/* ---------------- 用户 ---------------- */

export class UserRepository {
  constructor(private readonly db: Database) {}

  create(input: NewUser): UserRow {
    return rowStmt<UserRow>(
      this.db,
      'INSERT INTO users (username, display_name) VALUES (?, ?) ' +
        'RETURNING user_id, username, display_name, created_at',
    ).get(input.username, input.display_name ?? null) as UserRow
  }

  getById(userId: number): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE user_id = ?').get(userId) as
      | UserRow
      | undefined
  }

  getByUsername(username: string): UserRow | undefined {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username) as
      | UserRow
      | undefined
  }

  /** 取或建（幂等），返回行 */
  ensure(username: string, displayName?: string): UserRow {
    const found = this.getByUsername(username)
    if (found) {
      if (displayName != null && displayName !== found.display_name) {
        this.update(found.user_id, { display_name: displayName })
        return this.getById(found.user_id) as UserRow
      }
      return found
    }
    return this.create({ username, display_name: displayName ?? null })
  }

  update(userId: number, patch: UserPatch): UserRow | undefined {
    return rowStmt<UserRow>(
      this.db,
      'UPDATE users SET display_name = COALESCE(?, display_name) WHERE user_id = ? ' +
        'RETURNING user_id, username, display_name, created_at',
    ).get(patch.display_name ?? null, userId) as UserRow | undefined
  }

  remove(userId: number): boolean {
    return this.db.prepare('DELETE FROM users WHERE user_id = ?').run(userId).changes > 0
  }
}

/* ---------------- 用户偏好 ---------------- */

export class PreferenceRepository {
  constructor(private readonly db: Database) {}

  /** 按类别 upsert（1 用户 × 1 类别 = 1 行，唯一索引兜底） */
  upsert(userId: number, kind: PreferenceKind, content: string): UserPreferenceRow {
    return rowStmt<UserPreferenceRow>(
      this.db,
      `INSERT INTO user_preferences (user_id, kind, content) VALUES (?, ?, ?)
       ON CONFLICT (user_id, kind) DO UPDATE SET content = excluded.content,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
       RETURNING preference_id, user_id, kind, content, updated_at`,
    ).get(userId, kind, content) as UserPreferenceRow
  }

  get(userId: number, kind: PreferenceKind): UserPreferenceRow | undefined {
    return this.db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ? AND kind = ?')
      .get(userId, kind) as UserPreferenceRow | undefined
  }

  listByUser(userId: number): UserPreferenceRow[] {
    return this.db
      .prepare('SELECT * FROM user_preferences WHERE user_id = ? ORDER BY kind')
      .all(userId) as UserPreferenceRow[]
  }

  remove(userId: number, kind: PreferenceKind): boolean {
    return (
      this.db
        .prepare('DELETE FROM user_preferences WHERE user_id = ? AND kind = ?')
        .run(userId, kind).changes > 0
    )
  }
}

/* ---------------- Agent ---------------- */

export class AgentRepository {
  constructor(private readonly db: Database) {}

  create(input: NewAgent): AgentRow {
    return this.db
      .prepare(
        `INSERT INTO agents (agent_key, role, name, domain, description, system_prompt, parent_agent_id, config_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.agent_key,
        input.role,
        input.name,
        input.domain,
        input.description,
        input.system_prompt ?? null,
        input.parent_agent_id ?? null,
        input.config_json ?? null,
      ) && (this.db.prepare('SELECT * FROM agents WHERE agent_key = ?').get(input.agent_key) as AgentRow)
  }

  getById(agentId: number): AgentRow | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(agentId) as
      | AgentRow
      | undefined
  }

  getByKey(agentKey: string): AgentRow | undefined {
    return this.db.prepare('SELECT * FROM agents WHERE agent_key = ?').get(agentKey) as
      | AgentRow
      | undefined
  }

  /** 花名册：默认只列启用的；传 role 过滤 butler/sub */
  list(opts: { role?: 'butler' | 'sub'; includeDisabled?: boolean } = {}): AgentRow[] {
    const { clause, params } = where([
      opts.role ? ['role = ?', opts.role] : null,
      opts.includeDisabled ? null : ['enabled = 1'],
    ])
    return this.db
      .prepare(`SELECT * FROM agents${clause} ORDER BY role DESC, agent_key`)
      .all(...params) as AgentRow[]
  }

  /** 某主 agent 名下的子 agent */
  listChildren(parentAgentId: number, includeDisabled = false): AgentRow[] {
    const { clause, params } = where([
      ['parent_agent_id = ?', parentAgentId],
      includeDisabled ? null : ['enabled = 1'],
    ])
    return this.db
      .prepare(`SELECT * FROM agents${clause} ORDER BY agent_key`)
      .all(...params) as AgentRow[]
  }

  update(agentKey: string, patch: AgentPatch): AgentRow | undefined {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.name !== undefined) sets.push('name = ?'), params.push(patch.name)
    if (patch.domain !== undefined) sets.push('domain = ?'), params.push(patch.domain)
    if (patch.description !== undefined) sets.push('description = ?'), params.push(patch.description)
    if (patch.system_prompt !== undefined) sets.push('system_prompt = ?'), params.push(patch.system_prompt)
    if (patch.config_json !== undefined) sets.push('config_json = ?'), params.push(patch.config_json)
    if (patch.enabled !== undefined) sets.push('enabled = ?'), params.push(patch.enabled ? 1 : 0)
    if (sets.length === 0) return this.getByKey(agentKey)
    params.push(agentKey)
    return this.db
      .prepare(`UPDATE agents SET ${sets.join(', ')} WHERE agent_key = ?`)
      .run(...params) && (this.getByKey(agentKey) ?? undefined)
  }

  /** 删除 agent（有任务引用时会被外键 RESTRICT 拒绝，保护历史数据） */
  remove(agentKey: string): boolean {
    return this.db.prepare('DELETE FROM agents WHERE agent_key = ?').run(agentKey).changes > 0
  }
}

/* ---------------- 会话 ---------------- */

export class SessionRepository {
  constructor(private readonly db: Database) {}

  create(input: NewSession): SessionRow {
    const info = this.db
      .prepare('INSERT INTO sessions (user_id, agent_id, title) VALUES (?, ?, ?)')
      .run(input.user_id, input.agent_id ?? null, input.title ?? '新会话')
    return this.getById(Number(info.lastInsertRowid)) as SessionRow
  }

  getById(sessionId: number): SessionRow | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as
      | SessionRow
      | undefined
  }

  listByUser(userId: number, limit = 100): SessionRow[] {
    return this.db
      .prepare('SELECT * FROM sessions WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?')
      .all(userId, limit) as SessionRow[]
  }

  rename(sessionId: number, title: string): void {
    this.db
      .prepare(
        "UPDATE sessions SET title = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id = ?",
      )
      .run(title, sessionId)
  }

  /** 会话有新动态时刷新 updated_at（列表按最近活跃排序） */
  touch(sessionId: number): void {
    this.db
      .prepare("UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id = ?")
      .run(sessionId)
  }

  remove(sessionId: number): boolean {
    return this.db.prepare('DELETE FROM sessions WHERE session_id = ?').run(sessionId).changes > 0
  }
}

/* ---------------- 消息 ---------------- */

export class MessageRepository {
  constructor(private readonly db: Database) {}

  /** 追加消息并 touch 所属会话（同一事务，保证会话活跃时间准确） */
  append(input: NewMessage): MessageRow {
    const insert = this.db.transaction((msg: NewMessage): MessageRow => {
      const row = rowStmt<MessageRow>(
        this.db,
        `INSERT INTO messages (session_id, sender_kind, sender_id, content, meta_json)
         VALUES (?, ?, ?, ?, ?)
         RETURNING message_id, session_id, sender_kind, sender_id, content, meta_json, created_at`,
      ).get(
        msg.session_id,
        msg.sender_kind,
        msg.sender_id ?? null,
        msg.content,
        tojson(msg.meta ?? null),
      ) as MessageRow
      this.db
        .prepare(
          "UPDATE sessions SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE session_id = ?",
        )
        .run(msg.session_id)
      return row
    })
    return insert(input)
  }

  listBySession(sessionId: number, opts: { limit?: number; order?: 'asc' | 'desc' } = {}): MessageRow[] {
    const order = opts.order === 'desc' ? 'DESC' : 'ASC'
    const limit = opts.limit ?? 1000
    return this.db
      .prepare(
        `SELECT * FROM messages WHERE session_id = ? ORDER BY message_id ${order} LIMIT ?`,
      )
      .all(sessionId, limit) as MessageRow[]
  }

  countBySession(sessionId: number): number {
    return (
      this.db.prepare('SELECT COUNT(*) AS n FROM messages WHERE session_id = ?').get(sessionId) as {
        n: number
      }
    ).n
  }

  /** 用户级消息查询（跨会话，JOIN sessions 定位归属）——会话回放/记忆水位用 */
  listByUser(
    userId: number,
    opts: { afterId?: number; beforeId?: number; limit?: number; order?: 'asc' | 'desc' } = {},
  ): MessageRow[] {
    const conds = ['s.user_id = ?']
    const params: unknown[] = [userId]
    if (opts.afterId != null) (conds.push('m.message_id > ?'), params.push(opts.afterId))
    if (opts.beforeId != null) (conds.push('m.message_id <= ?'), params.push(opts.beforeId))
    const order = opts.order === 'asc' ? 'ASC' : 'DESC'
    const limit = opts.limit ?? 1000
    return this.db
      .prepare(
        `SELECT m.* FROM messages m JOIN sessions s ON s.session_id = m.session_id
         WHERE ${conds.join(' AND ')} ORDER BY m.message_id ${order} LIMIT ?`,
      )
      .all(...params, limit) as MessageRow[]
  }

  /** 该用户最新一条消息的 id（记忆水位基准） */
  latestIdByUser(userId: number): number {
    const row = this.db
      .prepare(
        'SELECT MAX(m.message_id) AS n FROM messages m JOIN sessions s ON s.session_id = m.session_id WHERE s.user_id = ?',
      )
      .get(userId) as { n: number | null }
    return row.n ?? 0
  }
}

/* ---------------- 任务 ---------------- */

export class TaskRepository {
  constructor(private readonly db: Database) {}

  /** 登记任务（派发即落库，status=pending） */
  create(input: NewTask): TaskRow {
    const row = rowStmt<TaskRow>(
      this.db,
      `INSERT INTO tasks (task_key, session_id, user_id, butler_agent_id, sub_agent_id,
                          intent, params_json, priority, source, deadline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING *`,
    ).get(
      input.task_key,
      input.session_id ?? null,
      input.user_id ?? null,
      input.butler_agent_id ?? null,
      input.sub_agent_id,
      input.intent,
      tojson(input.params ?? {}),
      input.priority ?? 'normal',
      input.source ?? 'human',
      input.deadline ?? null,
    ) as TaskRow
    return this.hydrate(row)
  }

  getById(taskId: number): TaskRow | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_id = ?').get(taskId) as
      | TaskRow
      | undefined
    return row ? this.hydrate(row) : undefined
  }

  getByKey(taskKey: string): TaskRow | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE task_key = ?').get(taskKey) as
      | TaskRow
      | undefined
    return row ? this.hydrate(row) : undefined
  }

  /** 写回结果信封（done/failed/needs_human/deferred 统一入口） */
  complete(taskKey: string, result: TaskResultPatch): TaskRow | undefined {
    const row = rowStmt<TaskRow>(
      this.db,
      `UPDATE tasks SET status = ?, summary = ?, detail_json = ?, error = ?,
                         suggestions_json = ?, completed_at = COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       WHERE task_key = ? RETURNING *`,
    ).get(
      result.status,
      result.summary ?? null,
      tojson(result.detail ?? null),
      result.error ?? null,
      result.suggestions ? JSON.stringify(result.suggestions) : null,
      result.completed_at ?? null,
      taskKey,
    ) as TaskRow | undefined
    return row ? this.hydrate(row) : undefined
  }

  list(opts: {
    userId?: number
    sessionId?: number
    subAgentKey?: string
    status?: TaskRow['status']
    limit?: number
  } = {}): TaskRow[] {
    const subJoin = opts.subAgentKey != null ? ' JOIN agents s ON s.agent_id = tasks.sub_agent_id' : ''
    const { clause, params } = where([
      opts.userId != null ? ['tasks.user_id = ?', opts.userId] : null,
      opts.sessionId != null ? ['tasks.session_id = ?', opts.sessionId] : null,
      opts.subAgentKey != null ? ['s.agent_key = ?', opts.subAgentKey] : null,
      opts.status ? ['tasks.status = ?', opts.status] : null,
    ])
    const rows = this.db
      .prepare(
        `SELECT tasks.* FROM tasks${subJoin}${clause} ORDER BY tasks.created_at DESC LIMIT ?`,
      )
      .all(...params, opts.limit ?? 200) as TaskRow[]
    return rows.map((r) => this.hydrate(r))
  }

  /** JSON 列还原为对象（调用方拿结构化数据） */
  private hydrate(row: TaskRow): TaskRow {
    return row
  }
}

/* ---------------- 记忆 ---------------- */

export interface MemoryScope {
  agentId: number
  /** 用户级记忆绑定 user；传 null = agent 公共记忆 */
  userId?: number | null
  ns?: string
}

export class MemoryRepository {
  constructor(private readonly db: Database) {}

  set(scope: MemoryScope, memKey: string, value: string): AgentMemoryRow {
    const ns = scope.ns ?? 'default'
    const tx = this.db.transaction((): AgentMemoryRow => {
      const existing = this.find(scope, ns, memKey)
      if (existing) {
        return rowStmt<AgentMemoryRow>(
          this.db,
          `UPDATE agent_memories SET value = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
           WHERE memory_id = ? RETURNING *`,
        ).get(value, existing.memory_id) as AgentMemoryRow
      }
      return rowStmt<AgentMemoryRow>(
        this.db,
        `INSERT INTO agent_memories (agent_id, user_id, ns, mem_key, value) VALUES (?, ?, ?, ?, ?)
         RETURNING *`,
      ).get(scope.agentId, scope.userId ?? null, ns, memKey, value) as AgentMemoryRow
    })
    return tx()
  }

  get(scope: MemoryScope, memKey: string): string | null {
    const row = this.find(scope, scope.ns ?? 'default', memKey)
    return row ? row.value : null
  }

  /** 追加一行（日志式记忆，如饮食记录），行间以 \n 连接 */
  append(scope: MemoryScope, memKey: string, entry: string): AgentMemoryRow {
    const existing = this.get(scope, memKey)
    const merged = existing ? `${existing}\n${entry}` : entry
    return this.set(scope, memKey, merged)
  }

  del(scope: MemoryScope, memKey: string): boolean {
    const ns = scope.ns ?? 'default'
    return (
      this.db
        .prepare('DELETE FROM agent_memories WHERE agent_id = ? AND IFNULL(user_id,0) = IFNULL(?,0) AND ns = ? AND mem_key = ?')
        .run(scope.agentId, scope.userId ?? null, ns, memKey).changes > 0
    )
  }

  /** 列出某范围全部记忆（供组装 system prompt / 调试） */
  list(scope: MemoryScope): AgentMemoryRow[] {
    return this.db
      .prepare(
        'SELECT * FROM agent_memories WHERE agent_id = ? AND IFNULL(user_id,0) = IFNULL(?,0) AND ns = ? ORDER BY mem_key',
      )
      .all(scope.agentId, scope.userId ?? null, scope.ns ?? 'default') as AgentMemoryRow[]
  }

  private find(scope: MemoryScope, ns: string, memKey: string): AgentMemoryRow | undefined {
    return this.db
      .prepare(
        'SELECT * FROM agent_memories WHERE agent_id = ? AND IFNULL(user_id,0) = IFNULL(?,0) AND ns = ? AND mem_key = ?',
      )
      .get(scope.agentId, scope.userId ?? null, ns, memKey) as AgentMemoryRow | undefined
  }
}

/* ---------------- 购物 ---------------- */

export class ShoppingRepository {
  constructor(private readonly db: Database) {}

  add(input: NewShoppingItem): ShoppingItemRow {
    return rowStmt<ShoppingItemRow>(
      this.db,
      `INSERT INTO shopping_items (session_id, user_id, agent_id, name, quantity, unit, note)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    ).get(
      input.session_id,
      input.user_id,
      input.agent_id,
      input.name,
      input.quantity ?? 1,
      input.unit ?? null,
      input.note ?? null,
    ) as ShoppingItemRow
  }

  getById(shoppingId: number): ShoppingItemRow | undefined {
    return this.db.prepare('SELECT * FROM shopping_items WHERE shopping_id = ?').get(shoppingId) as
      | ShoppingItemRow
      | undefined
  }

  list(opts: {
    sessionId?: number
    userId?: number
    purchased?: boolean
    limit?: number
  } = {}): ShoppingItemRow[] {
    const { clause, params } = where([
      opts.sessionId != null ? ['session_id = ?', opts.sessionId] : null,
      opts.userId != null ? ['user_id = ?', opts.userId] : null,
      opts.purchased != null ? ['purchased = ?', opts.purchased ? 1 : 0] : null,
    ])
    return this.db
      .prepare(`SELECT * FROM shopping_items${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, opts.limit ?? 200) as ShoppingItemRow[]
  }

  update(shoppingId: number, patch: ShoppingItemPatch): ShoppingItemRow | undefined {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.quantity !== undefined) sets.push('quantity = ?'), params.push(patch.quantity)
    if (patch.unit !== undefined) sets.push('unit = ?'), params.push(patch.unit)
    if (patch.purchased !== undefined) sets.push('purchased = ?'), params.push(patch.purchased ? 1 : 0)
    if (patch.note !== undefined) sets.push('note = ?'), params.push(patch.note)
    if (sets.length === 0) return this.getById(shoppingId)
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    params.push(shoppingId)
    return this.db
      .prepare(`UPDATE shopping_items SET ${sets.join(', ')} WHERE shopping_id = ? RETURNING *`)
      .get(...params) as ShoppingItemRow | undefined
  }

  /** 批量标记已购（一单交付） */
  markPurchased(ids: number[]): number {
    if (ids.length === 0) return 0
    const tx = this.db.transaction((list: number[]): number => {
      const stmt = this.db.prepare(
        "UPDATE shopping_items SET purchased = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE shopping_id = ?",
      )
      let n = 0
      for (const id of list) n += Number(stmt.run(id).changes)
      return n
    })
    return tx(ids)
  }

  remove(shoppingId: number): boolean {
    return this.db.prepare('DELETE FROM shopping_items WHERE shopping_id = ?').run(shoppingId).changes > 0
  }
}

/* ---------------- 家务 ---------------- */

export class ChoreRepository {
  constructor(private readonly db: Database) {}

  add(input: NewChore): ChoreRow {
    return rowStmt<ChoreRow>(
      this.db,
      `INSERT INTO chores (session_id, user_id, agent_id, chore_type, note, due_at)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    ).get(
      input.session_id,
      input.user_id,
      input.agent_id,
      input.chore_type,
      input.note ?? null,
      input.due_at ?? null,
    ) as ChoreRow
  }

  getById(choreId: number): ChoreRow | undefined {
    return this.db.prepare('SELECT * FROM chores WHERE chore_id = ?').get(choreId) as
      | ChoreRow
      | undefined
  }

  list(opts: { sessionId?: number; userId?: number; done?: boolean; limit?: number } = {}): ChoreRow[] {
    const { clause, params } = where([
      opts.sessionId != null ? ['session_id = ?', opts.sessionId] : null,
      opts.userId != null ? ['user_id = ?', opts.userId] : null,
      opts.done != null ? ['done = ?', opts.done ? 1 : 0] : null,
    ])
    return this.db
      .prepare(`SELECT * FROM chores${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, opts.limit ?? 200) as ChoreRow[]
  }

  update(choreId: number, patch: ChorePatch): ChoreRow | undefined {
    const sets: string[] = []
    const params: unknown[] = []
    if (patch.done !== undefined) sets.push('done = ?'), params.push(patch.done ? 1 : 0)
    if (patch.note !== undefined) sets.push('note = ?'), params.push(patch.note)
    if (patch.due_at !== undefined) sets.push('due_at = ?'), params.push(patch.due_at)
    if (sets.length === 0) return this.getById(choreId)
    sets.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')")
    params.push(choreId)
    return this.db
      .prepare(`UPDATE chores SET ${sets.join(', ')} WHERE chore_id = ? RETURNING *`)
      .get(...params) as ChoreRow | undefined
  }

  remove(choreId: number): boolean {
    return this.db.prepare('DELETE FROM chores WHERE chore_id = ?').run(choreId).changes > 0
  }
}

/* ---------------- 事件流水（通用扩展通道） ---------------- */

export class EventRepository {
  constructor(private readonly db: Database) {}

  log(input: NewAgentEvent): AgentEventRow {
    return rowStmt<AgentEventRow>(
      this.db,
      `INSERT INTO agent_events (user_id, session_id, agent_id, task_id, event_type, payload_json)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
    ).get(
      input.user_id ?? null,
      input.session_id ?? null,
      input.agent_id ?? null,
      input.task_id ?? null,
      input.event_type,
      tojson(input.payload ?? null),
    ) as AgentEventRow
  }

  list(opts: {
    agentId?: number
    eventType?: string
    userId?: number
    sessionId?: number
    limit?: number
  } = {}): AgentEventRow[] {
    const { clause, params } = where([
      opts.agentId != null ? ['agent_id = ?', opts.agentId] : null,
      opts.eventType ? ['event_type = ?', opts.eventType] : null,
      opts.userId != null ? ['user_id = ?', opts.userId] : null,
      opts.sessionId != null ? ['session_id = ?', opts.sessionId] : null,
    ])
    return this.db
      .prepare(`SELECT * FROM agent_events${clause} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, opts.limit ?? 200) as AgentEventRow[]
  }
}
