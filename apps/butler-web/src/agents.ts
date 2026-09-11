/**
 * 管家 Web 界面装配：新子 Agent 在这里加一行即可出现在界面与花名册里。
 */
import type { SubAgent } from '@meimaohouse/agent-sdk'
import barista from '@meimaohouse/barista-agent'
import chef from '@meimaohouse/chef-agent'

export const agents: SubAgent[] = [
  chef,
  barista,
  // 新子 Agent 在此追加，如：
  // cleaner, appliance, shopping, ...
]
