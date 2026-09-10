# @meimaohouse/chef-agent

厨房域 Agent 壳。仓库只保留能力接口，不内置模拟库存、模拟订单或模拟安全数据。

宿主可以通过 `createChefAgent({ capabilities })` 注入真实实现：

- `fridgeInventory`
- `groceryOrdering`
- `kitchenSafety`
- `mealStats`

没有注入的能力不会生成工具，模型必须返回 `unavailable`，不能伪造执行结果。

开发规范见 [docs/SUBAGENT-DEV-GUIDE.md](../../../docs/SUBAGENT-DEV-GUIDE.md)。
