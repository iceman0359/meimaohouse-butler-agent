# meimaohouse-butler-agent

> 大庄园式管家 Agent 框架：**一个总协调管家 + 平级领域子 Agent**，人类只见管家。

基于 [Strands Agents](https://strandsagents.com/)（TypeScript SDK）实现：管家是一个独立的 Strands Agent，每个子 Agent 是另一个独立 Agent，通过 **Agent-as-Tool** 模式注册为管家的可调用工具——子 Agent 上下文天然隔离，管家只看到结果信封，根治上下文膨胀导致的降智。

## 架构

```
人类 👤（唯一入口：butler.chat()）
 │
 ▼
大管家 Agent（packages/butler-core）
 │  调度 · 记忆 · 汇报（model-driven 决策派活）
 │  子 Agent 注册表 → 每个子 Agent 包装成一个 tool()
 ▼
┌──────────┬────────────┬──────────────┬────────────┐
│ chef     │ cleaner    │ appliance    │ shopping   │ …
│ 厨师Agent │ 清洁工Agent │ 电器管理Agent │ 采购Agent  │
└──────────┴────────────┴──────────────┴────────────┘
   (packages/agents/*，平级、互不调用，协作经管家)
```

### 核心设计原则

1. **见面隔离**：人类与子 Agent 永不直接交互，一切经管家转述。
2. **领域抽象 > 工具具象**：一个领域一个子 Agent；领域内具象能力（扫地、下单买菜…）都是子 Agent 自己的工具（插件）。
3. **上下文预算保护**：子 Agent 独立上下文 + 结构化结果信封，管家不背领域知识。
4. **厂商可插拔**：模型厂商走环境变量（`MODEL_PROVIDER`），框架零绑定。

## 包结构

| 包 | 说明 |
|---|---|
| `packages/agent-sdk` | 子 Agent 接入 SDK：协议信封（Task/Result）、`defineSubAgent`、模型工厂、记忆接口 |
| `packages/db` | 通用数据库层：3NF SQLite schema + 主/子 agent 通用存储接口（见 [docs/DATABASE.md](docs/DATABASE.md)） |
| `packages/butler-core` | 大管家核心：`Butler` 主类（chat / delegate / register）、管家 prompt |
| `packages/agents/chef` | 示例子 Agent（厨房域）—— 新子 Agent 照此结构 |
| `packages/agents/*` | 其余领域子 Agent（cleaner / appliance / shopping… 待开发） |
| `apps/butler-web` | 大管家 Web 聊天界面 |

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 MODEL_PROVIDER（openai / bedrock / ollama）
npm run demo           # CLI：人类 → 管家 → 厨师 → 汇报
npm run web            # Web 界面：浏览器打开 http://127.0.0.1:8790
```

入口先 `await configureModel()` 再 `new Butler(...)`（见 `examples/butler-demo.ts`）；
未配置模型厂商时首次调用会快速失败并提示。

### Web 界面

`npm run web` 启动后打开 http://127.0.0.1:8790，即可在浏览器里和管家对话：
- 顶部显示模型连接状态与子 Agent 花名册
- 新子 Agent 在 `apps/butler-web/src/agents.ts` 加一行即可出现在界面

## 给子 Agent 开发者

👉 **先读 [docs/SUBAGENT-DEV-GUIDE.md](docs/SUBAGENT-DEV-GUIDE.md)**（对接规范 + 目录模板 + checklist）
👉 协议细节见 [docs/protocol.md](docs/protocol.md)
👉 协作流程见 [CONTRIBUTING.md](CONTRIBUTING.md)

## 实施路线

1. ✅ 框架 + 大管家骨架（调度 / 注册 / 汇报 / 厂商抽象）
2. ✅ 子 Agent 接入 SDK + 开发规范
3. 🔜 各领域子 Agent 并行开发（chef 已示范）
4. 🔜 接入真实工具 / 硬件（MCP、冰箱传感器、电商下单）
5. 🔜 管家记忆接入外部存储

## License

MIT
