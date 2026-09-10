/**
 * @meimaohouse/db 集成测试 —— 覆盖 schema 约束、外键级联/限制、
 * 通用接口语义（用户/偏好/agent/会话/消息/任务/记忆/购物/家务/事件）。
 *
 * 运行：npm test -w @meimaohouse/db   （node --import tsx --test）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  openDatabase,
  closeDatabase,
  migrate,
  ensureButlerAgent,
  ensureSubAgent,
  AgentContext,
  UserRepository,
  PreferenceRepository,
  AgentRepository,
  SessionRepository,
  MessageRepository,
  TaskRepository,
  MemoryRepository,
  ShoppingRepository,
  ChoreRepository,
  EventRepository,
  createSqliteMemory,
} from '../src/index.js'
import type { Db } from '../src/index.js'

function freshDb(): Db {
  return openDatabase({ path: ':memory:' })
}

test('迁移幂等：重复执行不报错，user_version 停在最新', () => {
  const db = freshDb()
  migrate(db)
  const v = Number(db.pragma('user_version', { simple: true }))
  assert.ok(v >= 1, `user_version=${v}`)
  const tables = (
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{ name: string }>
  ).map((r) => r.name)
  for (const t of ['users', 'user_preferences', 'agents', 'sessions', 'messages', 'tasks', 'agent_memories', 'shopping_items', 'chores', 'agent_events']) {
    assert.ok(tables.includes(t), `缺少表 ${t}`)
  }
  closeDatabase(db)
})

test('用户：唯一用户名约束 + ensure 幂等', () => {
  const db = freshDb()
  const users = new UserRepository(db)
  const u = users.ensure('alice', '爱丽丝')
  assert.equal(u.username, 'alice')
  const again = users.ensure('alice')
  assert.equal(again.user_id, u.user_id, 'ensure 应返回同一用户')
  assert.throws(() => users.create({ username: 'alice' }), /UNIQUE/, '重复用户名应被唯一索引拒绝')
  closeDatabase(db)
})

test('偏好：同类别 upsert 覆盖为单行（消除多值依赖）', () => {
  const db = freshDb()
  const users = new UserRepository(db)
  const prefs = new PreferenceRepository(db)
  const u = users.create({ username: 'bob' })
  prefs.upsert(u.user_id, 'diet', '忌辣')
  prefs.upsert(u.user_id, 'diet', '忌辣 + 少油')
  const rows = prefs.listByUser(u.user_id).filter((r) => r.kind === 'diet')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content, '忌辣 + 少油')
  closeDatabase(db)
})

test('agent：身份入库 + 层级（父=butler）+ 花名册过滤', () => {
  const db = freshDb()
  const agents = new AgentRepository(db)
  const butler = ensureButlerAgent(db)
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房相关' }, { parentAgentId: butler.agent_id })
  assert.equal(chef.role, 'sub')
  assert.equal(chef.parent_agent_id, butler.agent_id)
  // 幂等更新
  const again = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '更新过的描述' })
  assert.equal(again.agent_id, chef.agent_id)
  assert.equal(again.description, '更新过的描述')
  const roster = agents.list({ role: 'sub' })
  assert.ok(roster.some((a) => a.agent_key === 'chef'))
  closeDatabase(db)
})

test('外键：购物记录引用不存在的会话被拒绝', () => {
  const db = freshDb()
  const shopping = new ShoppingRepository(db)
  assert.throws(
    () =>
      shopping.add({
        session_id: 99999,
        user_id: 1,
        agent_id: 1,
        name: '牛奶',
      }),
    /FOREIGN KEY/,
  )
  closeDatabase(db)
})

test('会话/消息：追加消息刷新会话活跃时间', () => {
  const db = freshDb()
  const sessions = new SessionRepository(db)
  const messages = new MessageRepository(db)
  const users = new UserRepository(db)
  const u = users.create({ username: 'alice' })
  const s = sessions.create({ user_id: u.user_id, title: '测试会话' })
  const before = sessions.getById(s.session_id)!.updated_at
  messages.append({ session_id: s.session_id, sender_kind: 'human', content: '你好' })
  const after = sessions.getById(s.session_id)!.updated_at
  assert.ok(after >= before)
  assert.equal(messages.countBySession(s.session_id), 1)
  closeDatabase(db)
})

test('任务：登记 → 完成写回 → 按状态/子 agent 查询', async () => {
  const db = freshDb()
  const butler = ensureButlerAgent(db)
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const users = new UserRepository(db)
  const u = users.create({ username: 'alice' })
  const tasks = new TaskRepository(db)
  const key = `chef_test_${Date.now()}`
  tasks.create({
    task_key: key,
    user_id: u.user_id,
    butler_agent_id: butler.agent_id,
    sub_agent_id: chef.agent_id,
    intent: 'order_groceries',
    params: { items: [{ name: '鸡蛋', qty: 6 }] },
    priority: 'high',
  })
  const pending = tasks.list({ status: 'pending', subAgentKey: 'chef' })
  assert.ok(pending.some((t) => t.task_key === key))
  tasks.complete(key, {
    status: 'done',
    summary: '已下单',
    detail: { order_id: 'DEMO-1' },
    suggestions: ['转派 cleaner 收纳'],
  })
  const done = tasks.getByKey(key)!
  assert.equal(done.status, 'done')
  assert.equal(done.summary, '已下单')
  assert.deepEqual(JSON.parse(done.detail_json!), { order_id: 'DEMO-1' })
  assert.deepEqual(JSON.parse(done.suggestions_json!), ['转派 cleaner 收纳'])
  assert.ok(done.completed_at)
  assert.equal(tasks.list({ status: 'pending', subAgentKey: 'chef' }).some((t) => t.task_key === key), false)
})

test('任务外键 RESTRICT：有任务的 agent 不可删除', () => {
  const db = freshDb()
  const agents = new AgentRepository(db)
  ensureButlerAgent(db)
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const users = new UserRepository(db)
  const tasks = new TaskRepository(db)
  tasks.create({
    task_key: `chef_x_${Date.now()}`,
    sub_agent_id: chef.agent_id,
    user_id: users.create({ username: 'u' }).user_id,
    intent: 'check',
  })
  assert.throws(() => agents.remove('chef'), /FOREIGN KEY/, '删除被任务引用的 agent 应被拒绝')
  closeDatabase(db)
})

test('记忆：set/get/append/del + 用户级与 agent 级隔离', async () => {
  const db = freshDb()
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const users = new UserRepository(db)
  const alice = users.create({ username: 'alice' }).user_id
  const repo = new MemoryRepository(db)
  const agentScope = { agentId: chef.agent_id }
  const aliceScope = { agentId: chef.agent_id, userId: alice, ns: 'kitchen' }
  repo.set(agentScope, 'fridge', '公共库存')
  repo.set(aliceScope, 'fridge', '爱丽丝的库存')
  assert.equal(repo.get(agentScope, 'fridge'), '公共库存')
  assert.equal(repo.get(aliceScope, 'fridge'), '爱丽丝的库存')
  repo.append(aliceScope, 'meal_log', '晚餐: 沙拉')
  repo.append(aliceScope, 'meal_log', '早餐: 燕麦')
  assert.equal(repo.get(aliceScope, 'meal_log'), '晚餐: 沙拉\n早餐: 燕麦')
  assert.equal(repo.del(aliceScope, 'meal_log'), true)
  assert.equal(repo.get(aliceScope, 'meal_log'), null)
  // SqliteMemory 与仓储语义一致
  const mem = createSqliteMemory(db, { agentId: chef.agent_id, userId: alice, ns: 'kitchen' })
  await mem.set('todo', '买牛奶')
  assert.equal(await mem.get('todo'), '买牛奶')
  closeDatabase(db)
})

test('购物：批量标记已购 + 过滤', () => {
  const db = freshDb()
  const users = new UserRepository(db)
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const sessions = new SessionRepository(db)
  const shopping = new ShoppingRepository(db)
  const u = users.create({ username: 'alice' }).user_id
  const s = sessions.create({ user_id: u }).session_id
  const a = shopping.add({ session_id: s, user_id: u, agent_id: chef.agent_id, name: '牛奶', quantity: 2, unit: '盒' })
  const b = shopping.add({ session_id: s, user_id: u, agent_id: chef.agent_id, name: '鸡蛋', quantity: 12, unit: '个' })
  assert.equal(shopping.markPurchased([a.shopping_id, b.shopping_id]), 2)
  assert.equal(shopping.list({ userId: u, purchased: true }).length, 2)
  assert.equal(shopping.list({ userId: u, purchased: false }).length, 0)
  shopping.update(a.shopping_id, { quantity: 3 })
  assert.equal(shopping.getById(a.shopping_id)!.quantity, 3)
  closeDatabase(db)
})

test('家务：待办 → 完成 + 用户过滤', () => {
  const db = freshDb()
  const users = new UserRepository(db)
  const cleaner = ensureSubAgent(db, { id: 'cleaner', name: '清洁工', domain: '清洁域', description: '清洁' })
  const sessions = new SessionRepository(db)
  const chores = new ChoreRepository(db)
  const u = users.create({ username: 'alice' }).user_id
  const s = sessions.create({ user_id: u }).session_id
  const c = chores.add({ session_id: s, user_id: u, agent_id: cleaner.agent_id, chore_type: '扫地', due_at: '2026-01-01T10:00:00Z' })
  assert.equal(c.done, 0)
  chores.update(c.chore_id, { done: true })
  assert.equal(chores.list({ userId: u, done: true }).length, 1)
  closeDatabase(db)
})

test('级联：删会话 → 消息/购物/家务消失；删用户 → 记忆消失', () => {
  const db = freshDb()
  const users = new UserRepository(db)
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const sessions = new SessionRepository(db)
  const messages = new MessageRepository(db)
  const shopping = new ShoppingRepository(db)
  const chores = new ChoreRepository(db)
  const memories = new MemoryRepository(db)
  const u = users.create({ username: 'alice' }).user_id
  const s = sessions.create({ user_id: u }).session_id
  messages.append({ session_id: s, sender_kind: 'human', content: 'hi' })
  shopping.add({ session_id: s, user_id: u, agent_id: chef.agent_id, name: '牛奶' })
  chores.add({ session_id: s, user_id: u, agent_id: chef.agent_id, chore_type: '擦窗' })
  memories.set({ agentId: chef.agent_id, userId: u }, 'k', 'v')
  sessions.remove(s)
  assert.equal(messages.countBySession(s), 0)
  assert.equal(shopping.list({ sessionId: s }).length, 0)
  assert.equal(chores.list({ sessionId: s }).length, 0)
  // 会话删除不影响 agent 级数据（记忆挂在用户上）：先确认仍在
  assert.equal(memories.get({ agentId: chef.agent_id, userId: u }, 'k'), 'v')
  // 删用户 → 用户级记忆级联消失
  users.remove(u)
  assert.equal(memories.get({ agentId: chef.agent_id, userId: u }, 'k'), null)
  closeDatabase(db)
})

test('事件：流水写入与按类型过滤', () => {
  const db = freshDb()
  const chef = ensureSubAgent(db, { id: 'chef', name: '厨师', domain: '厨房域', description: '厨房' })
  const events = new EventRepository(db)
  events.log({ agent_id: chef.agent_id, event_type: 'fridge.warning', payload: { item: '牛奶', days: 2 } })
  events.log({ agent_id: chef.agent_id, event_type: 'meal.logged', payload: { kcal: 520 } })
  assert.equal(events.list({ agentId: chef.agent_id, eventType: 'fridge.warning' }).length, 1)
  assert.equal(events.list({ agentId: chef.agent_id }).length, 2)
  closeDatabase(db)
})

test('AgentContext：resolveUser/resolveSession 语义', () => {
  const db = freshDb()
  ensureButlerAgent(db)
  const ctx = AgentContext.get(db, 'butler')!
  const uid1 = ctx.resolveUser('carol', '卡罗尔')
  const uid2 = ctx.resolveUser('carol')
  assert.equal(uid1, uid2)
  const sid1 = ctx.resolveSession(uid1, undefined, '第一段')
  const sid2 = ctx.resolveSession(uid1, sid1)
  assert.equal(sid1, sid2, '传入存在的 sessionId 应复用')
  // 跨用户不可复用他人会话
  const dave = ctx.resolveUser('dave')
  const sidDave = ctx.resolveSession(dave, sid1)
  assert.notEqual(sidDave, sid1, '他人会话不可复用，应新建')
  closeDatabase(db)
})
