import {
  defineSubAgent,
  type Memory,
  type ModelInstance,
  type SubAgent,
} from '@meimaohouse/agent-sdk'
import type { CleanerCapabilities } from './capabilities.js'
import { createCleanerTools } from './tools.js'

export * from './capabilities.js'
export * from './tools.js'

export interface CleanerAgentOptions {
  capabilities?: CleanerCapabilities
  model?: ModelInstance
  memory?: Memory
}

/**
 * 创建清洁工 Agent 壳。
 *
 * 不传 capabilities 时不会注册任何清洁工具，模型只能明确报告能力未配置。
 */
export function createCleanerAgent(options: CleanerAgentOptions = {}): SubAgent {
  const tools = createCleanerTools(options.capabilities)
  const configured = [
    options.capabilities?.cleaning ? '清洁执行' : '',
    options.capabilities?.scheduling ? '服务预约' : '',
    options.capabilities?.laundry ? '洗衣状态' : '',
  ].filter(Boolean)

  return defineSubAgent({
    id: 'cleaner',
    name: '清洁工',
    domain: '清洁域',
    description:
      '掌管清洁域：房间清洁、扫地机器人、洗衣与床品提醒、上门清洁和收纳服务预约。',
    systemPrompt: `你的工作范围：
- 房间与公共区域清洁；
- 扫地机器人和其他清洁设备；
- 洗衣与床品更换提醒；
- 上门清洁、洗鞋和收纳服务预约。

当前可用能力：${configured.length > 0 ? configured.join('、') : '无'}。

行为准则：
- 只能根据已注册工具返回的真实数据作答，禁止编造设备状态、清洁完成结果或预约结果；
- 如果所需能力没有对应工具，返回 status=unavailable，并设置 error_code=capability_not_configured；
- 涉及费用、上门时间或隐私区域时需要人类确认，返回 status=needs_human；
- 需要其他领域协作时写入 suggestions，由管家转派。`,
    tools,
    model: options.model,
    memory: options.memory,
  })
}

/** 默认导出空壳 Agent，供应用层直接装配。 */
export const cleaner = createCleanerAgent()

export default cleaner
