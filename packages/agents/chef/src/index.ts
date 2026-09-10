/**
 * 厨师 Agent（厨房域）—— 子 Agent 开发的完整示例。
 * 新子 Agent 照此结构：packages/agents/<id>/src/index.ts 默认导出 defineSubAgent(...)
 *
 * 记忆注入：createChef({ memory }) 可传入 SQLite 记忆（@meimaohouse/db 的
 * createSqliteMemory），让冰箱库存/饮食记录重启不丢；默认导出走进程内记忆。
 */
import { defineSubAgent, type Memory } from '@meimaohouse/agent-sdk'
import {
  fridgeInventoryTool,
  orderGroceriesTool,
  kitchenSafetyCheckTool,
  mealStatsTool,
} from './tools.js'

const spec = {
  id: 'chef',
  name: '厨师',
  domain: '厨房域',
  description:
    '掌管厨房域：冰箱库存与食材新鲜度、菜品采购下单、厨房安全检查、剩菜处理、饮食数据统计与饮食控制建议。',
  systemPrompt: `你的工作范围：
- 冰箱库存：需要时调用 fridge_inventory 查看，食材快过期要在 summary 中提示并建议采购；
- 采购：按需求调用 order_groceries 下单，优先补空缺与临期食材；
- 安全：定期或按请求执行 kitchen_safety_check，发现风险立即在 summary 中明确警告；
- 饮食：结合 meal_stats 给出饮食控制建议（控制热量、均衡营养）。

行为准则：
- 数据一律来自工具，工具没返回的信息写"暂无数据"，不编造；
- 需要人类拍板的事（如大额采购、更换设备）返回 status=needs_human；
- 采购后如需清洁/收纳等其它领域配合，在 suggestions 中提出，由管家转派。`,
  tools: [fridgeInventoryTool, orderGroceriesTool, kitchenSafetyCheckTool, mealStatsTool],
}

/** 工厂：注入 SQLite 记忆等可选依赖（主 agent 装配时调用） */
export function createChef(opts: { memory?: Memory } = {}) {
  return defineSubAgent({ ...spec, memory: opts.memory })
}

export const chef = createChef()

export default chef
