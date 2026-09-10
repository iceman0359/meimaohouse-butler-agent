/**
 * Butler —— 大管家主类（人类唯一入口）。
 *
 * 职责：
 * - 持有子 Agent 注册表，启动时把每个子 Agent 包装成 tool()（Agent-as-Tool）；
 * - chat(message)：人类对话入口，管家模型自行决策调度哪些子 Agent；
 * - delegate(task)：程序化直派（跳过模型，按领域直接调用子 Agent，供测试/编排用）；
 * - listAgents()：当前花名册。
 *
 * 懒加载：new Butler() 不创建模型/Agent，首次 chat()/delegate() 时才解析
 * （getModel()）。入口先 await configureModel()。
 *
 * 数据库集成（@meimaohouse/db，可选注入 db）：
 * - 工作记忆每轮从 DB 组装（长期纪要 + 最近 20 条，见 memory.ts），进程内不攒历史
 *   → 重启零失忆；未压缩消息超阈值时自动压缩纪要（解决即弃/过期自灭）；
 * - chat/delegate 全链路持久化：会话、消息、任务信封、事件；
 * - 未传 db 时行为与纯内存版完全一致（零依赖可跑）。
 *
 * 长期记忆工具（memory?: Memory，来自 agent-sdk）：传入时注册 memory_get/set/
 * append/delete 工具；配合 createSqliteMemory(db, …) 即为落库的记忆工具。
 */
import { Agent } from '@strands-agents/sdk'
import {
  getModel,
  createTaskId,
  TaskRequestSchema,
  createMemoryTools,
  type ModelInstance,
  type Memory,
  type SubAgent,
  type TaskEnvelope,
  type TaskRequestInput,
  type ResultEnvelope,
} from '@meimaohouse/agent-sdk'
import {
  AgentContext,
  EventRepository,
  MessageRepository,
  SessionRepository,
  TaskRepository,
  type Db,
} from '@meimaohouse/db'
import { buildButlerSystemPrompt, type RosterEntry } from './prompts.js'
import { assembleMemory, loadBrief } from './memory.js'

/** 压缩纪要员的 system prompt（一次性调用，不带工具与花名册） */
const SUMMARY_SYSTEM_PROMPT =
  '你是庄园管家的记忆管理员。你的唯一职责是把对话压缩成长期纪要：只输出纪要正文，不解释、不加标题、不寒暄。'

export interface ButlerOptions {
  /** 初始子 Agent 列表 */
  subAgents?: SubAgent[]
  /** 自定义管家 system prompt（缺省用内置模板，内置模板会自动带花名册） */
  systemPrompt?: string
  /** 模型实例（缺省走 getModel()） */
  model?: ModelInstance
  /** 管家显示名 */
  name?: string
  /** 可选长期记忆实现 */
  memory?: Memory
  /** 数据库连接（可选；传入即开启持久化 + 工作记忆组装） */
  db?: Db
  /** 会话归属用户（按 username 解析，缺省 'default'） */
  ownerUsername?: string
}

export class Butler {
  readonly name: string

  private subAgents = new Map<string, SubAgent>()
  private model?: ModelInstance
  private agent?: Agent
  private customPrompt?: string
  private memory?: Memory
  private invocationQueue: Promise<void> = Promise.resolve()
  private readonly db?: Db
  private butlerAgent?: AgentContext
  private readonly ownerUsername: string
  private started = false

  constructor(opts: ButlerOptions = {}) {
    this.name = opts.name ?? '大管家'
    this.model = opts.model
    this.customPrompt = opts.systemPrompt
    this.memory = opts.memory
    this.db = opts.db
    this.ownerUsername = opts.ownerUsername ?? 'default'
    for (const sa of opts.subAgents ?? []) {
      this.register(sa)
    }
  }

  /** 注册一个子 Agent；重复 id 或 Agent 已启动时抛错。 */
  register(subAgent: SubAgent): this {
    if (this.started || this.agent) {
      throw new Error('管家 Agent 已启动，不能再注册子 Agent。请在首次 chat() 前完成注册。')
    }
    if (this.subAgents.has(subAgent.spec.id)) {
      throw new Error(`子 Agent 已注册: ${subAgent.spec.id}`)
    }
    this.subAgents.set(subAgent.spec.id, subAgent)
    // 落库：子 Agent 身份入库（幂等）；主管家行由装配层 ensureButlerAgent 保证
    if (this.db) {
      const parent = AgentContext.get(this.db, 'butler')
      if (parent) {
        ensureSubAgentRow(this.db, subAgent.spec, parent.agentId)
      }
    }
    return this
  }

  /** 当前花名册（含 description，供调试/UI 展示） */
  listAgents(): RosterEntry[] {
    return [...this.subAgents.values()].map((sa) => ({
      id: sa.spec.id,
      name: sa.spec.name,
      domain: sa.spec.domain,
      description: sa.spec.description,
    }))
  }

  /** 当前长期纪要（供调试/UI 展示；未启用 db 时返回空串） */
  getBrief(): string {
    if (!this.db) return ''
    const userId = this.getButlerAgent().resolveUser(this.ownerUsername)
    return loadBrief(this.db, userId).brief
  }

  /**
   * 人类对话入口：管家模型决策并调度子 Agent，返回转述结果（纯文本）。
   * 传 db 后工作记忆每轮从 DB 组装（纪要 + 窗口），全链路落库。
   */
  async chat(message: string): Promise<string> {
    return this.runExclusive(async () => {
      // ① 组装工作记忆（在写入本轮 human 消息之前，窗口不含本轮）
      let historyText = ''
      let turn: { sessionId: number; userId: number } | null = null
      if (this.db) {
        const userId = this.getButlerAgent().resolveUser(this.ownerUsername)
        const assembled = await assembleMemory(this.db, userId, (prompt) => this.summarize(prompt))
        historyText = assembled.historyText
        if (assembled.compressed) {
          console.log('[butler] 记忆压缩完成：纪要已更新，水位已推进')
        }
        // ② 登记本轮 human 消息（解析/复用会话）
        turn = this.beginTurn(message, userId)
      }
      this.started = true
      // ③ 调用模型：注入历史块 + 本轮消息
      try {
        const input = historyText ? `${historyText}\n\n【主人本轮消息】\n${message}` : message
        const result = await this.invokeModel(input)
        const reply = extractReplyText(result)
        if (turn) {
          this.appendMessage(turn.sessionId, 'butler', reply)
          this.logEvent(turn.sessionId, turn.userId, 'butler.chat.reply', {
            message_length: message.length,
            reply_length: reply.length,
          })
        }
        return reply
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err)
        if (turn) {
          this.appendMessage(turn.sessionId, 'butler', `执行出错：${errMsg}`)
          this.logEvent(turn.sessionId, turn.userId, 'butler.chat.error', {
            message,
            error: errMsg,
          })
        }
        throw err
      }
    })
  }

  /**
   * 程序化直派：跳过模型决策，按 domain 直接调用子 Agent。
   * 供测试、定时任务、外部编排使用；返回原始 ResultEnvelope。
   * 传 db 时：任务登记（pending）→ 执行 → 结果写回 + task.completed 事件。
   */
  async delegate(request: TaskRequestInput & { domain: string }): Promise<ResultEnvelope> {
    const { domain, ...input } = request
    const sa = this.subAgents.get(domain)
    if (!sa) {
      throw new Error(
        `没有注册 domain 为 "${domain}" 的子 Agent。已注册: ${[...this.subAgents.keys()].join(', ') || '无'}`,
      )
    }
    const task: TaskEnvelope = {
      ...TaskRequestSchema.parse(input),
      task_id: createTaskId(sa.spec.id),
      domain: sa.spec.id,
    }

    // —— 落库：任务登记（未传 db 时 taskCtx 为 null，直接执行） ——
    let taskCtx: { userId: number; subAgentId: number } | null = null
    if (this.db) {
      const butlerCtx = this.getButlerAgent()
      const subCtx = AgentContext.get(this.db, task.domain)
      if (!subCtx) {
        throw new Error(
          `数据库中没有子 agent "${task.domain}" 的注册记录，请先在装配时调用 ensureSubAgent(db, spec, ...)`,
        )
      }
      const userId = butlerCtx.resolveUser(this.ownerUsername)
      new TaskRepository(this.db).create({
        task_key: task.task_id,
        session_id: null, // 直派可脱离会话（定时任务/外部编排）；会话内派发经 chat 链路落 session
        user_id: userId,
        butler_agent_id: butlerCtx.agentId,
        sub_agent_id: subCtx.agentId,
        intent: task.intent,
        params: task.params,
        priority: task.priority,
        source: task.source,
        deadline: task.deadline ?? null,
      })
      taskCtx = { userId, subAgentId: subCtx.agentId }
    }

    const result = await sa.handleTask(task)

    // —— 落库：结果信封写回 + 事件 ——
    if (this.db && taskCtx) {
      new TaskRepository(this.db).complete(task.task_id, {
        status: result.status,
        summary: result.summary,
        detail: result.detail ?? null,
        error: result.error ?? null,
        error_code: result.error_code ?? null,
        suggestions: result.suggestions ?? null,
        completed_at: result.completed_at ?? null,
      })
      this.logEvent(undefined, taskCtx.userId, 'task.completed', {
        task_key: task.task_id,
        intent: task.intent,
        status: result.status,
        agent_id: taskCtx.subAgentId,
      })
    }
    return result
  }

  /** 解析（必要时入库）主管家身份 */
  private getButlerAgent(): AgentContext {
    if (!this.db) throw new Error('未注入数据库')
    if (!this.butlerAgent) {
      const ctx = AgentContext.get(this.db, 'butler')
      if (!ctx) {
        throw new Error('数据库中没有主管家记录，请先在装配时调用 ensureButlerAgent(db)')
      }
      this.butlerAgent = ctx
    }
    return this.butlerAgent
  }

  /** 会话登记 + 写入本轮 human 消息（内部：已确保 db 存在） */
  private beginTurn(message: string, userId: number): { sessionId: number; userId: number } {
    const butlerCtx = this.getButlerAgent()
    const sessionRepo = new SessionRepository(this.db!)
    // 复用该用户最近会话；无则新建（标题取首条消息前 24 字）
    const recent = sessionRepo.listByUser(userId, 1)[0]
    const sessionId = recent
      ? recent.session_id
      : sessionRepo.create({
          user_id: userId,
          agent_id: butlerCtx.agentId,
          title: message.slice(0, 24) || '新会话',
        }).session_id
    this.appendMessage(sessionId, 'human', message)
    return { sessionId, userId }
  }

  /** 写一条消息（内部：已确保 db 存在） */
  private appendMessage(
    sessionId: number,
    senderKind: 'human' | 'butler' | 'sub' | 'system',
    content: string,
  ): void {
    new MessageRepository(this.db!).append({
      session_id: sessionId,
      sender_kind: senderKind,
      sender_id: senderKind === 'butler' ? 'butler' : null,
      content,
    })
  }

  /** 事件流水（内部：已确保 db 存在；agent_id 走 payload 携带或默认但管） */
  private logEvent(
    sessionId: number | undefined,
    userId: number,
    eventType: string,
    payload: Record<string, unknown>,
  ): void {
    const { agent_id, ...rest } = payload
    new EventRepository(this.db!).log({
      session_id: sessionId ?? null,
      user_id: userId,
      agent_id: typeof agent_id === 'number' ? agent_id : this.getButlerAgent().agentId,
      event_type: eventType,
      payload: rest,
    })
  }

  /** 用但管模型执行一次纪要压缩（一次性调用，不带工具） */
  private async summarize(prompt: string): Promise<string> {
    const agent = new Agent({
      systemPrompt: SUMMARY_SYSTEM_PROMPT,
      model: this.model ?? getModel(),
    })
    return extractReplyText(await agent.invoke(prompt))
  }

  /** 按当前花名册构建管家 Agent（含 memory 工具；每次新实例） */
  private buildAgent(): Agent {
    return new Agent({
      systemPrompt:
        this.customPrompt ?? buildButlerSystemPrompt(this.listAgents(), Boolean(this.memory)),
      tools: [
        ...[...this.subAgents.values()].map((sa) => sa.toButlerTool()),
        ...(this.memory ? createMemoryTools(this.memory, 'butler') : []),
      ],
      model: this.model ?? getModel(),
      printer: false,
    })
  }

  /**
   * 模型调用：无 db 时沿用缓存实例（原行为，多轮靠进程内上下文）；
   * 有 db 时每轮新建实例（无状态化）——历史由 assembleMemory 注入本轮输入，
   * 上下文恒定为「纪要 + 窗口 + 本轮」，重启零失忆（Hermes 纪律）。
   */
  private invokeModel(input: string): Promise<unknown> {
    if (!this.db) return this.ensureAgent().invoke(input)
    return this.buildAgent().invoke(input)
  }

  /** 懒创建管家 Agent（仅无 db 缓存路径使用） */
  private ensureAgent(): Agent {
    if (!this.agent) {
      this.agent = this.buildAgent()
    }
    return this.agent
  }

  /** Strands Agent 不允许并发 invoke，这里把同一管家的调用串行化。 */
  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.invocationQueue.then(task, task)
    this.invocationQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }
}

/** ensureSubAgent 的局部包装：register 内联落库用（避免循环依赖提示） */
function ensureSubAgentRow(db: Db, spec: SubAgent['spec'], parentAgentId: number): void {
  const ctx = AgentContext.ensure(db, {
    agentKey: spec.id,
    role: 'sub',
    name: spec.name,
    domain: spec.domain,
    description: spec.description,
    systemPrompt: spec.systemPrompt,
    parentAgentId,
  })
  void ctx
}

/** 从 SDK 的 invoke 结果中提取人类可读的纯文本 */
function extractReplyText(result: unknown): string {
  if (typeof result === 'string') return result
  if (result && typeof result === 'object') {
    const r = result as { lastMessage?: { content?: unknown } }
    const content = r.lastMessage?.content
    if (Array.isArray(content)) {
      const texts = content
        .map((block) =>
          block && typeof block === 'object' && 'text' in block
            ? String((block as { text: unknown }).text)
            : '',
        )
        .filter(Boolean)
      if (texts.length > 0) return texts.join('\n')
    }
  }
  return JSON.stringify(result)
}
