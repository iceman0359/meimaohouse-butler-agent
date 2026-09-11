# @meimaohouse/cleaner-agent

清洁域 Agent 壳。仓库只保留能力接口，不内置模拟清洁状态、模拟执行结果或模拟预约。

宿主可以通过 `createCleanerAgent({ capabilities })` 注入真实实现：

- `cleaning`
- `scheduling`
- `laundry`

没有注入的能力不会生成工具，模型必须返回 `unavailable`，不能伪造执行结果。

开发规范见 [docs/SUBAGENT-DEV-GUIDE.md](../../../docs/SUBAGENT-DEV-GUIDE.md)。
