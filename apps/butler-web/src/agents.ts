/**
 * 管家 Web 界面装配：新子 Agent 在这里加一行即可出现在界面与花名册里。
 */
import type { SubAgent } from '@meimaohouse/agent-sdk'
import chef from '@meimaohouse/chef-agent'
import cleaner from '@meimaohouse/cleaner-agent'

export const agents: SubAgent[] = [chef, cleaner]
