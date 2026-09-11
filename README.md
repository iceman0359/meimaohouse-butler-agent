# meimaohouse-butler-agent

> 大庄园式管家 Agent 框架：**一个总协调管家 + 平级领域子 Agent**，人类只见管家。

基于 [Strands Agents](https://strandsagents.com/)（TypeScript SDK）实现：管家是一个独立的 Strands Agent，每个子 Agent 是另一个独立 Agent，通过 **Agent-as-Tool** 模式注册为管家的可调用工具。子 Agent 每次任务使用独立 Agent 实例，管家只看到结果信封。

## 架构

```
人类 👤（唯一入口：butler.chat()）
 │
 ▼
大管家 Agent（packages/butler-core）
 │  调度 · 记忆 · 汇报（model-driven 决策派活）
 │  子 Agent 注册表 → 每个子 Agent 包装成一个 tool()
 ▼
┌──────────────┬────────────────┐
│ chef         │ cleaner        │
│ 厨师 Agent    │ 清洁工 Agent    │
└──────────────┴────────────────┘
   (packages/agents/*，平级、互不调用，协作经管家)
```

### 核心设计原则

1. **见面隔离**：人类与子 Agent 永不直接交互，一切经管家转述。
2. **领域抽象 > 工具具象**：一个领域一个子 Agent；领域内能力通过接口注入，只有真实实现存在时才生成工具。
3. **上下文预算保护**：子 Agent 独立上下文 + 结构化结果信封，管家不背领域知识。
4. **不做假成功**：仓库不内置模拟库存、模拟订单、模拟设备状态；未配置能力时返回 `unavailable`。
5. **厂商可插拔**：模型厂商走环境变量（`MODEL_PROVIDER`），框架零绑定。

## 包结构

| 包 | 说明 |
|---|---|
| `packages/agent-sdk` | 子 Agent 接入 SDK：协议信封（Task/Result）、`defineSubAgent`、能力适配器（`defineDomainTool`）、模型工厂、记忆接口与记忆工具 |
| `packages/db` | 通用数据库层：3NF SQLite schema + 主/子 agent 通用存储接口（用户/会话/消息/任务/记忆/购物/家务/事件），见 [docs/DATABASE.md](docs/DATABASE.md) |
| `packages/butler-core` | 大管家核心：`Butler` 主类（chat / delegate / register）、工作记忆组装（纪要 + 滑动窗口）、管家 prompt |
| `packages/agents/chef` | 厨房域 Agent 壳 + 能力接口 |
| `packages/agents/cleaner` | 清洁域 Agent 壳 + 能力接口 |
| `apps/butler-web` | 大管家 Web 聊天界面 + 数据库浏览器（/db.html） |

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 MODEL_PROVIDER
npm run demo           # CLI：人类 → 管家 → 领域 Agent → 汇报
npm run demo:db        # 数据库通用接口演示（不需要模型）
npm run db:inspect     # 查看数据库结构与数据
npm run web            # Web 界面：浏览器打开 http://127.0.0.1:8790（/db.html 浏览数据库）
npm test               # 构建并运行核心测试（npm run test:db 为数据库层测试）
```

入口先 `await configureModel()` 再 `new Butler(...)`（见 `examples/butler-demo.ts`）；
未配置模型厂商时首次调用会快速失败并提示。

### 持久化与记忆（默认开启）

`apps/butler-web` 启动即建库（`BUTLER_DB_PATH`，缺省 `./data/butler.db`），管家与全部子 Agent 身份自动入库，对话/任务/事件全量落库，重启不丢。管家的记忆采用「长期纪要 + 滑动窗口」双轨（详见 [docs/DATABASE.md](docs/DATABASE.md) 第 9 节）：

- **长期纪要**：历史超过阈值时自动压缩成 ≤600 字纪要（解决即弃 / 过期自灭），存 `agent_memories` 表；
- **滑动窗口**：每轮从数据库现读最近 20 条消息，上下文恒定有界；
- **memory 工具**：管家与子 Agent 的 `memory_get/set/append/delete` 直接落到 SQLite（`createSqliteMemory`）。

### Web 界面

`npm run web` 启动后打开 http://127.0.0.1:8790，即可在浏览器里和管家对话：
- 顶部显示模型连接状态与子 Agent 花名册
- 新子 Agent 在 `apps/butler-web/src/agents.ts` 加一行即可出现在界面

## 领域能力接入

`chef` 和 `cleaner` 默认只是空壳，不包含任何假数据。宿主在创建 Agent 时注入能力实现：

```ts
const chef = createChefAgent({
  capabilities: {
    fridgeInventory: myFridgeProvider,
    groceryOrdering: myGroceryProvider,
  },
})
```

没有注入的能力不会注册工具。Agent 收到相关任务时必须返回 `unavailable`，不能伪造结果。

## 给子 Agent 开发者

👉 **先读 [docs/SUBAGENT-DEV-GUIDE.md](docs/SUBAGENT-DEV-GUIDE.md)**（对接规范 + 目录模板 + checklist）
👉 协议细节见 [docs/protocol.md](docs/protocol.md)
👉 协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 实施路线

1. ✅ 框架 + 大管家骨架（调度 / 注册 / 汇报 / 厂商抽象）
2. ✅ 子 Agent 接入 SDK + 开发规范
3. ✅ 保留 `chef` / `cleaner` 两个领域壳与能力接口
4. ✅ 通用数据库层（3NF SQLite）+ 工作记忆（纪要 + 窗口）+ 数据库浏览器
5. 🔜 注入真实工具 / 硬件（MCP、冰箱传感器、电商下单、清洁设备）

## License

MIT
