import { defineDomainTool, type DomainTool } from '@meimaohouse/agent-sdk'
import { z } from 'zod'
import type { ChefCapabilities } from './capabilities.js'

/** 根据宿主实际注入的能力动态生成工具，没有实现的能力不会暴露给模型。 */
export function createChefTools(capabilities: ChefCapabilities = {}): DomainTool[] {
  const tools: DomainTool[] = []

  if (capabilities.fridgeInventory) {
    const provider = capabilities.fridgeInventory
    tools.push(
      defineDomainTool({
        name: 'fridge_inventory',
        description: '读取冰箱库存、数量和食材新鲜度。',
        inputSchema: z.object({}),
        execute: () => provider.read(),
      }),
    )
  }

  if (capabilities.groceryOrdering) {
    const provider = capabilities.groceryOrdering
    tools.push(
      defineDomainTool({
        name: 'order_groceries',
        description: '向已配置的采购平台提交食材订单。',
        inputSchema: z.object({
          items: z
            .array(
              z.object({
                name: z.string().min(1).describe('商品名'),
                quantity: z.number().int().positive().describe('数量'),
              }),
            )
            .min(1)
            .describe('要购买的商品'),
          note: z.string().optional().describe('备注'),
        }),
        execute: ({ items, note }) => provider.placeOrder({ items, note }),
      }),
    )
  }

  if (capabilities.kitchenSafety) {
    const provider = capabilities.kitchenSafety
    tools.push(
      defineDomainTool({
        name: 'kitchen_safety_check',
        description: '执行厨房安全巡检并返回传感器或巡检系统提供的真实结果。',
        inputSchema: z.object({}),
        execute: () => provider.inspect(),
      }),
    )
  }

  if (capabilities.mealStats) {
    const provider = capabilities.mealStats
    tools.push(
      defineDomainTool({
        name: 'meal_stats',
        description: '读取指定天数内的真实饮食统计。',
        inputSchema: z.object({
          days: z.number().int().positive().max(365).default(7).describe('统计最近多少天'),
        }),
        execute: ({ days }) => provider.read(days),
      }),
    )
  }

  return tools
}
