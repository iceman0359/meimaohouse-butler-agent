/**
 * 管家 ↔ 子 Agent 通信协议（信封模型）
 *
 * 链路：人类 → 管家（模型决策）→ 派发 TaskRequest → 系统补全为 TaskEnvelope
 *       → 子 Agent 执行 → 返回 ResultEnvelope → 管家转述给人类
 *
 * 全部字段必须 JSON 可序列化。
 */
import { z } from 'zod'

/* ---------------- 任务 ---------------- */

export const TaskPrioritySchema = z.enum(['low', 'normal', 'high'])
export type TaskPriority = z.infer<typeof TaskPrioritySchema>

/**
 * 管家模型向子 Agent 工具传入的入参（尽量精简，模型只负责"派什么活"，
 * 不负责生成 ID 等系统字段）。
 */
export const TaskRequestSchema = z.object({
  intent: z
    .string()
    .min(1)
    .describe('任务意图（动词短语），如 inventory_check / order_groceries / safety_check'),
  params: z
    .record(z.string(), z.unknown())
    .default({})
    .describe('任务参数（领域自定义，可空对象）'),
  priority: TaskPrioritySchema.default('normal').describe('优先级'),
  deadline: z.string().optional().describe('截止时间（ISO 8601 或自然语言）'),
  source: z.string().default('human').describe('请求来源，默认 human'),
})
export type TaskRequest = z.infer<typeof TaskRequestSchema>

/**
 * 子 Agent 实际收到的完整任务信封（由管家侧适配器补全 task_id / domain）。
 */
export const TaskEnvelopeSchema = TaskRequestSchema.extend({
  task_id: z.string().min(1).describe('任务唯一 ID，由管家生成，格式 <agentId>_<时间戳>_<随机>'),
  domain: z.string().min(1).describe('目标领域标识，即子 Agent 的 id，如 chef'),
})
export type TaskEnvelope = z.infer<typeof TaskEnvelopeSchema>

/* ---------------- 结果 ---------------- */

export const TaskStatusSchema = z.enum(['done', 'failed', 'needs_human', 'deferred'])
export type TaskStatus = z.infer<typeof TaskStatusSchema>

/**
 * 子 Agent 返回给管家的结果信封。
 * - done         成功完成
 * - failed       执行失败（error 必填）
 * - needs_human  需要人类决策/确认（如大额采购、上门服务预约）
 * - deferred     暂缓/已排期（如定时任务已登记）
 */
export const ResultEnvelopeSchema = z.object({
  task_id: z.string().min(1).describe('对应任务的 task_id'),
  status: TaskStatusSchema.describe('执行状态'),
  summary: z.string().min(1).describe('一句话结果，管家会转述给人类，请用面向人的语言'),
  detail: z
    .record(z.string(), z.unknown())
    .optional()
    .describe('结构化详情（可选），供管家/后续任务引用'),
  error: z.string().optional().describe('失败原因（status=failed 时必填）'),
  suggestions: z
    .array(z.string())
    .optional()
    .describe('给管家的后续建议。需要其他子 Agent 协作时，在这里说明，由管家转派'),
  completed_at: z.string().optional().describe('完成时间 ISO 8601'),
})
export type ResultEnvelope = z.infer<typeof ResultEnvelopeSchema>

/* ---------------- 工具函数 ---------------- */

/** 生成任务 ID：<agentId>_<base36时间戳>_<6位随机> */
export function createTaskId(agentId: string): string {
  return `${agentId}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}
