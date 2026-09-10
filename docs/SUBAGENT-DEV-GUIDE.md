# 子 Agent 开发规范（SUBAGENT-DEV-GUIDE）

> 给所有子 Agent 开发者的对接手册。读完本文 + [protocol.md](protocol.md) 即可开工。
> 完整可运行示例：`packages/agents/chef`（照抄它的结构）。

## 0. 核心概念（30 秒版）

- **一个领域 = 一个子 Agent**（如厨房域 → chef，清洁域 → cleaner），领域内所有具象能力（扫地、洗衣、下单买菜）都是它自己的**工具**。
- 子 Agent 之间**平级、互不感知、不直接调用**；协作一律经大管家转派。
- 子 Agent 有**独立上下文**：管家只看到你返回的 `ResultEnvelope`，你的记忆/工具/长上下文不占管家窗口。
- 对接方式：用 `defineSubAgent()` 声明自己 → 管家注册后自动变成它的一个可调用工具（Agent-as-Tool）。

```
管家（注册你的 toButlerTool）
  └─ 派发 TaskEnvelope ──► 你的子 Agent（独立模型 + 你的 systemPrompt + 你的工具）
                               └─ 返回 ResultEnvelope ──► 管家转述给人类
```

## 1. 新增一个子 Agent = 新开一个文件夹

目录模板（照抄 chef）：

```
packages/agents/<agent-id>/
├── package.json          # name: @meimaohouse/<agent-id>-agent；deps 照抄 chef
├── tsconfig.json         # 照抄 chef（extends ../../../tsconfig.base.json）
├── README.md             # 一句话说明领域与能力
└── src/
    ├── index.ts          # 默认导出 defineSubAgent({...})   ← 唯一的对接出口
    └── tools.ts          # 领域内工具列表（可拆多个文件）
```

**必须遵守：**
- `<agent-id>` 小写字母开头，仅 `a-z 0-9 _ -`（如 `chef`、`cleaner`）；它同时是 `id` 与 `domain`。
- 包名 `@meimaohouse/<agent-id>-agent`，dependencies 必须含 `@meimaohouse/agent-sdk`。
- 工具/协议类型一律从 `@meimaohouse/agent-sdk` 导入，**禁止复制 schema**。

## 2. defineSubAgent 必填字段

```ts
import { defineSubAgent } from '@meimaohouse/agent-sdk'
import { yourTools } from './tools.js'

export const myAgent = defineSubAgent({
  id: 'cleaner',              // 唯一 id（= domain），小写
  name: '清洁工',              // 展示名
  domain: '清洁域',            // 领域名
  description: '……',          // ★ 路由关键，见第 3 节
  systemPrompt: '……',         // 职责与判断规则，见第 5 节
  tools: [yourTools],         // 领域能力，见第 4 节
  // model / memory: 可选，缺省走环境变量模型 + 进程内记忆
})

export default myAgent
```

注册进管家（由管家侧做，或先本地联调）：

```ts
const butler = new Butler({ subAgents: [myAgent] })   // 或 butler.register(myAgent)
```

## 3. description 写作规范（决定管家能不能找到你）

管家的模型靠工具描述决定"这个活派给谁"。写不好 = 管家永远不调你。

**结构：`负责什么领域 + 覆盖的典型意图 + 边界`**

好例子：
> 掌管厨房域：冰箱库存与食材新鲜度、菜品采购下单、厨房安全检查、剩菜处理、饮食数据统计与饮食控制建议。

坏例子：
> 厨师。（管家不知道你管什么，无法路由）

**自检**：把 description 给一个不懂项目的人看，他能说出"什么需求该派给你"吗？

## 4. 工具规范（领域内具象能力 = 插件）

- 每个具象能力一个工具：`tool({ name, description, inputSchema, callback })`。
- 工具名 `snake_case`，一眼看出用途：`fridge_inventory`、`order_groceries`。
- `inputSchema` 用 Zod，字段加中文 `describe()`（模型靠它填参数）。
- `callback` 返回 **JSON 字符串**（`JSON.stringify`），不要返回对象/类实例。
- **不编造数据**：没接真实数据源就返回占位/演示数据并注释 `TODO: 接入 xxx`（参考 chef 的 `src/tools.ts`）。
- 领域内新能力随时加：改 `tools.ts` 加一个 `tool()` 即可，**不需要改管家代码**。

```ts
export const orderGroceriesTool = tool({
  name: 'order_groceries',
  description: '在线下单购买食材并配送到家。',
  inputSchema: z.object({
    items: z.array(z.object({ name: z.string(), qty: z.number().int().positive() })),
  }),
  callback: async (input) => JSON.stringify({ order_id: 'DEMO-xxx', items: input.items }),
})
```

## 5. systemPrompt 写作规范（上下文纪律）

- 只写**职责范围 + 判断规则 + 协作边界**，不写历史数据/对话记录。
- 长期事实（库存、计划、偏好）放 `Memory`（下一迭代接外部存储），不要写死在 prompt 里——否则就是"Hermes 越用越降智"的复现。
- 必须遵守（sdk 会自动追加到你的 prompt 尾部）：
  - 收到 TaskEnvelope 按 `intent` 判断意图；
  - 必须以 ResultEnvelope 返回（status/summary/detail/suggestions）；
  - 不编造数据；一次只处理一个任务。

## 6. 结果信封规范（怎么"交差"）

| 场景 | status | summary 怎么写 | 附带 |
|---|---|---|---|
| 办成了 | `done` | 面向人的一句话结果 | `detail` 放结构化数据 |
| 失败了 | `failed` | 一句话说明失败 | `error` 写原因 |
| 要人类拍板 | `needs_human` | 把决策点说清楚 | 选项放 `detail` |
| 已排期 | `deferred` | 说明安排了什么、什么时候 | `detail` 放排期 |

**协作**：需要其他子 Agent（如采购后要清洁工收纳）→ 在 `suggestions` 里写"请管家转派 cleaner：……"，**不要自己找对方**。

## 7. 模型与本地运行

- 框架不绑厂商，也不强制安装厂商 SDK：入口先 `await configureModel()`（读环境变量 `MODEL_PROVIDER`），见 `examples/butler-demo.ts`。
- `.env` 设 `MODEL_PROVIDER`（见根目录 `.env.example`）；用 OpenAI 需先 `npm i openai`。
- 测试/自定义模型：`setModel(实例)` 注入，无需任何厂商。
- 单测你的工具/业务逻辑不需要模型：直接调用 tools 的 callback 函数即可。

## 8. 提交流程（遵守 CONTRIBUTING.md）

```
git checkout -b feat/<agent-id>-xxx     # 如 feat/cleaner-basic
git commit -m "feat(cleaner): 清洁域基础能力"
git push origin feat/cleaner-basic      # 发 PR → 1 人 review → 合并 main
```

## 9. 提交前 Checklist

- [ ] 目录/包名/id 符合规范（`packages/agents/<id>/`、`@meimaohouse/<id>-agent`）
- [ ] `description` 写完且自检过（路由可发现）
- [ ] 所有工具：Zod schema + 中文 describe + 返回 JSON 字符串
- [ ] systemPrompt 无历史数据；不编造数据（占位有 TODO 注释）
- [ ] 涉及跨领域协作时用了 `suggestions`，没有直接调别的子 Agent
- [ ] `npm run build` 通过；领域工具单测通过
- [ ] 无敏感信息（token/密钥）；无调试残留
