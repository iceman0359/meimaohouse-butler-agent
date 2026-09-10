# 领域 Agent

当前只保留两个可运行的空壳：

- `chef`：厨房域
- `cleaner`：清洁域

领域能力通过 `capabilities` 接口由宿主注入。仓库不提供模拟成功数据；未配置能力时，
Agent 必须返回 `unavailable`。
