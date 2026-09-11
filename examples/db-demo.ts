/**
 * 通用数据库接口演示 —— 不需要任何模型厂商即可运行。
 *
 *   npm run build && npm run demo:db
 *
 * 演示内容：
 *   1. 建库（./data/demo.db）+ 主/子 agent 身份入库
 *   2. 新子 agent「零 schema 变更」接入：demo 里现场 defineSubAgent 一个 gardener
 *   3. 用户 / 偏好 / 会话 / 消息 通用读写
 *   4. 任务协议落库（TaskEnvelope 进、ResultEnvelope 回，即 butler.delegate 持久化的内容）
 *   5. 购物 / 家务 / 事件 流水（子 agent 各自的领域数据走同一套接口）
 *   6. SQLite 记忆：多用户隔离（alice / bob 各自的冰箱库存互不可见）
 *   7. 关闭重开数据库 → 数据仍在（持久化验证）
 */
import {
  openDatabase,
  closeDatabase,
  ensureButlerAgent,
  ensureSubAgent,
  AgentContext,
  MessageRepository,
  TaskRepository,
  ShoppingRepository,
  ChoreRepository,
  EventRepository,
  PreferenceRepository,
  createSqliteMemory,
} from '@meimaohouse/db'
import { defineSubAgent } from '@meimaohouse/agent-sdk'

const DB_PATH = process.env.BUTLER_DB_PATH ?? './data/demo.db'

function section(title: string): void {
  console.log(`\n━━ ${title} ${'━'.repeat(Math.max(1, 46 - title.length))}`)
}

async function main() {
  section(`① 建库 + agent 身份入库（${DB_PATH}）`)
  const db = openDatabase({ path: DB_PATH })
  const butler = ensureButlerAgent(db, {
    description: '总协调管家：接收人类需求，调度子 Agent，汇总汇报。',
  })
  const chefSpec = {
    id: 'chef',
    name: '厨师',
    domain: '厨房域',
    description: '掌管厨房域：冰箱库存、采购下单、厨房安全检查、饮食统计。',
  }
  const chef = ensureSubAgent(db, chefSpec, { parentAgentId: butler.agent_id })
  console.log(`  主管家: #${butler.agent_id} butler（role=butler）`)
  console.log(`  子agent: #${chef.agent_id} chef（parent=#${butler.agent_id}）`)

  section('② 新子 agent 零 schema 变更接入（现场注册 gardener）')
  const gardenerSpec = defineSubAgent({
    id: 'gardener',
    name: '园丁',
    domain: '园艺域',
    description: '花园浇花、修剪、除虫。（演示用：只注册身份，不接模型）',
    systemPrompt: '演示用。',
  })
  const gardener = ensureSubAgent(db, gardenerSpec.spec, { parentAgentId: butler.agent_id })
  console.log(`  子agent: #${gardener.agent_id} gardener —— agents 表加一行即完成接入`)

  section('③ 用户 / 偏好 / 会话 / 消息')
  const butlerCtx = AgentContext.get(db, 'butler')!
  const alice = butlerCtx.resolveUser('alice', '爱丽丝')
  const prefs = new PreferenceRepository(db)
  prefs.upsert(alice, 'diet', '清淡低油，每日热量目标 2000 kcal')
  prefs.upsert(alice, 'shopping', '牛奶只买有机品牌')
  const sessions = butlerCtx.resolveSession(alice, undefined, '冰箱里有什么能做的？')
  const messages = new MessageRepository(db)
  messages.append({ session_id: sessions, sender_kind: 'human', content: '晚上想吃得清淡点，看看冰箱里有什么能做的？' })
  messages.append({
    session_id: sessions,
    sender_kind: 'butler',
    sender_id: 'butler',
    content: '冰箱里有鸡蛋、牛奶和西兰花，牛奶快过期了。建议做西兰花炒蛋+清蒸三文鱼（需要先补货）。',
  })
  for (const m of messages.listBySession(sessions)) {
    console.log(`  [${m.sender_kind}] ${m.content.slice(0, 40)}${m.content.length > 40 ? '…' : ''}`)
  }

  section('④ 任务协议落库（TaskEnvelope → ResultEnvelope）')
  const tasks = new TaskRepository(db)
  const taskKey = `chef_${Date.now().toString(36)}_demo01`
  tasks.create({
    task_key: taskKey,
    user_id: alice,
    session_id: sessions,
    butler_agent_id: butler.agent_id,
    sub_agent_id: chef.agent_id,
    intent: 'order_groceries',
    params: { items: [{ name: '三文鱼', qty: 2 }], note: ' urgent' },
    priority: 'high',
  })
  tasks.complete(taskKey, {
    status: 'done',
    summary: '已下单三文鱼 2 份，2 小时内送达。',
    detail: { order_id: 'DEMO-42', estimated_delivery: '2小时内' },
    suggestions: ['请管家转派 cleaner：收货后清理厨房台面'],
  })
  const t = tasks.getByKey(taskKey)!
  console.log(`  task ${t.task_key}: ${t.intent} → ${t.status}`)
  console.log(`  summary: ${t.summary}`)
  console.log(`  suggestions: ${JSON.parse(t.suggestions_json!).join(' / ')}`)

  section('⑤ 领域数据：购物 / 家务 / 事件（同一套接口）')
  const shopping = new ShoppingRepository(db)
  const salmon = shopping.add({
    session_id: sessions,
    user_id: alice,
    agent_id: chef.agent_id,
    name: '三文鱼',
    quantity: 2,
    unit: '份',
    note: '来自任务 ' + taskKey,
  })
  const broccoli = shopping.add({
    session_id: sessions,
    user_id: alice,
    agent_id: chef.agent_id,
    name: '西兰花',
    quantity: 2,
    unit: '颗',
  })
  shopping.markPurchased([salmon.shopping_id, broccoli.shopping_id])
  for (const s of shopping.list({ userId: alice })) {
    console.log(`  购物: ${s.name} x${s.quantity}${s.unit ?? ''} ${s.purchased ? '[已购]' : '[待购]'}`)
  }
  const chores = new ChoreRepository(db)
  const chore = chores.add({
    session_id: sessions,
    user_id: alice,
    agent_id: gardener.agent_id,
    chore_type: '浇花',
    note: '阳台的绿萝和月季',
  })
  console.log(`  家务: #${chore.chore_id} ${chore.chore_type}（${chore.done ? '已完成' : '待办'}）`)
  const events = new EventRepository(db)
  events.log({ user_id: alice, session_id: sessions, agent_id: chef.agent_id, event_type: 'fridge.warning', payload: { item: '牛奶', expire_in_days: 2 } })
  for (const e of events.list({ agentId: chef.agent_id })) {
    console.log(`  事件: ${e.event_type} ${e.payload_json ?? ''}`)
  }

  section('⑥ SQLite 记忆（多用户隔离）')
  const chefId = chef.agent_id
  const aliceFridge = createSqliteMemory(db, { agentId: chefId, userId: alice, ns: 'kitchen' })
  const bob = butlerCtx.resolveUser('bob', '鲍勃')
  const bobFridge = createSqliteMemory(db, { agentId: chefId, userId: bob, ns: 'kitchen' })
  await aliceFridge.set('fridge', '鸡蛋x6, 牛奶x1(临期), 西兰花x2')
  await bobFridge.set('fridge', '鸡蛋x12, 排骨x1')
  console.log(`  alice 的冰箱: ${await aliceFridge.get('fridge')}`)
  console.log(`  bob   的冰箱: ${await bobFridge.get('fridge')}`)
  await aliceFridge.append('meal_log', '晚餐: 西兰花炒蛋')
  console.log(`  alice 的饮食记录: ${JSON.stringify(await aliceFridge.get('meal_log'))}`)

  section('⑦ 关闭重开 → 持久化验证')
  closeDatabase(db)
  const db2 = openDatabase({ path: DB_PATH })
  const users = db2.prepare('SELECT COUNT(*) n FROM users').get() as { n: number }
  const agents = db2.prepare('SELECT COUNT(*) n FROM agents').get() as { n: number }
  const msgs = db2.prepare('SELECT COUNT(*) n FROM messages').get() as { n: number }
  const tsk = db2.prepare("SELECT status, COUNT(*) n FROM tasks GROUP BY status").all() as Array<{ status: string; n: number }>
  console.log(`  users=${users.n} agents=${agents.n} messages=${msgs.n} tasks=${JSON.stringify(tsk)}`)
  console.log(`  alice 冰箱仍在: ${await createSqliteMemory(db2, { agentId: chefId, userId: alice, ns: 'kitchen' }).get('fridge')}`)
  closeDatabase(db2)
  console.log('\n✅ 演示完成。数据库文件:', DB_PATH)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
