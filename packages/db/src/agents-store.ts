/**
 * agent 身份落库辅助 —— 把运行时 SubAgentSpec / 管家配置 upsert 进 agents 表。
 *
 * 用法（入口装配时）：
 *   const db = openDatabase()
 *   const butler = ensureButlerAgent(db)
 *   const chef   = ensureSubAgent(db, chefSpec, butler.agent_id)
 * 之后 AgentContext.get(db, key).agentId 即可作为所有仓储调用的 agent 身份。
 */
import type { Db, AgentRow } from './types.js'
import { AgentContext } from './ctx.js'

/** 主管家入库（幂等；agent_key 固定 'butler'） */
export function ensureButlerAgent(
  db: Db,
  opts: { name?: string; description?: string; systemPrompt?: string; config?: Record<string, unknown> } = {},
): AgentRow {
  const ctx = AgentContext.ensure(db, {
    agentKey: 'butler',
    role: 'butler',
    name: opts.name ?? '大管家',
    domain: '总管家',
    description: opts.description ?? '总协调管家：接收人类需求，调度子 Agent，汇总汇报。',
    systemPrompt: opts.systemPrompt,
    config: opts.config ?? null,
    parentAgentId: null,
  })
  return db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(ctx.agentId) as AgentRow
}

/** 子 agent 入库（幂等；spec 结构与 agent-sdk 的 SubAgentSpec 对齐） */
export function ensureSubAgent(
  db: Db,
  spec: {
    id: string
    name: string
    domain: string
    description: string
    systemPrompt?: string
  },
  opts: { parentAgentId?: number | null; config?: Record<string, unknown> } = {},
): AgentRow {
  const ctx = AgentContext.ensure(db, {
    agentKey: spec.id,
    role: 'sub',
    name: spec.name,
    domain: spec.domain,
    description: spec.description,
    systemPrompt: spec.systemPrompt,
    config: opts.config ?? null,
    parentAgentId: opts.parentAgentId ?? null,
  })
  return db.prepare('SELECT * FROM agents WHERE agent_id = ?').get(ctx.agentId) as AgentRow
}
