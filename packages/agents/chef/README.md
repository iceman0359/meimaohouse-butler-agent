# @meimaohouse/chef-agent — 厨师 Agent（厨房域）

示例子 Agent：展示"一个领域一个子 Agent"的标准写法。

- 领域：厨房域（id: `chef`）
- 能力：冰箱库存与新鲜度、菜品采购下单、厨房安全检查、饮食数据统计
- 工具目前为**演示/占位实现**（假数据），接入真实硬件与平台时替换 `src/tools.ts` 中各 callback

开发规范见 [docs/SUBAGENT-DEV-GUIDE.md](../../../docs/SUBAGENT-DEV-GUIDE.md)
