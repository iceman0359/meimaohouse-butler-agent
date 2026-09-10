/**
 * 子 Agent 基类 —— 每个领域子 Agent 通过 defineSubAgent 声明自己。
 *
 * 封装内容：
 * 1. 用自己的 model + systemPrompt + tools 构建独立的 Strands Agent（每次任务隔离）；
 * 2. 约定结构化输出为 ResultEnvelope（Zod 校验，SDK 自动重试）；
 * 3. handleTask(task): 以 TaskEnvelope 为入参，返回类型安全的 ResultEnvelope；
 * 4. toButlerTool(): 把本子 Agent 包装成管家可调用的 tool()（Agent-as-Tool 模式）。
 *
 * 懒加载：defineSubAgent 只是声明，不创建模型/Agent；每次 handleTask 才创建 Agent。
 * 入口先 await configureModel()。
 *
 * 子 Agent 之间平级、互相不感知；协作一律经管家转派。
 */
import { Agent, tool } from '@strands-agents/sdk'
import { getModel, type ModelInstance } from './model.js'
import {
  TaskRequestSchema,
  TaskEnvelopeSchema,
  ResultEnvelopeSchema,
  createTaskId,
  type TaskRequest,
  type TaskEnvelope,
  type ResultEnvelope,
} from './protocol.js'
import type { Memory } from './memory.js'
import { createMemoryTools } from './memory.js'

/** Strands 工具实例类型（由 tool() 工厂推导，避免依赖 SDK 未公开的类型名） */
export type ButlerTool = ReturnType<typeof tool>

export interface SubAgentSpec {
  /** 唯一 id：小写字母开头，仅允许 a-z 0-9 _ -。即领域标识，如 chef */
  id: string
  /** 展示名，如 厨师 */
  name: string
  /** 领域名，如 厨房域 */
  domain: string
  /**
   * 能力描述 —— 管家模型靠它决定何时派活给你，必须写清：
   * "负责什么 + 典型任务意图有哪些"。写不好 = 管家找不到你。
   */
  description: string
  /** 领域职责与判断规则（不要写历史数据/对话记录，记忆走 Memory） */
  systemPrompt: string
  /** 领域内具象能力 = 工具列表（可选，可后续扩展） */
  tools?: ButlerTool[]
  /** 模型实例（缺省走 getModel()，即 configureModel()/环境变量配置） */
  model?: ModelInstance
  /** 记忆实现（缺省进程内内存） */
  memory?: Memory
}

export interface SubAgent {
  spec: SubAgentSpec
  /** 为单次任务创建隔离的 Strands Agent。 */
  createAgent(): Agent
  /** 直接以任务信封调用（供管家适配器与测试使用） */
  handleTask(task: TaskEnvelope): Promise<ResultEnvelope>
  /** 包装为管家工具列表中的一个 tool() */
  toButlerTool(): ButlerTool
}

export function defineSubAgent(spec: SubAgentSpec): SubAgent {
  if (!/^[a-z][a-z0-9_-]*$/.test(spec.id)) {
    throw new Error(
      `子 Agent id "${spec.id}" 不合法：必须小写字母开头，仅允许 a-z 0-9 _ -（如 chef）`,
    )
  }
  if (!spec.description.trim()) {
    throw new Error(`子 Agent "${spec.id}" 缺少 description：管家靠它决定何时派活`)
  }
  if (!spec.name.trim()) {
    throw new Error(`子 Agent "${spec.id}" 缺少 name`)
  }
  if (!spec.domain.trim()) {
    throw new Error(`子 Agent "${spec.id}" 缺少 domain`)
  }
  if (!spec.systemPrompt.trim()) {
    throw new Error(`子 Agent "${spec.id}" 缺少 systemPrompt`)
  }

  const memory = spec.memory
  const tools = [...(spec.tools ?? []), ...(memory ? createMemoryTools(memory, spec.id) : [])]

  /** 为单次任务创建 Agent，避免不同任务之间的消息历史串扰。 */
  const createAgent = (): Agent =>
    new Agent({
      id: spec.id,
      systemPrompt: buildSubAgentSystemPrompt(spec, memory),
      tools,
      model: spec.model ?? getModel(),
      structuredOutputSchema: ResultEnvelopeSchema,
      printer: false,
    })

  /** 执行任务：把 TaskEnvelope 交给子 Agent 模型，强制返回 ResultEnvelope */
  const handleTask = async (input: TaskEnvelope): Promise<ResultEnvelope> => {
    const fallbackTaskId =
      input && typeof input.task_id === 'string' && input.task_id ? input.task_id : 'unknown'
    try {
      const task = TaskEnvelopeSchema.parse(input)
      const raw = await createAgent().invoke(JSON.stringify(task))
      const envelope = (raw as { structuredOutput?: ResultEnvelope }).structuredOutput
      if (!envelope) {
        return {
          task_id: task.task_id,
          status: 'failed',
          summary: `${spec.name}未返回结构化结果`,
          error: '子 Agent 未返回 ResultEnvelope（structuredOutput 为空）',
          completed_at: new Date().toISOString(),
        }
      }
      return {
        ...envelope,
        task_id: task.task_id,
        completed_at: envelope.completed_at ?? new Date().toISOString(),
      }
    } catch (err) {
      return {
        task_id: fallbackTaskId,
        status: 'failed',
        summary: `${spec.name}执行任务失败`,
        error: err instanceof Error ? err.message : String(err),
        completed_at: new Date().toISOString(),
      }
    }
  }

  /** 包装为管家工具：管家模型只填 TaskRequest，系统补全信封 */
  const toButlerTool = (): ButlerTool =>
    tool({
      name: `subagent_${spec.id}`,
      description: `${spec.name}（${spec.domain}）。${spec.description} 需要该领域的能力时，调用此工具派发任务。`,
      inputSchema: TaskRequestSchema,
      callback: async (input: TaskRequest) => {
        const task: TaskEnvelope = {
          ...input,
          task_id: createTaskId(spec.id),
          domain: spec.id,
        }
        const result = await handleTask(task)
        // 返回 JSON 字符串，模型在下一轮推理中可读到结构化内容
        return JSON.stringify(result)
      },
    })

  return {
    spec,
    createAgent,
    handleTask,
    toButlerTool,
  }
}

/** 组装子 Agent 的 system prompt：职责 + 记忆指针（如果有） */
function buildSubAgentSystemPrompt(spec: SubAgentSpec, memory?: Memory): string {
  const lines = [
    `你是庄园的${spec.name}，${spec.domain}由你全权负责。`,
    '',
    spec.systemPrompt,
    '',
    '工作要求：',
    '- 你收到的是任务信封（TaskEnvelope），按 intent 判断意图，必要时调用工具完成；',
    '- 必须以 ResultEnvelope 格式返回：status(summary 用面向人的一句话) + detail(结构化) + suggestions(需要其他子 Agent 协作时提出，由管家转派)；',
    '- 不要编造数据：工具没返回的信息，明确写"暂无数据"；',
    '- 一次只处理一个任务，不要臆测任务之外的请求。',
  ]
  if (memory) {
    lines.push('', '- 你有长期记忆可用，重要事实（库存、计划、偏好）写入记忆，而不是留在对话里。')
  }
  return lines.join('\n')
}
