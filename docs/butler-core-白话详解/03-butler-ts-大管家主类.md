# 03 · butler.ts 源码白话详解（大管家主类）

---

## 模块1：文件整体基础介绍

### 1、文件名称 + 文件存放路径

- 文件名：`butler.ts`
- 存放路径：`meimaohouse-butler-agent/packages/butler-core/src/butler.ts`
- 编译产物：`packages/butler-core/dist/butler.js`
- 体量：389 行——**全包的主体**，工程里"管家"这个角色的全部行为逻辑都在这一个类里。

### 2、文件存在的核心原因

**因为**整个工程的主张是"人类只见管家"——这个"管家"必须是一个真实可调用的对象：能收人类的话（chat）、能派活给子 Agent（delegate）、能报花名册（listAgents）、能把记忆和账目管起来（可选 db）；**而**这些能力横跨 agent-sdk（模型/工具/信封）、db 包（落库）、prompts/memory（说明书/记忆策略）多个零件，**必须有一个总装配与总调度的地方**，**所以**要有 `Butler` 主类——它是工程架构的"运转中枢"，其他一切包都是它的部件供应商。

文件头注释把职责列得很清楚：持有子 Agent 注册表并把每个子 Agent 包装成 tool（Agent-as-Tool）；chat 是模型决策调度；delegate 是程序化直派；listAgents 是花名册；懒加载（new 的时候不建模型不建 Agent）；数据库集成是可选的（未传 db 行为与纯内存版完全一致，零依赖可跑）。

**如果没有这个文件，程序会出现的问题：** 所有零件都是散件——模型有了、工具有了、工人有了、库有了，但没有人"把这些串成一条人类说话→管家派活→结果转述"的完整流水线，整个工程无法运行。

### 3、文件的整体定位

这个文件**专门负责"管家的运转"**：一个 `Butler` 主类（11 个方法 + 若干内部字段）+ 2 个文件级助手函数。按职责分四组：

- **门面组**：chat / delegate / listAgents / getBrief（外部会调的四个方法）；
- **装配组**：constructor / register / buildAgent / ensureAgent / invokeModel（把人和零件组织起来）；
- **账房组**：getButlerAgent / beginTurn / appendMessage / logEvent（落库相关的私有内部件）；
- **杂务组**：summarize / runExclusive / ensureSubAgentRow / extractReplyText（压缩员、排队器、落库包装、结果提纯）。

### 4、文件的依赖关系

**它需要调用谁（上游）：**

- `@strands-agents/sdk`：`Agent`（真正调模型的底座）；
- `@meimaohouse/agent-sdk`：`getModel`（取模型）、`createTaskId`（生成任务编号）、`TaskRequestSchema`（派活单校验）、`createMemoryTools`（记忆工具），及 6 个类型；
- `@meimaohouse/db`：`AgentContext`（Agent 身份解析）、`SessionRepository / MessageRepository / EventRepository / TaskRepository`（四本账）、`Db` 类型；
- 本包 `./prompts.js`（说明书）、`./memory.js`（记忆组装）。

**谁来调用它（下游）：**

- `examples/butler-demo.ts`（CLI 演示）、`apps/butler-web/src/server.ts`（Web 服务端）、`tests/core.test.ts`（测试）——都是 `new Butler({...})`。

---

## 模块2：文件内核心成员逐个超详细说明

### 核心成员 1：文件头注释（运转手册）

1. **名称**：1-21 行的注释块。
2. **设计的根本原因**：**因为**本文件是全工程最核心的类，读的人第一个要知道"它能干什么、有什么运行形态（有 db/无 db）"，**所以**开头把职责、懒加载策略、数据库集成的两种形态、记忆工具的接法全部写明——它是类的"产品说明书"。
3. **语法写法的原因**：JSDoc 注释块（编译忽略，人读 + IDE 悬停）。
4. **内部逻辑分步讲解**：四段——职责清单 / 懒加载说明 / 数据库集成说明（工作记忆每轮组装、全链路落库、未传 db 零依赖）/ 长期记忆工具说明。
5. **触发条件**：不运行。
6. **最终作用**：30 行读懂整个类的运行形态。
7. **使用场景**：交接、审阅。
8. **缺陷/注意事项**：注释里写了"重启零失忆（Hermes 纪律）"等承诺——改行为时这些注释要同步，否则误导。

### 核心成员 2：`SUMMARY_SYSTEM_PROMPT`（纪要员提示词常量）

1. **名称**：`SUMMARY_SYSTEM_PROMPT`，常量字符串："你是庄园管家的记忆管理员。你的唯一职责是把对话压缩成长期纪要：只输出纪要正文，不解释、不加标题、不寒暄。"
2. **设计的根本原因**：**因为**压缩纪要用的是管家模型"客串"的一次性调用——**如果**不带专属提示词，模型会带着"管家"的惯性回答（寒暄、解释、给建议），压出来的就不是纯纪要；**所以**要给它一个"你只是记忆管理员"的临时人设，把输出钉死为纯正文。
3. **语法写法的原因**：`const` 常量 + 不导出——只被本文件的 summarize 使用（index.ts 刻意没导出它：内部实现细节）。
4. **内部逻辑分步讲解**：三句话各自设限——身份（记忆管理员）、唯一职责（压缩成纪要）、输出纪律（只输出正文，不解释不加标题不寒暄）。
5. **触发条件**：summarize() 每次建临时 Agent 时带上。
6. **最终作用**：保证压缩输出是"干净的纪要正文"。
7. **使用场景**：仅 summarize。
8. **缺陷/注意事项**：它与 memory.ts 压缩指令里的规则**分工明确**：这句管"输出形态"，memory.ts 那段管"取舍标准"——两处各自独立又缺一不可。

### 核心成员 3：`ButlerOptions`（管家出生选项单）

1. **名称**：`ButlerOptions`，接口，7 个可选字段：subAgents / systemPrompt / model / name / memory / db / ownerUsername。
2. **设计的根本原因**：**因为**管家在不同场景的形态不同（演示零配置、Web 全功能、测试注假件），**所以**出生配置全部可选——不传就是最简形态（大管家 + 零工人 + 全局模型 + 纯内存），传了就逐项增强。
3. **语法写法的原因**：全 `?` 可选——`new Butler()` 空参合法；字段类型精确（SubAgent[]/string/ModelInstance/Memory/Db/username 字符串）。
4. **内部逻辑分步讲解**：7 个字段逐一说明见模块3。
5. **触发条件**：不运行；constructor 的入参类型。
6. **最终作用**：管家装配的全部可调项收口于一个对象。
7. **使用场景**：三处使用方 + 未来的所有装配代码。
8. **缺陷/注意事项**：`db` 与 `memory` 是两个独立选项——都传才是"完全体"（持久化 + 管家自己的记忆工具）；只传 db 时管家能记住对话（走 memory.ts）但没有 memory_get/set 工具（不能主动存事实）。

### 核心成员 4：`constructor(opts)`（出生）

1. **名称**：constructor，入参 `opts: ButlerOptions = {}`。
2. **设计的根本原因**：**因为**类的字段需要初始值、初始的工人名单需要逐个登记，**所以**构造器负责"开箱设置"。
3. **函数语法写法的原因**：**因为**它只是存配置 + 逐个 register，**没有任何模型/Agent 实例化**，**所以**同步——这是"懒加载"承诺（文件头注释）的兑现处：**new 的瞬间不花钱、不连网、不解析模型**。
4. **函数内部完整逻辑分步讲解**：
   - `this.name = opts.name ?? '大管家'`——显示名默认"大管家"；
   - `this.model / this.customPrompt / this.memory / this.db`——四项原样存下（都可为 undefined，后面按需兜底）；
   - `this.ownerUsername = opts.ownerUsername ?? 'default'`——归属用户默认 default；
   - `for (const sa of opts.subAgents ?? []) this.register(sa)`——初始工人逐个走 register（**复用 register 而不是直接 set**：注册的校验和落库逻辑只写一遍）。
5. **函数的触发条件**：`new Butler({...})`。
6. **函数的最终作用**：产出一个"配置就位、待启动"的管家对象。
7. **函数的使用场景**：三处使用方。
8. **函数的缺陷/注意事项**：构造器里 register 落库依赖"db 里已有 butler 行"（register 内部 if 保证只在有父记录时落库）——**装配顺序**（先 ensureButlerAgent 建 db 记录、再 new Butler）由应用层负责，顺序错了不报错但子 Agent 行不入库（register 静默跳过），见模块4第 6 条。

### 核心成员 5：`register(subAgent)`（注册工人）

1. **名称**：register，入参 `subAgent: SubAgent`，返回 `this`。
2. **设计的根本原因**：**因为**"哪些工人归我管"必须有一个唯一登记口——重复 id 要拦（一人一个工号）、启动后要拦（工具列表已定型，中途加人会分裂）、落库要跟着做（db 模式下工人身份要入账），**所以**封装成带三重保障的登记方法。
3. **函数语法写法的原因**：**因为**返回 `this`，**所以**可以链式调用（`butler.register(a).register(b)`）——注册是典型的"连发动作"，链式最顺手。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：`if (this.started || this.agent) throw`——启动后禁止注册（**为什么**：无 db 模式的 Agent 实例是缓存复用的，说明书和工具列表在首次 chat 时已定型，中途加工人 = 名册与说明书分裂）；
   - 第 2 步：重复 id throw（全工程身份唯一）；
   - 第 3 步：`this.subAgents.set(subAgent.spec.id, subAgent)`——登记进 Map（**为什么用 Map**：按 id 增查、天然去重键，见模块3）；
   - 第 4 步：有 db 且管家行已存在时，调 ensureSubAgentRow 把工人身份落库（幂等——重复注册同 id 不会写脏，因为第 2 步已拦）；
   - 第 5 步：返回 this。
5. **函数的触发条件**：constructor 循环里；外部手动补充注册。
6. **函数的最终作用**：花名册的唯一写入口（带校验、带落库）。
7. **函数的使用场景**：构造器、动态注册、测试。
8. **函数的缺陷/注意事项**：db 落库有前提（管家行已建）——没建时静默跳过（不报错），这是刻意的宽容（避免"注册还要先查库"的耦合），但装配方要知道这个前提。

### 核心成员 6：`listAgents()`（报花名册）

1. **名称**：listAgents，无入参，返回 `RosterEntry[]`。
2. **设计的根本原因**：**因为**外部（界面、调试、prompt 拼装）需要"当前有哪些工人、各自会什么"的只读视图，**而**注册表内部是完整 SubAgent 对象（含工具/模型等装配细节），**所以**要一个"只挑四件套"的投影方法——信息最小化，和 prompts.ts 的 RosterEntry 完美对接。
3. **函数语法写法的原因**：`[...this.subAgents.values()].map(...)`——先把 Map 的值摊成数组再逐个投影；返回新数组不改内部（**只读视图**）。
4. **函数内部完整逻辑分步讲解**：逐个工人取 spec 的 id/name/domain/description → 组成条目数组返回。
5. **函数的触发条件**：buildAgent 拼说明书时；UI 花名册展示；调试。
6. **函数的最终作用**：注册表的"对外窗口"。
7. **函数的使用场景**：buildAgent、apps/butler-web 顶部花名册。
8. **函数的缺陷/注意事项**：无特别——纯投影。

### 核心成员 7：`getBrief()`（查当前纪要）

1. **名称**：getBrief，无入参，返回 `string`。
2. **设计的根本原因**：**因为**界面/调试需要"管家现在记得什么"（长期纪要内容），**而**纪要在库里、读取有一套细节，**所以**提供只读方法；**未传 db 时返回空串**（注释原话——纯内存模式没有"可展示的纪要"，如实告知而不是报错）。
3. **函数语法写法的原因**：`if (!this.db) return ''`——先挡住无 db 形态（**为什么不当错误抛**：查询类接口对"功能未启用"返回空值比抛错更友好，调用方好处理）。
4. **函数内部完整逻辑分步讲解**：解析用户 → loadBrief(db, userId).brief → 返回。
5. **函数的触发条件**：UI 展示纪要、调试记忆。
6. **函数的最终作用**：记忆内容的只读窗口。
7. **函数的使用场景**：apps/butler-web、排障。
8. **函数的缺陷/注意事项**：只读不改——动纪要走对话（让压缩机制自然推进）。

### 核心成员 8：`chat(message)`（人类对话入口——核心中的核心）

1. **名称**：chat，入参 `message: string`，返回 `Promise<string>`（转述的纯文本）。
2. **函数设计的根本原因**：**因为**"人类说一句话 → 管家带记忆上场 → 模型决策调度 → 结果落库 → 返回人话"是一条完整链路，任何一步乱了（记忆没组装、消息没落库、出错没留痕）都是用户可感知的事故，**所以**必须有一个把这些步骤**按正确顺序**串起来的总入口。
3. **函数语法写法的原因**：
   - **因为**整条链路整体要排队（见 runExclusive），**所以**函数体包在 `this.runExclusive(async () => {...})` 里返回；
   - **因为**模型调用会失败，**所以**模型段有独立 try/catch（错误也要落库再抛出）。
4. **函数内部完整逻辑分步讲解**（六步流水线）：
   - 第 ① 步：**组装工作记忆**（仅有 db 时）——解析用户 → `assembleMemory(db, userId, prompt => this.summarize(prompt))`（把 02 文档的组装器跑一遍；压缩回调指到自己的 summarize）→ 拿 historyText → 压缩发生时打一行日志（`[butler] 记忆压缩完成`——运维可见）；
   - 第 ② 步：**登记本轮**（仅有 db 时）——`turn = this.beginTurn(message, userId)`：会话复用或新建 + 本轮 human 消息入库，拿到 sessionId；
   - 第 ③ 步：`this.started = true`——标记启动（register 从此拒绝新工人）；
   - 第 ④ 步：**拼输入调模型**——`input = historyText ? \`${historyText}\n\n【主人本轮消息】\n${message}\` : message`：有历史则"记忆块 + 明确标注的本轮消息"一起给（**为什么单独标注本轮**：让模型分清"背景"和"现在要办的"）；无 db 则直接把 message 给缓存实例（实例自带进程内上下文）；`await this.invokeModel(input)`；
   - 第 ⑤ 步：**提纯转述 + 落账**——`extractReplyText(result)` 拿纯文本；有 turn 则把回复按 butler 身份入库 + 记一条 `butler.chat.reply` 事件（带消息长度等统计）；返回 reply；
   - 第 ⑥ 步（catch）：**错误也要留痕**——把错误转成人话、按 butler 身份入库一条"执行出错：…"、记 `butler.chat.error` 事件（带原话和错误）→ **继续 throw**（调用方必须知道失败了——**落库不吞错**，两件事都做）。
5. **函数的触发条件**：人类每发一句话（Web 界面回车、CLI 输入）。
6. **函数的最终作用**：一次调用 = 记忆组装 + 对话落库 + 模型调度 + 结果提纯 + 全程留痕——"人类只见管家"的完整兑现。
7. **函数的使用场景**：apps/butler-web 的消息入口、demo 的 REPL。
8. **函数的缺陷/注意事项**：有 db 时每轮多两次模型内调用（压缩员只在触发时）、一次记忆组装——延迟略增，换来持久与有界；无 db 模式全部跳过（轻但重启失忆）。

### 核心成员 9：`delegate(request)`（程序化直派）

1. **名称**：delegate，入参 `request: TaskRequestInput & { domain: string }`（派活单字段 + 目标领域），返回 `Promise<ResultEnvelope>`。
2. **设计的根本原因**：**因为**有些派活不该过管家模型：测试要确定性、定时任务没有"对话语境"、外部编排想精确控制——**所以**提供一个"跳过模型决策、按 domain 直接点名工人"的通道。**它与 chat 的关系**：chat 是"人类口语 → 模型理解 → 派活"，delegate 是"程序点名 → 直接派活"——两条通道共用同一套信封协议与落库规范。
3. **函数语法写法的原因**：
   - **因为**入参里 domain 是"路由字段"（找谁），其余才是派活单内容，**所以**先解构分离：`const { domain, ...input } = request`；
   - **因为**返回的是原始结果信封（注释原话"返回原始 ResultEnvelope"），**所以**类型是 ResultEnvelope 而不是转述文本（调用方自己按 status 处理）。
4. **函数内部完整逻辑分步讲解**（五步）：
   - 第 1 步：按 domain 找工人——没有则 throw，**且报错信息列出已注册的全部 id**（`join(', ') || '无'`——空名单时显示"无"，报错永远可自救）；
   - 第 2 步：**拼正式信封**——`TaskRequestSchema.parse(input)`（**程序化调用也要过审**：测试填错字段同样被拦，协议面前人人平等）→ 补 `task_id: createTaskId(sa.spec.id)`、`domain: sa.spec.id`（与 agent-sdk 05 文档 toButlerTool 的补全逻辑同款——系统字段系统填）；
   - 第 3 步：**落库登记**（仅有 db）——解析管家与工人两个身份（工人行不存在则 throw 人话提示"请先在装配时调用 ensureSubAgent"）→ 解析用户 → `TaskRepository.create({...})` 登记任务（状态 pending）——**session_id 传 null**（注释原话："直派可脱离会话（定时任务/外部编排）；会话内派发经 chat 链路落 session"——直派没有对话上下文，不硬凑会话）；
   - 第 4 步：**真派活**——`await sa.handleTask(task)`：直连子 Agent 的作业方法（agent-sdk 05 文档——不管内部怎么炸都会折算成合法信封）；
   - 第 5 步：**结果写回 + 事件**（有 db 且有 taskCtx）——`TaskRepository.complete(task_id, {...})` 把信封各字段写回任务行（`?? null` 逐个兜底——**信封可选字段转数据库列**，没有就存 null）；记 `task.completed` 事件（带 task_key/intent/status/agent_id）；返回 result。
5. **函数的触发条件**：测试、定时任务、外部编排调用。
6. **函数的最终作用**：不经模型决策的确定性派活通道，且任务全程有账（pending → 结果写回 → 完成事件）。
7. **函数的使用场景**：tests/core.test.ts（测子 Agent）、未来的 cron/编排。
8. **函数的缺陷/注意事项**：它不走管家模型——**不会触发"转述"**，返回的是机器可读信封；想要"人话汇报"还得自己拿 summary 转述（或走 chat）。

### 核心成员 10：`getButlerAgent()`（私有：管家身份解析）

1. **名称**：getButlerAgent，无入参，返回 `AgentContext`。
2. **设计的根本原因**：**因为**落库操作都要"管家在数据库里的身份"（agent_id），**而**这个身份查一次就该缓存（每次落库都查库太浪费），**所以**私有方法负责"懒查 + 缓存 + 顺序错误早暴露"。
3. **函数语法写法的原因**：private 方法——只服务内部落库流程。
4. **函数内部完整逻辑分步讲解**：无 db → throw"未注入数据库"；缓存没有 → `AgentContext.get(this.db, 'butler')` → 没有 → throw"数据库中没有主管家记录，请先在装配时调用 ensureButlerAgent(db)"（人话指引装配顺序）；查到 → 缓存进 this.butlerAgent → 返回。
5. **函数的触发条件**：一切落库前的身份获取（beginTurn/logEvent/delegate）。
6. **函数的最终作用**：管家数据库身份的唯一出口（带缓存 + 装配顺序检查）。
7. **函数的使用场景**：仅类内部。
8. **函数的缺陷/注意事项**：缓存后如果数据库身份变了（不会正常发生）要重启才刷新——可接受。

### 核心成员 11：`beginTurn(message, userId)`（私有：会话登记 + 本轮消息入库）

1. **名称**：beginTurn，入参 `message: string` 和 `userId: number`，返回 `{ sessionId, userId }`。
2. **设计的根本原因**：**因为**每轮对话要么延续最近会话、要么开新会话（没有会话，消息就成了无主孤儿），**而**"复用还是新建"有一套规则，**所以**封装成"开一轮"的方法——返回会话 ID 供后续落回复。
3. **函数语法写法的原因**：私有 + 返回小对象——供 chat 后续两步（落回复、记事件）使用。
4. **函数内部完整逻辑分步讲解**：
   - 取管家身份 → 建会话仓储；
   - `recent = sessionRepo.listByUser(userId, 1)[0]`——看该用户最近 1 个会话；
   - 有就复用其 session_id；没有就新建：标题取**本轮消息前 24 字**（`message.slice(0, 24) || '新会话'`——**为什么要前 24 字**：会话列表里要一眼认出"这是聊什么的"，首条消息的开头就是最好的标题；空消息兜底"新会话"）；
   - `appendMessage(sessionId, 'human', message)`——本轮主人原话入库；
   - 返回 {sessionId, userId}。
5. **函数的触发条件**：chat 第 ② 步（仅在记忆组装之后——顺序红线）。
6. **函数的最终作用**：本轮对话有了"户口"（会话）与"开头一笔"（主人消息）。
7. **函数的使用场景**：仅 chat。
8. **函数的缺陷/注意事项**：**永远复用最近一个会话**——没有"开新会话"的入口（当前产品形态是"一个主人一条连续对话流"）；要分会话得扩展此处。

### 核心成员 12：`appendMessage(sessionId, senderKind, content)`（私有：写一条消息）

1. **名称**：appendMessage，三入参，无返回。
2. **设计的根本原因**：**因为**"写一条消息"在 chat 里出现多次（主人的、管家的回复、错误信息），**而**入库的字段组装有一处小规则（sender_id 的填法），**所以**统一封装——写法只写一遍。
3. **函数语法写法的原因**：`senderKind: 'human' | 'butler' | 'sub' | 'system'`——**用字面量联合锁死四种发送方**（与数据库列约束对齐，写别的值编译不过）。
4. **函数内部完整逻辑分步讲解**：`new MessageRepository(this.db!).append({ session_id, sender_kind, sender_id: senderKind === 'butler' ? 'butler' : null, content })`——**sender_id 只有管家填 'butler'**，其他为 null（**为什么**：sender_id 的语义是"子 Agent 的具体身份"，管家和人类的身份在 sender_kind 里已表达清楚；这个 `!` 是 TS 的非空断言——调用约定"内部方法已确保 db 存在"，注释里写明了）。
5. **函数的触发条件**：beginTurn（主人消息）、chat 成功（回复）、chat 出错（错误说明）。
6. **函数的最终作用**：对话记录的统一写入口。
7. **函数的使用场景**：仅类内部。
8. **函数的缺陷/注意事项**：非空断言 `db!` 依赖调用纪律（私有方法、注释已声明前提）——不要把它改成公开方法乱调。

### 核心成员 13：`logEvent(sessionId, userId, eventType, payload)`（私有：记事件流水）

1. **名称**：logEvent，四入参，无返回。
2. **设计的根本原因**：**因为**管家的关键动作（回复了/出错了/任务完成了）都要留"行车记录"，**而**事件的字段组装有一处灵活规则（agent_id 可来自 payload 也可默认管家），**所以**统一封装。
3. **函数语法写法的原因**：payload 类型 `Record<string, unknown>`——事件内容五花八门（消息长度、错误文本、任务编号……），放得下任意结构。
4. **函数内部完整逻辑分步讲解**：`const { agent_id, ...rest } = payload`——先把 agent_id 从 payload 里**抽出来**：是数字就直接用（**谁的事件**：delegate 的 task.completed 会带子 Agent 的 agent_id——这条事件属于工人）；否则默认管家的 agent_id（管家的回复/错误事件）。剩下的 rest 作为 payload 存库。
5. **函数的触发条件**：chat 成功/失败、delegate 完成。
6. **函数的最终作用**：事件流水统一写入口（身份归属自动判对）。
7. **函数的使用场景**：仅类内部。
8. **函数的缺陷/注意事项**：payload 里混入 agent_id 会被"吃掉"（进不了 rest）——设计如此，别往 payload 塞业务字段叫 agent_id。

### 核心成员 14：`summarize(prompt)`（私有：纪要压缩员）

1. **名称**：summarize，入参 `prompt: string`，返回 `Promise<string>`。
2. **设计的根本原因**：**因为**memory.ts 的组装器需要"给指令、还纪要文本"的模型能力，**而**管家手里正好有模型——**所以**提供这个回调实现：临时造一个"裸 Agent"（只有纪要员提示词 + 模型，**不带任何工具、不带花名册**），单发一次调用。
3. **函数语法写法的原因**：async（要 await 模型）；签名与 memory.ts 要求的回调完全吻合。
4. **函数内部完整逻辑分步讲解**：`new Agent({ systemPrompt: SUMMARY_SYSTEM_PROMPT, model: this.model ?? getModel() })`——**每次压缩新建临时实例**（一次性工具人，用完即弃，不占管家缓存）；`extractReplyText(await agent.invoke(prompt))` 提纯返回。
5. **函数的触发条件**：chat 的记忆组装阶段，仅当 assembleMemory 触发压缩时。
6. **函数的最终作用**：把"模型能力"以最小形态供给记忆策略——压缩员上岗。
7. **函数的使用场景**：仅作为 assembleMemory 的回调。
8. **函数的缺陷/注意事项**：压缩用的模型与管家同一只（成本合并计）；如果管家配了自定义 model，压缩员也用它（合理默认）。

### 核心成员 15：`buildAgent()`（私有：造管家 Agent 实例）

1. **名称**：buildAgent，无入参，返回 `Agent`。
2. **设计的根本原因**：**因为**"管家 Agent"的装配（说明书 + 工具列表 + 模型）是一套固定动作，且**每次构建都要拿最新花名册**，**所以**封装成工厂方法——需要新实例时调它。
3. **函数语法写法的原因**：private；同步（模型已由 getModel 兜底——懒加载链的末端）。
4. **函数内部完整逻辑分步讲解**（Agent 构造参数逐项）：
   - `systemPrompt: this.customPrompt ?? buildButlerSystemPrompt(this.listAgents(), Boolean(this.memory))`——自定义说明书优先，没有就用内置模板（**自定义的代价**：花名册要自己拼，见 01 文档易错点）；
   - `tools`：两段拼接——**每个工人的 toButlerTool()**（Agent-as-Tool：工人变工具，agent-sdk 05 文档）+ **有 memory 就加记忆工具**（`createMemoryTools(this.memory, 'butler')`——**命名空间固定 'butler'**：管家的记忆键都带 butler: 前缀，与子 Agent 隔离）；
   - `model: this.model ?? getModel()`——注入的优先，否则全局配置兜底（未配置在这里抛 ModelNotConfiguredError——懒加载的检查点）；
   - `printer: false`——关打印（管家的中间过程不刷屏，人类只拿最终转述）。
5. **函数的触发条件**：ensureAgent（无 db 首次）或 invokeModel（有 db 每轮）。
6. **函数的最终作用**：产出一个"带全套工具、带当轮说明书"的管家大脑载体。
7. **函数的使用场景**：仅类内部。
8. **函数的缺陷/注意事项**：**无 db 模式下它只在首次调用时执行一次**（缓存实例）——之后注册新工人不再生效（register 的启动拦截 + 缓存双重保证一致性）；有 db 模式每轮重建，花名册永远最新。

### 核心成员 16：`invokeModel(input)`（私有：模型调用的分岔口）

1. **名称**：invokeModel，入参 `input: string`，返回 `Promise<unknown>`。
2. **设计的根本原因**：**因为**无 db 和有 db 两种形态的"调用方式"必须不同（见模块4第 3 条——这是全文件最精妙的一处分岔），**所以**有一个专门的方法承载这个决策，调用方（chat）不用关心形态差异。
3. **函数语法写法的原因**：返回 `unknown` 而不是具体类型——**因为**SDK 的 invoke 返回形状多变（字符串或对象），后续交给 extractReplyText 处理，这里不假装知道形状（诚实的类型）。
4. **函数内部完整逻辑分步讲解**：就两行——`if (!this.db) return this.ensureAgent().invoke(input)`（复用缓存实例：进程内上下文自然积累多轮）；`return this.buildAgent().invoke(input)`（有 db 每轮新实例：历史由 historyText 注入）。
5. **函数的触发条件**：chat 第 ④ 步。
6. **函数的最终作用**：让 chat 对运行形态无感。
7. **函数的使用场景**：仅 chat。
8. **函数的缺陷/注意事项**：改这条分岔 = 改记忆模型（红线 2）。

### 核心成员 17：`ensureAgent()`（私有：懒创建缓存实例）

1. **名称**：ensureAgent，无入参，返回 `Agent`。
2. **设计的根本原因**：**因为**无 db 模式的实例要"首次用时才建、之后一直复用"，**所以**懒创建 + 缓存（标准 lazy singleton）。
3. **函数语法写法的原因**：`if (!this.agent) this.agent = this.buildAgent()`——判断 + 填充 + 返回，三合一。
4. **内部逻辑分步讲解**：见上。
5. **触发条件**：invokeModel 的无 db 分支。
6. **最终作用**：无 db 模式的"唯一管家实例"从这里来。
7. **使用场景**：仅 invokeModel。
8. **缺陷/注意事项**：实例缓存后 tools/systemPrompt 定型——与 register 的启动拦截配套。

### 核心成员 18：`runExclusive<T>(task)`（私有：串行队列）

1. **名称**：runExclusive，入参 `task: () => Promise<T>`，返回 `Promise<T>`（就是 task 的执行结果）。
2. **设计的根本原因**：**因为**底层 Strands Agent **不允许并发 invoke**（注释原话）——两个人同时跟管家说话，两个 chat 同时跑模型会直接报错或结果错乱，**所以**必须把同一管家的调用**串成一条队**：后来的排队，前面的做完才开始。
3. **函数语法写法的原因**：
   - `const run = this.invocationQueue.then(task, task)`——**把新任务挂到队尾，且成功/失败两条路都挂**（`.then(task, task)`）：**为什么失败路也要挂**：**因为**队列的本质是"上一个完了我就开始"，上一个**失败**了我也该开始——失败不能传染给排队者；
   - `this.invocationQueue = run.then(() => undefined, () => undefined)`——**队尾指针更新为"吞掉结果的新 promise"**：无论刚才成功失败，队列状态归零（只记"做完了"），下一个任务干净地接上；
   - 泛型 `<T>`：任务返回什么类型，调用方拿到什么类型（chat 的 string 原样穿透）。
4. **函数内部完整逻辑分步讲解**：见上（三步就是全部）。
5. **函数的触发条件**：chat 整体被它包裹——每个请求都过这道队。
6. **函数的最终作用**：并发安全——多人同时说话也是一条条处理，永不并发炸模型。
7. **函数的使用场景**：仅 chat（delegate 不排队——它不直接 invoke 管家模型，走的是子 Agent 的 handleTask，天然可并行）。
8. **函数的缺陷/注意事项**：队列无超时——前面的调用卡多久，后面的等多久（模型调用有 SDK 层超时兜底，可接受）；排队期间用户无感知反馈（Web 端表现为响应慢一点）。

### 核心成员 19：`ensureSubAgentRow(db, spec, parentAgentId)`（文件级函数：工人落库包装）

1. **名称**：ensureSubAgentRow，三入参，无返回（`void`）。
2. **设计的根本原因**：**因为** register 落库需要调 db 包的 `AgentContext.ensure`，**而**直接在类方法里 import 使用会触发工具链的循环依赖提示（注释原话："ensureSubAgent 的局部包装：register 内联落库用（避免循环依赖提示）"），**所以**包一层文件级函数隔开。
3. **函数语法写法的原因**：文件级普通函数（不挂类上——它不读任何实例状态）；`void ctx`（返回值不用，显式丢弃表明"只要副作用"）。
4. **函数内部完整逻辑分步讲解**：`AgentContext.ensure(db, { agentKey: spec.id, role: 'sub', name, domain, description, systemPrompt, parentAgentId })`——把工人的身份信息"确保存在"库里（幂等：有就核对，没有就建），挂到管家（parentAgentId）名下。
5. **函数的触发条件**：register 的落库分支。
6. **函数的最终作用**：工人身份入库（数据库浏览器/任务路由都靠它）。
7. **使用场景**：仅 register。
8. **缺陷/注意事项**：**幂等但字段以 spec 为准**——同 id 的工人 spec 改了描述，ensure 会更新为新值（登记表跟着代码走）。

### 核心成员 20：`extractReplyText(result)`（文件级函数：回复提纯）

1. **名称**：extractReplyText，入参 `result: unknown`，返回 `string`。
2. **设计的根本原因**：**因为** SDK 的 invoke 返回形状不保证（可能是纯字符串，可能是带 lastMessage.content 的对象，content 可能是文本块数组），**而**人类要的永远是一段纯文本，**所以**必须有一个"什么形状都能提纯成人话"的函数——它是"汇报不说黑话"（纪律 5）的技术兜底。
3. **函数语法写法的原因**：
   - 入参类型 `unknown`——诚实承认"形状不定"（unknown 强迫逐级判断，比 any 安全）；
   - 文件级函数——butler.ts 与 summarize 两处共用（类外工具）。
4. **函数内部完整逻辑分步讲解**（三级提纯）：
   - 第 1 级：`typeof result === 'string'` → 原样返回（最好运）；
   - 第 2 级：是对象 → 取 `result.lastMessage?.content`（SDK 惯例的"最后一条消息"）→ 是数组 → 逐块看：块里有 text 字段就取出来（`'text' in block` 的 in 判断——**因为** content 块可能是文本块、工具块等多种，只收文本块），filter(Boolean) 去空 → 有内容就用 `\n` 拼接返回；
   - 第 3 级（兜底）：以上都不中 → `JSON.stringify(result)`——**宁可给 JSON 文本也绝不返回 undefined**（调用方拿到的一定是字符串；同时这个兜底输出反而方便排查"SDK 又换形状了"）。
5. **函数的触发条件**：chat 提纯回复、summarize 提纯纪要。
6. **函数的最终作用**：模型产出的"任意形状" → 人类可读的纯文本。
7. **使用场景**：chat、summarize。
8. **缺陷/注意事项**：SDK 升级换了字段名会掉到第 3 级（功能不崩但输出变 JSON 天书）——升级 SDK 时优先核对此函数。

---

## 模块3：文件内每一个参数超详细说明

> ButlerOptions 的 7 个字段 + 类内字段 + 方法入参分组讲解。共性（可选 + 合理默认）不重复展开。

### 组 1：ButlerOptions 的 7 个字段

**字段 1：`subAgents?`（初始工人名单，SubAgent[]，可选）**——设计：出生即带班底；来源：chef/cleaner 的默认导出或工厂产物；使用：构造器逐个 register；不填的后果：空管家（chat 时管家如实说"没有专职人员"——说明书占位文案兜着）；作用：管家的班底。

**字段 2：`systemPrompt?`（自定义说明书，string，可选）**——设计：高级用户整份替换管家说明书；使用：buildAgent 里 `??` 优先采用；不填：用内置模板（推荐路径）；**注意**：自定义后花名册要自己拼（01 文档易错点 1）；作用：说明书的完全控制权。

**字段 3：`model?`（模型实例，ModelInstance，可选）**——设计：单独换脑/测试注入；使用：buildAgent/summarize 里 `?? getModel()` 兜底；不填：走全局配置（入口须 configureModel）；作用：管家与压缩员的共同大脑。

**字段 4：`name?`（管家显示名，string，可选）**——设计：界面标题/日志标识可定制；默认 '大管家'；作用：对外名号（不影响行为——行为由说明书决定）。

**字段 5：`memory?`（管家记忆实现，Memory，可选）**——设计：给管家配"主动记账"工具（memory_get/set/append/delete）；使用：buildAgent 拼工具（命名空间 'butler'）+ 说明书记忆条款（hasMemory）；不填：管家没有主动记账工具（但对话记忆照常——那是 memory.ts 的组装记忆，两回事）；作用：管家的"记事本"开关。

**字段 6：`db?`（数据库连接，Db，可选）**——设计：可选持久化的总开关；使用：chat/delegate/register 的各落库分支都 `if (this.db)` 判断；不填：纯内存形态（零库依赖、重启失忆）；填了：每轮组装记忆 + 全链路落库；**作用：全类最重要的形态开关**。

**字段 7：`ownerUsername?`（归属用户名，string，可选）**——设计：多用户时区分记忆与会话归属；默认 'default'；使用：chat/delegate 里 resolveUser 换成数字 userId；作用：数据归属的主人标识。

### 组 2：类内字段（全局参数）

**`subAgents = new Map<string, SubAgent>()`**——工人注册表。**为什么用 Map**：按 id 键值存取 O(1)、has/get 语义清晰、键天然唯一辅助查重；取值：启动前可增、启动后锁死。

**`invocationQueue: Promise<void> = Promise.resolve()`**——串行队列的"队尾指针"，初始为已完成承诺（第一个任务不用等）。它是 runExclusive 的全部状态——**这个字段是并发安全的全部家当**，一行都不能动。

**`started = false`**——启动标记（首次 chat 后置 true），register 用它拦"开工后加人"。

**`agent?`（缓存实例）与 `butlerAgent?`（缓存身份）**——两个懒缓存：前者缓存无 db 模式的 Agent 实例，后者缓存管家的数据库身份——都是"查一次/建一次，之后白嫖"。

**`db?` / `memory?` / `model?` / `customPrompt?` / `ownerUsername` / `name`**——出生配置的存档（readonly/私有按需），全类各处按需取用。

### 组 3：方法入参

**`message`（chat 与 beginTurn 的入参）**——人类本轮原话。三处使用：beginTurn 入库（原话）、input 拼接（【主人本轮消息】标注后给模型）、错误事件（原话留痕）。类型 string，空串合法（说明书占位与新会话标题的 `|| '新会话'` 已兜底）。

**`request`（delegate 的入参）**——`TaskRequestInput & { domain: string }`：派活单（intent/params/priority/deadline/source，可缺省默认字段）+ 路由字段 domain。**类型交叉（&）**精准表达"派活单 + 一个必填路由"；来源：测试/定时/编排代码。

**`task`（delegate 内部局部变量）**——过审补全后的任务信封（parse + createTaskId + domain）。**注意与 request 的区别**：request 是"填表前"，task 是"盖章后"（agent-sdk 01 文档的 input/task 双变量同款纪律）。

**`sessionId / userId / senderKind / content / eventType / payload`（账房组四方法的入参）**——各为落库字段：sessionId 会话主键（数字）、userId 主人主键（数字）、senderKind 四值字面量联合（human/butler/sub/system）、content 文本、eventType 事件名（如 'butler.chat.reply'）、payload 事件附加数据（Record<string, unknown>）。

**`prompt`（summarize 入参）**——压缩指令全文（memory.ts 组装），进 → 模型 → 出纪要文本。

**`task: () => Promise<T>`（runExclusive 入参）**——要排队的任务体（chat 的整条流水线闭包）。泛型 T 穿透返回。

**`result: unknown`（extractReplyText 入参）**——SDK 原始返回（形状不定），三级提纯见模块2成员 20。

**`db, spec, parentAgentId`（ensureSubAgentRow 入参）**——库连接、工人身份表（SubAgentSpec）、管家在库里的 ID——落库三要素。

---

## 模块4：文件关键逻辑 & 特殊代码说明

### 1、chat 里"先组装记忆、再登记本轮"的顺序——为什么不能倒

**因为** assembleMemory 读的"最近 20 条窗口"来自数据库——**如果**先 beginTurn（本轮消息入库）再组装：窗口会包含本轮消息，随后 input 又拼一遍"【主人本轮消息】"——**同一条话在上下文里出现两遍**，模型可能对着两份"主人说的话"困惑甚至重复执行。**先组装（窗口不含本轮）→ 再登记 → 拼接时单独标注本轮**——三步的顺序是记忆正确性的根基（00 总览红线 1）。

### 2、runExclusive 的 `.then(task, task)` 与队尾归零——为什么这样写

**因为**队列语义是"上一个**结束**（无论成败）才开始下一个"：`.then(task, task)` 把新任务同时挂到成功路和失败路——上一单失败，下一单照常开始（失败不传染）；队尾更新为 `.then(() => undefined, () => undefined)`——把上单的成败"消化掉"，队列永远是一根干净的接力棒。**如果**写成 `.then(task)`：上一单失败，后面**所有**排队者跟着失败（promise 拒绝沿链传播）——一次模型抖动导致全场瘫痪。这两行是并发安全的精华，逐字符理解再动。

### 3、invokeModel 的双路径——为什么无 db 复用、有 db 每新建

**因为**两种形态的"历史记忆来源"不同：
- **无 db**：历史只活在 Agent 实例自带的上下文里——**复用同一实例**，多轮对话自然积累（这是纯内存模式唯一的记忆）；如果也每轮新建，上一轮的话全丢（单轮失忆）；
- **有 db**：历史由 historyText 每轮显式注入——**必须新建实例**：复用的话，实例自带的历史 + 注入的 historyText **两份历史叠加**（模型读到重复内容），且实例越用越肥（违背上下文有界）。
**一句话**：无 db 时实例就是记忆，有 db 时库才是记忆、实例只是一次性载体。注释里"（无状态化）"三个字说的就是这个。

### 4、delegate 为什么不走 chat 的队列、也不走模型

**因为** delegate 的设计目标是**确定性**（测试/定时/编排要可重复的结果）：不过管家模型（没有决策的不确定性）、不排队（它不碰管家模型实例，子 Agent 的 handleTask 各自独立可并行）。**代价**是没有"转述"（返回机器信封）与"会话归属"（session_id 为 null）——两个通道各司其职，混用反而两头不讨好。

### 5、chat 的错误处理"先落库再 rethrow"——为什么两件事都做

**因为**错误信息对**不同读者**价值不同：库里的"执行出错：…"与 error 事件是给**事后排查**看的（重启后还在）；rethrow 是给**当前调用方**看的（Web 端要立刻向用户报错）。**只落库不抛**：用户界面干等；**只抛不落**：事故现场丢失。注释与代码都体现"两全"。

### 6、delegate 里两处"数据库没有记录"的报错——为什么这么凶

**因为**它们拦截的是**装配顺序错误**（没用 ensureButlerAgent 建管家行 / 没注册工人行就直派）——这类错误如果不在第一时间人话报出，会变成深处的"外键失败/字段为 null"天书；**而**两条报错都带"请先在装配时调用 XXX"的补救指引——**把运维失误变成一分钟可修的问题**。

### 7、buildAgent 的工具拼装顺序与命名空间——为什么记忆工具用 'butler'

**因为**管家与子 Agent 可能共用同一个 Memory 实现（同一个库）——命名空间 'butler' 让管家的记忆键全部带 `butler:` 前缀（agent-sdk 03 文档的隔离机制），不与 chef:/cleaner: 串门。工具顺序（工人工具在前、记忆工具在后）无功能影响，但"班底在前"符合阅读直觉。

### 8、beginTurn 的标题截断 `message.slice(0, 24)`——为什么是 24 字

**因为**会话列表（数据库浏览器/界面）里标题要短而不失义——24 个汉字足够概括一句话主题，又不至于把长消息全塞进去；`|| '新会话'` 兜底空消息。纯体验参数，可调。

---

## 模块5：文件整体运行总结

### 1、从加载到运行完成的完整步骤流程

1. 应用装配：ensureButlerAgent（db 模式）→ `new Butler({ subAgents, db, memory, ... })` → 构造器存配置、逐个 register（Map 登记 + 可选落库）；
2. 人类说话：`chat(话)` → 进串行队列 → （有 db）组装记忆（可能触发压缩）→ beginTurn 开户 → started = true → 拼输入 → invokeModel（无 db 缓存实例 / 有 db 新实例）→ extractReplyText 提纯 → 回复与事件落库 → 返回人话；
3. 管家模型在推理中按说明书决定派活 → 调 subagent_xxx 工具 →（agent-sdk 链路：补信封 → 子 Agent 开间干活 → 结果信封）→ 管家拿到 JSON 信封转述；
4. 程序化直派：`delegate({ domain, intent, params })` → 找工人 → 过审补信封 → （有 db）任务登记 → handleTask → 结果写回 + 完成事件 → 返回原始信封；
5. 重启（db 模式）：纪要与水位在库、窗口现读 → 零失忆续聊。

### 2、文件在整个工程中不可替代的作用

**它是全工程的"运转中枢"**：见面隔离、Agent-as-Tool、上下文有界、双通道派活、全链路留痕、并发安全——工程 README 里每一条核心承诺，兑现点都在这个类里。前两套文档讲的零件（协议/工具/记忆/模型/工人）全部在这里第一次被组装成"能营业的管家"。

### 3、运行依赖的环境与前置条件

- 依赖 agent-sdk（运行期必用）、db 包（仅 db 模式）、Strands SDK；
- 前置条件：入口先 `await configureModel()`（README 明确）；db 模式要求装配顺序（ensureButlerAgent → new Butler → ensureSubAgent）；
- 懒加载：new 不触发模型解析——首次 chat（或 delegate 的 handleTask 内部）才真正取模型。

---

## 模块6：可复用模块 / 易错点 / 调试关键点 / 修改注意事项（⚠️ 高亮）

### ✅ 可复用模块

- **runExclusive 串行队列**（8 行）：任何"底层不允许并发"的资源调用通用；
- **"可选 db 双形态"模式**（`if (this.db)` 分支 + 无库零依赖可跑）：一切"演示零配置、生产全功能"的类设计样板；
- **extractReplyText 的三级提纯**：一切"SDK 返回形状不定 → 要纯文本"的场景通用；
- **懒缓存对**（ensureAgent/ensureButlerAgent）：实例与身份的"一次建立多次使用"标准写法。

### ⚠️ 易错点

1. **调 chat 顺序/合并 invokeModel 双路径**：记忆重复或单轮失忆（红线 1/2）——改动前重读模块4第 1/3 条；
2. **并发调用 chat**：功能上安全（排队），但要预期"响应按序变慢"——压测时的延迟是排队不是故障；
3. **delegate 的 request 忘带 domain 或写错 id**：报错会列出合法 id，照着改即可；
4. **以为 delegate 会给"人话回复"**：它返回机器信封——要转述自己取 summary 或走 chat；
5. **在 register 之后再注册**：启动拦截会抛错——工人要在首次 chat 前注册完；
6. **summarize 被换成带工具的 Agent**：压缩输出可能混入工具调用杂质——保持裸 Agent。

### 🔍 调试关键点

- **管家忘了上周的事**：getBrief() 看纪要 → 空/缺就查压缩链路（02 文档调试节）；
- **chat 报 ModelNotConfiguredError**：入口没 configureModel（懒加载的检查点在这里爆）；
- **数据库有消息但界面不显示**：查 beginTurn 是否被绕过（消息没 session 就是孤儿）；
- **日志出现"[butler] 记忆压缩完成"**：正常运维信息——说明水位推进了一次；
- **回复变成 JSON 天书**：extractReplyText 掉到了第 3 级兜底——SDK 升级改了返回形状，修第 2 级的解析。

### 🚫 修改红线（不能改）与可优化点

| 位置 | 能不能动 | 说明 |
|---|---|---|
| chat 三步顺序（组装→登记→拼接） | 🚫 不能倒 | 记忆正确性的根基（模块4第 1 条） |
| invokeModel 双路径 | 🚫 不能合并 | 两种形态的记忆来源不同（模块4第 3 条） |
| runExclusive 两行队列逻辑 | 🚫 不能简化 | 失败传染/并发崩溃两个事故都在等（模块4第 2 条） |
| delegate 的协议审查与落库对账 | 🚫 不能删 | 确定性通道也要守规矩、留全账 |
| extractReplyText 三级兜底 | 🚫 不能删兜底 | "永远返回字符串"的最后防线 |
| 行为准则/落库字段映射 | ✅ 可扩展 | 新事件类型/新字段按现有模式加（`?? null` 逐列兜底） |
| 串行队列加超时/排队提示 | ✅ 可优化 | 需求出现再做，别提前复杂化 |
| 会话管理（beginTurn 永远复用最近会话） | ✅ 可扩展 | 产品需要"新会话"入口时在 beginTurn 层加参数 |
