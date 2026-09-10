# Contributing — meimaohouse-butler-agent

本仓库采用 **PR 工作流（方案 B）**：任何改动走 `分支 → PR → review → 合并 main`，main 禁止直接 push（分支保护已开启）。

## 工作流

```
1. 从 main 拉新分支：  git checkout -b feat/xxx
2. 提交代码：         git commit -m "feat: xxx"
3. 推送到远端：       git push origin feat/xxx
4. 发起 PR → 至少 1 人 review 通过 → 合并 main
5. 合并后删掉远端分支（可在 PR 页勾选 auto-delete）
```

## 分支命名

| 前缀 | 用途 | 示例 |
|---|---|---|
| `feat/` | 新功能 | `feat/chef-fridge-stock` |
| `fix/` | 修 bug | `fix/butler-memory-oom` |
| `docs/` | 文档 | `docs/protocol-v1` |
| `refactor/` | 重构 | `refactor/sdk-types` |
| `chore/` | 杂务 | `chore/ci-setup` |

## Commit message 规范（Conventional Commits）

```
<type>(<scope>): <subject>

type: feat | fix | docs | refactor | chore | test | perf
scope: 所属包，如 butler-core / agent-sdk / chef / cleaner
```

示例：
- `feat(butler-core): 任务调度器支持优先级队列`
- `fix(chef): 冰箱库存过期判断的时间边界`
- `docs(agent-sdk): 补充子 Agent 注册接口文档`

> 重要：不要在 commit 里写死个人署名，用仓库统一身份；一个 PR 只做一件事，保持小而可 review。

## 模块分工（建议）

| 模块 | 目录 | 负责人 |
|---|---|---|
| 大管家核心（调度/记忆/汇报） | `packages/butler-core` | 1997Yoyo |
| 子 Agent 接入 SDK | `packages/agent-sdk` | 1997Yoyo |
| 厨师 Agent（厨房域） | `packages/agents/chef` | 待分配 |
| 清洁工 Agent（清洁域） | `packages/agents/cleaner` | 待分配 |
| 电器管理 Agent | `packages/agents/appliance` | 待分配 |
| 外出采购 Agent | `packages/agents/shopping` | 待分配 |

（分工确定后更新此表，避免多人同时改同一包）

## Review 规则

- PR 至少 **1 人 approval** 才能合并
- 改动自己负责模块以外的东西时，务必 @ 该模块负责人
- 合并前自查：跑了测试 / 至少本地能跑通、无未提交的调试代码、无敏感信息（token/密码）
