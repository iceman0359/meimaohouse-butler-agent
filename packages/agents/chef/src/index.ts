import {
  defineSubAgent,
  type Memory,
  type ModelInstance,
  type SubAgent,
} from '@meimaohouse/agent-sdk'
import type { ChefCapabilities } from './capabilities.js'
import { createChefTools } from './tools.js'

export * from './capabilities.js'
export * from './tools.js'

export interface ChefAgentOptions {
  capabilities?: ChefCapabilities
  model?: ModelInstance
  memory?: Memory
}

/**
 * 创建厨师 Agent 壳。
 *
 * 不传 capabilities 时不会注册任何厨房工具，模型只能明确报告能力未配置，
 * 不能伪造库存、订单或安全检查结果。
 */
export function createChefAgent(options: ChefAgentOptions = {}): SubAgent {
  const tools = createChefTools(options.capabilities)
  const configured = [
    options.capabilities?.fridgeInventory ? '冰箱库存' : '',
    options.capabilities?.groceryOrdering ? '食材采购' : '',
    options.capabilities?.kitchenSafety ? '厨房安全' : '',
    options.capabilities?.mealStats ? '饮食统计' : '',
  ].filter(Boolean)

  return defineSubAgent({
    id: 'chef',
    name: '厨师',
    domain: '厨房域',
    description:
      '掌管厨房域：冰箱库存与食材新鲜度、食材采购、厨房安全检查、剩菜处理、饮食数据统计与饮食控制建议。',
    systemPrompt: `你的工作范围：
- 冰箱库存与食材新鲜度；
- 食材采购与配送；
- 厨房安全检查；
- 剩菜处理；
- 饮食数据统计与饮食控制建议。

当前可用能力：${configured.length > 0 ? configured.join('、') : '无'}。

行为准则：
- 只能根据已注册工具返回的真实数据作答，禁止编造库存、订单、传感器状态或饮食记录；
- 如果所需能力没有对应工具，返回 status=unavailable，并设置 error_code=capability_not_configured；
- 需要人类拍板的事项返回 status=needs_human；
- 需要其他领域协作时写入 suggestions，由管家转派。`,
    tools,
    model: options.model,
    memory: options.memory,
  })
}

/** 默认导出空壳 Agent，供应用层直接装配。 */
export const chef = createChefAgent()

export default chef
