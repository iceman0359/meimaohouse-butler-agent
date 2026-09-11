/**
 * 领域能力适配器。
 *
 * 领域包只定义能力接口和工具描述，真实硬件、平台 API、数据库等实现由宿主注入。
 * 这样框架本身不会内置假数据，也不会把厂商细节耦合进 Agent。
 */
import { tool, type ToolContext } from '@strands-agents/sdk'
import type { z } from 'zod'

export type DomainTool = ReturnType<typeof tool>

export interface DomainToolFailure {
  ok: false
  error: string
  code?: string
}

export interface DomainToolSuccess<T> {
  ok: true
  data: T
}

export type DomainToolResult<T> = DomainToolSuccess<T> | DomainToolFailure

export interface DomainToolSpec<TInput extends z.ZodType, TOutput> {
  name: string
  description: string
  inputSchema: TInput
  execute(input: z.infer<TInput>, context?: ToolContext): Promise<TOutput>
}

/**
 * 把领域能力实现包装成 Strands 工具。
 *
 * 所有返回值统一为 JSON 字符串，异常会转换成结构化失败结果，避免模型把工具异常
 * 误解成成功。
 */
export function defineDomainTool<TInput extends z.ZodType, TOutput>(
  spec: DomainToolSpec<TInput, TOutput>,
): DomainTool {
  return tool({
    name: spec.name,
    description: spec.description,
    inputSchema: spec.inputSchema,
    callback: async (input: z.infer<TInput>, context?: ToolContext) => {
      try {
        const data = await spec.execute(input, context)
        return JSON.stringify({ ok: true, data } satisfies DomainToolSuccess<TOutput>)
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: 'capability_error',
        } satisfies DomainToolFailure)
      }
    },
  })
}
