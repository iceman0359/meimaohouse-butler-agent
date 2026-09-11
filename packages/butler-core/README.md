# @meimaohouse/butler-core

大管家核心：

- 注册领域子 Agent
- `chat()` 模型决策调度
- `delegate()` 程序化直派
- 串行保护，避免同一个 Strands Agent 被并发调用
- 动态花名册 prompt
