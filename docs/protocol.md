# 通信协议：管家 ↔ 子 Agent

> 版本：0.1 · 状态：草案 · 语言无关（TypeScript 实现见 `packages/agent-sdk/src/protocol.ts`）

## 1. 分层与调用链

```
人类 👤
 │  自由语言对话（唯一入口）
 ▼
大管家（模型决策）
 │  1. 拆解需求 → 选子 Agent → 构造 TaskRequest
 │  2. 系统补全 task_id/domain → TaskEnvelope
 ▼
子 Agent（独立上下文）
 │  执行领域任务（可调用自己的工具）
 ▼
ResultEnvelope（done / failed / needs_human / deferred / unavailable）
 │
 ▼
管家转述为面向人的语言 → 人类
```

- 人类与子 Agent **永不直接交互**。
- 子 Agent 之间平级、**不直接调用**；需要协作时在 `suggestions` 里提出，由管家转派。

## 2. 任务信封（TaskEnvelope）

管家侧模型填写的是 **TaskRequest**（精简，模型只负责"派什么活"）：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `intent` | string | ✅ | 任务意图（动词短语），如 `inventory_check` / `order_groceries` |
| `params` | object | ✅ | 任务参数（领域自定义），默认 `{}` |
| `priority` | `low\|normal\|high` | 否 | 默认 `normal` |
| `deadline` | string | 否 | 截止时间（ISO 8601 或自然语言） |
| `source` | string | 否 | 请求来源，默认 `human` |

系统补全后的 **TaskEnvelope** 额外字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `task_id` | string | 唯一 ID，格式 `<agentId>_<base36时间戳>_<UUID前8位>` |
| `domain` | string | 目标领域（= 子 Agent 的 id，如 `chef`） |

示例：

```json
{
  "task_id": "chef_m1x2ab_9kq3z1a2",
  "domain": "chef",
  "intent": "order_groceries",
  "params": { "items": [{ "name": "牛奶", "qty": 2 }] },
  "priority": "high",
  "source": "human"
}
```

## 3. 结果信封（ResultEnvelope）

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `task_id` | string | ✅ | 回显对应任务的 task_id |
| `status` | `done\|failed\|needs_human\|deferred\|unavailable` | ✅ | 见下表 |
| `summary` | string | ✅ | 一句话结果，**面向人类**（管家会转述） |
| `detail` | object | 否 | 结构化详情，供管家/后续任务引用 |
| `error` | string | `failed` 时必填 | 失败原因 |
| `error_code` | string | 否 | 机器可读错误码，如 `capability_not_configured` |
| `suggestions` | string[] | 否 | 给管家的后续建议；**需要其他子 Agent 协作时写这里** |
| `completed_at` | string | 否 | 完成时间 ISO 8601 |

### status 语义

| status | 含义 | 管家应如何回应 |
|---|---|---|
| `done` | 成功完成 | 转述 summary，可附带 detail 中的关键信息 |
| `failed` | 执行失败 | 转述原因 + 给出替代方案 |
| `needs_human` | 需要人类拍板（大额采购、上门预约等） | 把决策点清楚转述给人类，等人类确认后再派发 |
| `deferred` | 已排期/暂缓（定时任务已登记） | 告知人类已安排及时间 |
| `unavailable` | 当前环境没有配置执行该任务所需的能力 | 明确说明能力未接入，不伪造执行结果 |

## 4. 错误与边界约定

- 子 Agent 执行抛异常时，适配器兜底返回 `failed` 信封（不会让管家看到异常栈）。
- 未配置的能力不会注册工具；子 Agent 必须返回 `unavailable`，**禁止编造成功结果**。
- 信封所有字段必须 JSON 可序列化（工具返回值建议 `JSON.stringify` 后返回）。

## 5. 协议演进

- 新增字段：向后兼容（都是可选字段）；改字段语义：升版本并同步本文件。
- 协议的唯一实现与类型出口在 `@meimaohouse/agent-sdk`，子 Agent 与管家都从它导入，**禁止各自复制一份 schema**。
