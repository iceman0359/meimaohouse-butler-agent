/**
 * 厨师 Agent 的领域工具 —— 厨房域内一切具象能力都是"插件"。
 * 当前为演示实现（假数据 / 占位），接入真实硬件与平台时替换各 callback 即可。
 */
import { tool } from '@strands-agents/sdk'
import { z } from 'zod'

/** 冰箱库存与新鲜度（理想情况接冰箱摄像头/传感器；当前返回演示数据） */
export const fridgeInventoryTool = tool({
  name: 'fridge_inventory',
  description: '查看冰箱当前库存与食材新鲜度，返回食材清单、数量、剩余可存放天数。',
  inputSchema: z.object({}),
  callback: async () => {
    // TODO: 接入冰箱传感器/摄像头；当前为演示数据
    return JSON.stringify({
      items: [
        { name: '鸡蛋', qty: 6, unit: '个', expire_in_days: 7 },
        { name: '牛奶', qty: 1, unit: '盒', expire_in_days: 2, note: '快过期，建议优先使用' },
        { name: '西兰花', qty: 2, unit: '颗', expire_in_days: 4 },
        { name: '三文鱼', qty: 0, unit: '份', note: '已空，需要补充' },
      ],
    })
  },
})

/** 在线下单买菜（当前为占位实现，返回模拟订单号） */
export const orderGroceriesTool = tool({
  name: 'order_groceries',
  description: '在线下单购买食材并配送到家。一次调用为一单，支持多件商品。',
  inputSchema: z.object({
    items: z
      .array(
        z.object({
          name: z.string().describe('商品名'),
          qty: z.number().int().positive().describe('数量'),
        }),
      )
      .describe('要购买的食材清单'),
    note: z.string().optional().describe('备注（如品牌偏好、紧急程度）'),
  }),
  callback: async (input) => {
    // TODO: 接入生鲜电商/外卖平台 API；当前为占位
    return JSON.stringify({
      order_id: `DEMO-${Date.now().toString(36)}`,
      items: input.items,
      note: input.note ?? null,
      status: 'placed',
      estimated_delivery: '2小时内',
    })
  },
})

/** 厨房安全检查（当前为占位） */
export const kitchenSafetyCheckTool = tool({
  name: 'kitchen_safety_check',
  description: '执行厨房安全巡检：燃气、用电、火源、清洁状况，返回检查项与风险清单。',
  inputSchema: z.object({}),
  callback: async () => {
    // TODO: 接入烟雾/燃气传感器、智能插座；当前为占位
    return JSON.stringify({
      checked_at: new Date().toISOString(),
      items: [
        { area: '燃气灶', status: 'ok', note: '无泄漏' },
        { area: '插座', status: 'warning', note: '微波炉插座负载偏高，建议检查' },
        { area: '地面', status: 'ok', note: '无积水' },
      ],
      overall: 'warning',
    })
  },
})

/** 饮食数据统计（当前为占位） */
export const mealStatsTool = tool({
  name: 'meal_stats',
  description: '查询最近一段时间的饮食数据统计（就餐记录、营养摄入趋势），用于饮食控制建议。',
  inputSchema: z.object({
    days: z.number().int().positive().max(90).default(7).describe('统计最近多少天'),
  }),
  callback: async (input) => {
    // TODO: 接入就餐记录数据源；当前为占位
    return JSON.stringify({
      days: input.days,
      records: 21,
      avg_calories_per_day: 2150,
      trend: '近一周热量摄入略高于目标(2000)，油脂偏多',
    })
  },
})
