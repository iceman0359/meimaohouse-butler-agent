/**
 * 最小演示：人类 → 大管家 → 厨师子 Agent → 结果转述
 *
 * 运行前：
 *   1. npm install（根目录）
 *   2. 配置模型厂商：cp .env.example .env 并填入 MODEL_PROVIDER
 *   3. npm run demo
 *
 * 也可以不经过模型直派（用于测试/编排）：
 *   butler.delegate({ domain: 'chef', intent: 'inventory_check' })
 */
import { configureModel } from '@meimaohouse/agent-sdk'
import { Butler } from '@meimaohouse/butler-core'
import chef from '@meimaohouse/chef-agent'
import cleaner from '@meimaohouse/cleaner-agent'

async function main() {
  // 先配置模型厂商（读环境变量；也可显式 configureModel({ provider: 'openai' })）
  await configureModel()

  const butler = new Butler({ subAgents: [chef, cleaner] })

  console.log('👥 管家当前花名册:')
  for (const a of butler.listAgents()) {
    console.log(`  - ${a.id}（${a.name} / ${a.domain}）`)
  }

  console.log('\n🗣 人类: 晚上想吃得清淡点，看看冰箱里有什么能做的？\n')
  const reply = await butler.chat('晚上想吃得清淡点，看看冰箱里有什么能做的？')
  console.log(`🧑‍💼 管家: ${reply}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
