/**
 * 实体与输入类型 —— 数据库层的类型出口。
 * 行类型（XxxRow）= SELECT 结果；输入类型（NewXxx / XxxPatch）= 写入参数。
 * 约定：金额类不用；时间统一 ISO 8601 文本；扩展结构统一 JSON 文本列 + 入参对象。
 */
import type { Database } from 'better-sqlite3'

/** 数据库连接类型（better-sqlite3 实例） */
export type Db = Database

/* ---------------- 枚举常量 ---------------- */

export const RoleValues = ['butler', 'sub'] as const
export type Role = (typeof RoleValues)[number]

export const SenderKindValues = ['human', 'butler', 'sub', 'system'] as const
export type SenderKind = (typeof SenderKindValues)[number]

export const TaskStatusValues = [
  'pending',
  'done',
  'failed',
  'needs_human',
  'deferred',
  'unavailable',
] as const
export type TaskStatus = (typeof TaskStatusValues)[number]

export const PriorityValues = ['low', 'normal', 'high'] as const
export type Priority = (typeof PriorityValues)[number]

export const PreferenceKindValues = ['diet', 'housework', 'shopping'] as const
export type PreferenceKind = (typeof PreferenceKindValues)[number]

/* ---------------- 用户 ---------------- */

export interface UserRow {
  user_id: number
  username: string
  display_name: string | null
  created_at: string
}

export interface NewUser {
  username: string
  display_name?: string | null
}

export interface UserPatch {
  display_name?: string | null
}

/* ---------------- 用户偏好 ---------------- */

export interface UserPreferenceRow {
  preference_id: number
  user_id: number
  kind: PreferenceKind
  content: string
  updated_at: string
}

export interface UpsertPreference {
  kind: PreferenceKind
  content: string
}

/* ---------------- Agent ---------------- */

export interface AgentRow {
  agent_id: number
  agent_key: string
  role: Role
  name: string
  domain: string
  description: string
  system_prompt: string | null
  parent_agent_id: number | null
  config_json: string | null
  enabled: number
  created_at: string
}

export interface NewAgent {
  agent_key: string
  role: Role
  name: string
  domain: string
  description: string
  system_prompt?: string | null
  parent_agent_id?: number | null
  config_json?: string | null
}

export interface AgentPatch {
  name?: string
  domain?: string
  description?: string
  system_prompt?: string | null
  config_json?: string | null
  enabled?: boolean
}

/* ---------------- 会话 ---------------- */

export interface SessionRow {
  session_id: number
  user_id: number
  agent_id: number | null
  title: string
  created_at: string
  updated_at: string
}

export interface NewSession {
  user_id: number
  agent_id?: number | null
  title?: string
}

/* ---------------- 消息 ---------------- */

export interface MessageRow {
  message_id: number
  session_id: number
  sender_kind: SenderKind
  sender_id: string | null
  content: string
  meta_json: string | null
  created_at: string
}

export interface NewMessage {
  session_id: number
  sender_kind: SenderKind
  sender_id?: string | null
  content: string
  meta?: Record<string, unknown> | null
}

/* ---------------- 任务 ---------------- */

export interface TaskRow {
  task_id: number
  task_key: string
  session_id: number | null
  user_id: number | null
  butler_agent_id: number | null
  sub_agent_id: number
  intent: string
  params_json: string
  priority: Priority
  source: string
  deadline: string | null
  status: TaskStatus
  summary: string | null
  detail_json: string | null
  error: string | null
  error_code: string | null
  suggestions_json: string | null
  created_at: string
  completed_at: string | null
}

export interface NewTask {
  task_key: string
  session_id?: number | null
  user_id?: number | null
  butler_agent_id?: number | null
  sub_agent_id: number
  intent: string
  params?: Record<string, unknown>
  priority?: Priority
  source?: string
  deadline?: string | null
}

export interface TaskResultPatch {
  status: TaskStatus
  summary?: string | null
  detail?: Record<string, unknown> | null
  error?: string | null
  /** 机器可读错误码（协议演进：如 capability_not_configured） */
  error_code?: string | null
  suggestions?: string[] | null
  completed_at?: string | null
}

/* ---------------- 记忆 ---------------- */

export interface AgentMemoryRow {
  memory_id: number
  agent_id: number
  user_id: number | null
  ns: string
  mem_key: string
  value: string
  created_at: string
  updated_at: string
}

export interface MemoryUpsert {
  ns?: string
  mem_key: string
  value: string
}

/* ---------------- 购物 ---------------- */

export interface ShoppingItemRow {
  shopping_id: number
  session_id: number
  user_id: number
  agent_id: number
  name: string
  quantity: number
  unit: string | null
  purchased: number
  note: string | null
  created_at: string
  updated_at: string
}

export interface NewShoppingItem {
  session_id: number
  user_id: number
  agent_id: number
  name: string
  quantity?: number
  unit?: string | null
  note?: string | null
}

export interface ShoppingItemPatch {
  quantity?: number
  unit?: string | null
  purchased?: boolean
  note?: string | null
}

/* ---------------- 家务 ---------------- */

export interface ChoreRow {
  chore_id: number
  session_id: number
  user_id: number
  agent_id: number
  chore_type: string
  done: number
  note: string | null
  due_at: string | null
  created_at: string
  updated_at: string
}

export interface NewChore {
  session_id: number
  user_id: number
  agent_id: number
  chore_type: string
  note?: string | null
  due_at?: string | null
}

export interface ChorePatch {
  done?: boolean
  note?: string | null
  due_at?: string | null
}

/* ---------------- 事件 ---------------- */

export interface AgentEventRow {
  event_id: number
  user_id: number | null
  session_id: number | null
  agent_id: number | null
  task_id: number | null
  event_type: string
  payload_json: string | null
  created_at: string
}

export interface NewAgentEvent {
  user_id?: number | null
  session_id?: number | null
  agent_id?: number | null
  task_id?: number | null
  event_type: string
  payload?: Record<string, unknown> | null
}
