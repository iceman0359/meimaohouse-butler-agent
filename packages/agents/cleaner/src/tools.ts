import { defineDomainTool, type DomainTool } from '@meimaohouse/agent-sdk'
import { z } from 'zod'
import type { CleanerCapabilities } from './capabilities.js'

/** 根据宿主实际注入的能力动态生成工具。 */
export function createCleanerTools(capabilities: CleanerCapabilities = {}): DomainTool[] {
  const tools: DomainTool[] = []

  if (capabilities.cleaning) {
    const provider = capabilities.cleaning
    tools.push(
      defineDomainTool({
        name: 'cleaning_status',
        description: '读取清洁设备或清洁服务返回的真实区域状态。',
        inputSchema: z.object({}),
        execute: () => provider.getStatus(),
      }),
      defineDomainTool({
        name: 'start_cleaning',
        description: '调用已配置的清洁设备或服务开始清洁。',
        inputSchema: z.object({
          area: z.string().min(1).describe('清洁区域'),
          mode: z.enum(['quick', 'standard', 'deep']).optional().describe('清洁模式'),
          note: z.string().optional().describe('备注'),
        }),
        execute: (input) => provider.start(input),
      }),
    )
  }

  if (capabilities.scheduling) {
    const provider = capabilities.scheduling
    tools.push(
      defineDomainTool({
        name: 'schedule_cleaning_service',
        description: '向已配置的服务平台提交清洁或上门服务预约。',
        inputSchema: z.object({
          service: z.string().min(1).describe('服务类型'),
          preferredTime: z.string().optional().describe('期望时间'),
          note: z.string().optional().describe('备注'),
        }),
        execute: (input) => provider.book(input),
      }),
    )
  }

  if (capabilities.laundry) {
    const provider = capabilities.laundry
    tools.push(
      defineDomainTool({
        name: 'laundry_status',
        description: '读取洗衣机或衣物处理设备返回的真实状态。',
        inputSchema: z.object({}),
        execute: () => provider.getStatus(),
      }),
    )
  }

  return tools
}
