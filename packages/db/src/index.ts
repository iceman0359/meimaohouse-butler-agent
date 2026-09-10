/**
 * @meimaohouse/db
 * 通用数据库层：3NF SQLite schema + 主/子 agent 通用存储接口。
 *
 * 快速上手：
 *   import { openDatabase, ensureButlerAgent, ensureSubAgent, AgentContext } from '@meimaohouse/db'
 *   const db = openDatabase()                      // 默认 ./data/butler.db
 *   const butler = ensureButlerAgent(db)
 *   const chef   = ensureSubAgent(db, chefSpec, butler.agent_id)
 *   const ctx = AgentContext.get(db, 'chef')!
 *   const userId = ctx.resolveUser('alice', '主人')
 *   const sessionId = ctx.resolveSession(userId)   // 新会话
 *   new MessageRepository(db).append({ session_id: sessionId, sender_kind: 'human', content: '...' })
 */
export * from './types.js'
export * from './db.js'
export * from './ctx.js'
export * from './repositories.js'
export * from './memory-store.js'
export * from './agents-store.js'
export * from './admin.js'
