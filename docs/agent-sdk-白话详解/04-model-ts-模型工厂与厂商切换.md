# 04 · model.ts 源码白话详解（模型工厂与厂商切换）

---

## 模块1：文件整体基础介绍

### 1、文件名称 + 文件存放路径

- 文件名：`model.ts`
- 存放路径：`meimaohouse-butler-agent/packages/agent-sdk/src/model.ts`
- 编译产物：`packages/agent-sdk/dist/model.js`

### 2、文件存在的核心原因

**因为** Agent 没有大脑就无法思考——管家和每个子 Agent 都要接一个真实的 AI 模型才能干活；而市面上的模型厂商有很多家（Bedrock、OpenAI、DeepSeek、眉猫 API、本地 Ollama……），每家接入方式、需要的钥匙（API Key）、参数都不同。如果把这个工程焊死在某一家：想换厂商 = 全工程大改；没用到的厂商 SDK 也得被迫安装（拖慢安装、徒增体积）。**所以**必须有一个"模型工厂"：

1. 把"接哪家、用什么钥匙"的配置集中收口（环境变量 + 显式配置两条路）；
2. 用"动态 import"做到**用哪家才加载哪家**——没选的厂商连依赖都不用装；
3. 没配置时**快速失败**并给出人话提示（而不是等到深处莫名报错）；
4. 提供测试用的"假脑注入"通道（`setModel`），让测试不花真钱、不连真网。

**如果没有这个文件，程序会出现的问题：** 每个包自己 import 各家 SDK，换厂商要改遍全工程；未安装厂商 SDK 的环境程序启动就崩；配置错误要到运行深处的模型调用时才炸，排查成本极高；测试只能烧真 API 费用。

### 3、文件的整体定位

这个文件**专门负责"AI 大脑的创建、配置、发放"**，是全工程唯一的"厂商接入口"。它管三件事：**怎么造**（createModel + 5 个加载器）、**什么时候发**（configureModel/getModel/setModel 三件套）、**没配好怎么办**（ModelNotConfiguredError 快速失败）。

### 4、文件的依赖关系

**它需要调用谁（上游）：**

- `@strands-agents/sdk`：只要 `Model` 类型（所有厂商模型类共同的"形状"）；
- 5 个厂商 SDK（**全部动态加载，运行时才碰**）：`@strands-agents/sdk/models/bedrock`、`/models/openai`、`/models/vercel`（配 Ollama 用）、以及 Ollama 专用的 `ollama-ai-provider`（它的类型声明见 07 文档）；
- `process.env`（Node.js 环境变量）：环境变量是配置的第一来源。

**谁来调用它（下游）：**

- `sub-agent.ts`：`defineSubAgent` 组装 Agent 时 `spec.model ?? getModel()` 兜底取模型；
- `packages/butler-core/butler.ts`：管家启动时同样用 `getModel()`；工程入口（`examples/butler-demo.ts`、`apps/butler-web`）先 `await configureModel()` 再 `new Butler(...)`（README 明确写了这个顺序）；
- 测试代码：用 `setModel` 注入假模型。

**一句话：全工程所有 Agent 的大脑都从这一扇门里领。**

---

## 模块2：文件内核心定义与核心函数超详细说明

### 核心定义 1：`ModelInstance`（模型的"通用形状"类型）

1. **名称**：`ModelInstance`，写法 `export type ModelInstance = Model`（Model 来自 Strands SDK）。
2. **设计的根本原因**：**因为**管家、子 Agent、测试代码都要在参数里写"我要一个模型"，如果各自写各家的具体类型（OpenAIModel、BedrockModel……），代码就和厂商焊死了，**所以**定义一个统一别名指向 SDK 的抽象基类 `Model`——所有厂商模型类都是它的子类，都能塞进这个类型。**不这么做的弊端**：换个厂商 = 改遍所有函数签名。
3. **语法写法的原因**：**因为**TypeScript 的类型别名语法 `type X = Y` 可以给已有类型起短名，**所以**用它；又因为这里只需要"类型"、不需要运行时代码，**所以**用 `import type` 引入（见模块4第 1 条：type-only import 编译后完全消失，不会把厂商 SDK 拖进打包）。注释里也点明了：扩展厂商时无需改动，各家模型类均为 SDK Model 子类。
4. **内部逻辑分步讲解**：一行纯类型定义，编译后不存在。
5. **触发条件**：不运行；所有"模型参数"的类型标注处引用（`SubAgentSpec.model`、`ButlerOptions.model`、`configureModel` 返回值等）。
6. **最终作用**：全工程对"模型"只有一个说法，厂商可替换性在类型层面就成立。
7. **使用场景**：`sub-agent.ts`、`butler-core`、测试代码的模型参数声明。
8. **缺陷/注意事项**：它只能保证"是 SDK 认的模型"，保证不了"配置正确"——钥匙填错是运行期才炸的，属于本类型的盲区。

### 核心定义 2：`ModelEnv`（配置说明书 / 13 个配置项的接口）

1. **名称**：`ModelEnv`，接口，13 个可选字段（全部 `?` 可选）。
2. **设计的根本原因**：**因为**"接模型"需要一大堆配置（选哪家、各家的钥匙、各家模型名、各家接口地址），散着传会乱成一锅粥，**所以**打成一个配置包 `ModelEnv`，作为 `createModel`/`configureModel` 的入参类型。**为什么 13 个全是可选**：**因为**每个字段都有"代码内默认值或环境变量兜底"（见各加载器），使用者只需要填自己关心的那几项。
3. **语法写法的原因**：**因为**TypeScript 接口语法定义"配置包长什么样"，全部字段加 `?` 表示"都可以不填"，**所以**这样写——调用方传 `{}` 甚至不传（函数签名给了默认值 `env: ModelEnv = {}`）都合法。每个字段上方的注释写明了"缺省读哪个环境变量、默认值是什么"，这是给使用者的说明书。
4. **内部逻辑分步讲解**（13 个字段分组看）：
   - 总开关组：`provider`（厂商名，不填读环境变量 MODEL_PROVIDER）；
   - Bedrock 组：`bedrockRegion`（区域）、`bedrockModelId`（模型 ID）；
   - OpenAI 组：`openaiApiKey`（钥匙）、`openaiModelId`（模型名）；
   - DeepSeek 组：`deepseekApiKey`、`deepseekModelId`（默认 deepseek-chat）、`deepseekBaseURL`（默认 https://api.deepseek.com）；
   - 眉猫组：`meimaoapiApiKey`、`meimaoapiModelId`（默认 deepseek-v4-flash）、`meimaoapiBaseURL`（默认 https://meimaoapi.top/v1）；
   - Ollama 组：`ollamaBaseURL`（默认本机 http://localhost:11434/api）、`ollamaModelId`（默认 qwen2.5:7b）。
5. **触发条件**：不运行；调用 `configureModel(env)` / `createModel(env)` 时作为入参形状。
6. **最终作用**：配置项"有名字、有类型、有说明书"，填错字段名编译期就报错。
7. **使用场景**：工程入口（demo、Web 应用）传环境变量等价物；测试里传假配置。
8. **缺陷/注意事项**：字段名和对应环境变量名是两套记忆负担（`deepseekApiKey` ↔ `DEEPSEEK_API_KEY`），写代码时容易混——配置失败时优先核对这两层拼写。

### 核心定义 3：`ModelNotConfiguredError`（"没配模型"专用错误类）

1. **名称**：`ModelNotConfiguredError`，类，继承自 `Error`。
2. **设计的根本原因**：**因为**"没配置模型"是新手最先踩的坑，如果抛一个普通 Error（"undefined is not a function"之类），新手完全不知道怎么救；**所以**专门定义这个错误类，错误信息直接是一份"怎么办"的操作指南（先 await configureModel()，或在 .env 设 MODEL_PROVIDER，样例配置都给出来）。**不专门定义的弊端**：错误信息不可读、也没法在代码里区分"没配置"和其他错误（无法精准 catch）。
3. **语法写法的原因**：**因为** JS 里自定义错误的标准姿势就是继承 Error（保留堆栈等原生能力），**所以** `extends Error`；**因为**父类构造器负责装错误信息，**所以**必须先 `super(...)` 再设 `this.name`——这是 JS 类继承的硬语法（不先调 super 就访问 this 直接报错）；`this.name = 'ModelNotConfiguredError'` 让错误日志里能一眼认出错误种类。
4. **内部逻辑分步讲解**：构造函数把一组提示文字用 `\n` 连成多行说明（怎么配环境变量、支持哪几家、测试怎么注入假模型），交给 super 存起来；再给错误起名。
5. **触发条件**：`createModel` 发现 provider 是空串时抛出；`getModel` 发现缓存里没模型时抛出。
6. **最终作用**：把"新手第一坑"变成一段自解释的操作指南，程序快速失败、提示一步到位。
7. **使用场景**：本文件内部两处抛出；入口代码没先 `await configureModel()` 就创建 Agent 时必然见到它。
8. **缺陷/注意事项**：它只在"完全没配"时抛——配了但钥匙错了是各家 SDK 自己报错，错误长相不同，排错时先分清这两种情况。

### 核心函数 1：`createModel(env)`（工厂流水线总闸）

1. **函数名称**：`createModel`，入参 `env: ModelEnv = {}`（不传 = 空配置），返回 `Promise<ModelInstance>`（异步：因为要等厂商 SDK 加载）。
2. **函数设计的根本原因**：**因为**"按厂商名分发到对应加载器"这个决策逻辑必须有唯一入口（散在各处 = 厂商清单多处维护、必然不同步），**所以**集中为 switch 分发函数——注释里也写明"新增厂商 = 在 createModel 的 switch 里加一个 case"。
3. **函数语法写法的原因**：
   - **因为**加载厂商 SDK 是异步动作（动态 import 返回 Promise），**所以**函数必须是 `async`、返回 `Promise`——同步函数里没法 await（语法硬要求）；
   - **因为**调用方可能什么都不传，**所以**参数默认值 `env: ModelEnv = {}`；
   - **因为**厂商名可能出现大小写/空格的手滑（如 " OpenAI "），**所以**入口先做清洗：`(env.provider ?? process.env.MODEL_PROVIDER ?? '').trim().toLowerCase()`——显式配置优先于环境变量，两级都没有则空串。
4. **函数内部完整逻辑分步讲解**（switch 五分支 + 两个兜底）：
   - 第 1 步：读厂商名并清洗（见上）；**为什么 `??` 套两层**：env 里没填就读环境变量，再没有就空串——"代码显式传参 > 环境变量 > 报错"的优先级链；
   - 第 2 步：switch 分发——`bedrock` → loadBedrock；`openai` → loadOpenAI；`deepseek` → loadDeepSeek；`meimaoapi` → loadMeimaoapi；`ollama` → loadOllama。**为什么用 switch 而不是 if/else 链**：厂商是离散枚举值，switch 一眼看清全部支持项、漏分支也好发现；
   - 第 3 步：空串分支 `case ''` → 抛 `ModelNotConfiguredError`（快速失败，见模块4）；
   - 第 4 步：default 分支 → 抛"未知模型厂商"错误，**并把当前支持的所有厂商名列出来**——写错名字的人能立刻对照改正。
5. **函数的触发条件**：`configureModel` 内部调用它；直接调用它（不想缓存实例时）也可以。
6. **函数的最终作用**：输入"厂商名 + 配置"，输出一个配置好、可立即使用的模型实例。
7. **函数的使用场景**：`configureModel` 的内部实现；需要同时用两个厂商模型的特殊场景可分别调用。
8. **函数的缺陷/注意事项**：它本身**不缓存**（每次调用都重新加载+新建实例）——正常入口请用 `configureModel`（带缓存），别在多个地方反复调 `createModel` 造成多份模型实例。

### 核心函数 2：`loadBedrock(env)`（亚马逊 Bedrock 加载器）

1. **函数名称**：`loadBedrock`，入参 `env: ModelEnv`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为** Bedrock 的接入参数（区域、模型 ID、输出上限、温度）有一套自己的默认逻辑，**所以**单独封装一个加载器——switch 里只管分发，加载细节各家自管（一个厂商一个函数，互不掺和）。
3. **函数语法写法的原因**：**因为**它只在选中 Bedrock 时才该被加载，**所以**函数体里用 `await import('@strands-agents/sdk/models/bedrock')` 动态引入（这是 JS 的动态 import 语法：运行到这一行才去加载模块；**语法硬要求**：await 只能出现在 async 函数里，所以函数是 async）。**为什么这是本文件设计意图的核心**：文件头注释明确写了"框架代码不绑定、也不静态加载任何厂商 SDK（用哪个厂商才 import 哪个，未选的厂商连依赖都不用装）"。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：动态加载 Bedrock 模型类；
   - 第 2 步：区域取值链 `env.bedrockRegion ?? process.env.AWS_REGION ?? 'us-east-1'`——显式配置 > 环境变量 > 兜底默认值（美东区），保证任何情况下都有合法区域；
   - 第 3 步：模型 ID 同样的三级取值，兜底 `global.anthropic.claude-sonnet-4-6`；
   - 第 4 步：`new BedrockModel({ region, modelId, maxTokens: 4096, temperature: 0.7 })`——maxTokens 限单次回答长度（防失控长输出），temperature 0.7 是"创造性与稳定性的中间档"。
5. **函数的触发条件**：`createModel` 的 switch 命中 `bedrock` 时。
6. **函数的最终作用**：产出一个连好 Bedrock 的模型实例。
7. **函数的使用场景**：仅被 `createModel` 调用（私有加载器，不导出）。
8. **函数的缺陷/注意事项**：Bedrock 需要 AWS 凭证环境已就绪（凭证配置不在本文件职责内）——报"凭证相关"错误时先查 AWS CLI/环境配置，别在本文件里找。

### 核心函数 3：`loadOpenAI(env)`（OpenAI 加载器）

1. **函数名称**：`loadOpenAI`，入参 `env`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为** OpenAI 是"必须有钥匙才谈别的"的厂商（没钥匙 100% 失败），**所以**加载器第一件事是查钥匙、没有就用人话报错；**又因为** OpenAI 依赖包是可选安装的（用哪家装哪家），**所以**加载失败时要把"去 npm i openai"的补救命令直接写进错误信息。
3. **函数语法写法的原因**：**因为**动态 import 加载不存在的包会抛异常，**所以**整个加载段包在 try/catch 里，catch 转译成人话错误——**这又是语法强制**：不 catch，用户看到的是底层模块系统的天书报错。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：钥匙取值链 `env.openaiApiKey ?? process.env.OPENAI_API_KEY`，没有 → 抛"OpenAI 厂商需要 OPENAI_API_KEY 环境变量（或 createModel({ openaiApiKey })）"——一条错误给出两条补救路径；
   - 第 2 步：try 块内动态加载 `OpenAIModel`；
   - 第 3 步：模型 ID 取值 `env.openaiModelId ?? process.env.OPENAI_MODEL_ID`（**注意**：OpenAI 这家没有硬编码兜底模型名）；
   - 第 4 步：`new OpenAIModel({ apiKey, api: 'chat', ...(modelId ? { modelId } : {}) })`——`api: 'chat'` 指定走聊天补全接口；后面那个展开写法是"有才传"的条件展开：modelId 没配就不带这个字段（让 SDK 用它自己的默认模型），**如果硬传 undefined** 可能触发 SDK 内部参数校验报错，**所以**要条件展开；
   - 第 5 步：catch 把异常转译成"加载 OpenAI 模型失败：原因（使用该厂商需先安装依赖: npm i openai）"。
5. **函数的触发条件**：switch 命中 `openai` 时。
6. **函数的最终作用**：产出连好 OpenAI 的模型实例；钥匙缺失/依赖缺失时给出可照做的错误提示。
7. **函数的使用场景**：仅被 `createModel` 调用；**另外它还被 DeepSeek/眉猫复用思路借鉴**（那两家是"OpenAI 兼容接口"，见核心函数 5、6）。
8. **函数的缺陷/注意事项**：OpenAI 官方 SDK 已在本包 package.json 的 dependencies 里（`"openai": "^6.49.0"`），正常安装即可；报错文案里的 npm 命令主要针对"被裁剪过依赖"的部署场景。

### 核心函数 4：`loadOllama(env)`（本地 Ollama 加载器）

1. **函数名称**：`loadOllama`，入参 `env`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为** Ollama 是"本地跑模型"的特殊厂商（不经云、不花钱、但要求本机先起服务），**而且**它的接入方式与众不同——要经过 Vercel AI 生态的适配层（`ollama-ai-provider` 包造 provider、`VercelModel` 包成模型），**所以**必须单独一个加载器把这两层包装动作封装好。
3. **函数语法写法的原因**：**因为** `ollama-ai-provider` 是"可选依赖"（工程没把它写进 package.json，用 Ollama 才需要装），**所以**动态 import + try/catch 转译（依赖没装时报"npm i ollama-ai-provider，并确保本地 Ollama 服务在运行"）；**又因为**这个包没有官方类型声明（可选包无法强制安装），**所以**需要 07 文档的 `vendor.d.ts` 给它补类型——否则 TypeScript 编译时就会报"找不到模块"。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：try 块里动态加载 `ollama-ai-provider` 和 SDK 的 `VercelModel`；
   - 第 2 步：服务地址取值链（显式 > 环境变量 OLLAMA_BASE_URL > 本机默认地址）；
   - 第 3 步：模型名取值链，兜底 `qwen2.5:7b`（一个常见的本地小模型）；
   - 第 4 步：两步包装——`createOllama({ baseURL })` 造出"指到本机 Ollama 服务的连接器"，再立刻以 modelId 调用它（`(modelId)`），把产物交给 `new VercelModel({ provider: ... })` 包成 SDK 认的模型。
5. **函数的触发条件**：switch 命中 `ollama` 时。
6. **函数的最终作用**：把"本机 Ollama 服务 + 指定本地模型"包装成全工程通用的模型实例。
7. **函数的使用场景**：仅被 `createModel` 调用；适合离线演示/低成本试跑。
8. **函数的缺陷/注意事项**：前置条件最多（要先 npm i ollama-ai-provider、本机要跑着 Ollama、模型要已下载）——三者缺一都是它报错，按错误提示逐项核对。

### 核心函数 5：`loadDeepSeek(env)`（DeepSeek 加载器）

1. **函数名称**：`loadDeepSeek`，入参 `env`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为** DeepSeek 官方提供了"OpenAI 兼容接口"（用 OpenAI 的协议说话，只是地址和钥匙不同），**所以**不必找/写专门的 DeepSeek 接入层——复用 `OpenAIModel`、把接口地址换成 DeepSeek 的即可（注释原话："OpenAI 兼容接口，复用 OpenAIModel + 自定义 baseURL"）。**这就是"兼容协议"的巨大红利**：一族厂商（OpenAI、DeepSeek、眉猫）共用一套接入代码，只换两个参数。
3. **函数语法写法的原因**：与 loadOpenAI 同理——async + 动态 import + 钥匙前置检查 + try/catch 转译；**额外**：`clientConfig: { baseURL }` 是 OpenAIModel 暴露的"自定义接口地址"通道（SDK 语法），不这么传就会打到 OpenAI 官方地址去。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：钥匙检查（DEEPSEEK_API_KEY），没有 → 人话报错；
   - 第 2 步：动态加载 OpenAIModel（**注意**：加载的是 openai 路径，不是 deepseek 专有包）；
   - 第 3 步：地址取值链（显式 > 环境变量 DEEPSEEK_BASE_URL > https://api.deepseek.com）；
   - 第 4 步：模型名取值链，兜底 `deepseek-chat`；
   - 第 5 步：`new OpenAIModel({ api: 'chat', apiKey, modelId, clientConfig: { baseURL } })`——和 OpenAI 唯一的区别就是多了 baseURL 重定向。
5. **函数的触发条件**：switch 命中 `deepseek` 时。
6. **函数的最终作用**：产出连好 DeepSeek 的模型实例。
7. **函数的使用场景**：仅被 `createModel` 调用。
8. **函数的缺陷/注意事项**：DeepSeek 接口偶尔与 OpenAI 官方行为有细微差异，问题定位时先确认是"兼容层差异"还是代码问题。

### 核心函数 6：`loadMeimaoapi(env)`（眉猫 API 加载器）

1. **函数名称**：`loadMeimaoapi`，入参 `env`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为**眉猫 API 也是 OpenAI 兼容的聚合接口（同 DeepSeek 的复用逻辑），**但**它有一个独有的坑：**会拦截 OpenAI 官方 SDK 的默认 User-Agent 请求头**（源码注释原话），不处理就发不出正常请求，**所以**必须单独一个加载器，在配置里带上自定义请求头——这个"只有它有的坑"就是它独立成函数的理由。
3. **函数语法写法的原因**：与 loadDeepSeek 相同的骨架；**特殊在** `clientConfig` 里多传 `defaultHeaders: { 'User-Agent': 'meimao-house-butler/0.1' }`——`defaultHeaders` 是 OpenAI SDK 的"给每个请求都加默认头"的配置项（SDK 语法）。
4. **函数内部完整逻辑分步讲解**：
   - 第 1 步：钥匙检查（MEIMAOAPI_API_KEY），没有 → 人话报错；
   - 第 2 步：动态加载 OpenAIModel；
   - 第 3 步：地址取值链（显式 > 环境变量 MEIMAOAPI_BASE_URL > https://meimaoapi.top/v1）；
   - 第 4 步：模型名取值链，兜底 `deepseek-v4-flash`；
   - 第 5 步：创建模型——除 baseURL 外，还带 `maxTokens: 4096`（限回答长度）和自定义 User-Agent 头（绕开拦截坑）。
5. **函数的触发条件**：switch 命中 `meimaoapi` 时。
6. **函数的最终作用**：产出连好眉猫 API 的模型实例，且请求头合法、不会被拦。
7. **函数的使用场景**：仅被 `createModel` 调用。
8. **函数的缺陷/注意事项**：**`defaultHeaders` 那行是本文件最重要的"别动"之一**（见模块6）——删了之后症状不是启动报错，而是请求莫名失败，极难排查。

### 核心函数 7：`configureModel(env)`（配置并缓存——入口必调）

1. **函数名称**：`configureModel`，入参 `env: ModelEnv = {}`，返回 `Promise<ModelInstance>`。
2. **函数设计的根本原因**：**因为**模型实例创建是异步的（动态加载 SDK），而 Agent 的构造函数是同步的（不能在构造函数里 await），**所以**必须有一个"提前一步把模型造好存起来"的环节——这就是 `configureModel`：入口处调一次，造好的模型存进模块级缓存，之后所有同步构造都从缓存拿（文件头注释："Agent/子 Agent 构造保持同步（懒加载）：入口先 await configureModel()"）。
3. **函数语法写法的原因**：**因为**内部要 await 动态加载，**所以** async；**因为**它写的是模块级变量 `cachedModel`（见模块4第 2 条），**所以**普通函数就能改（同模块内可见）。
4. **函数内部完整逻辑分步讲解**：两步——`cachedModel = await createModel(env)`（造好并缓存）；`return cachedModel`（顺手把实例还给调用方，方便确认用的是什么）。
5. **函数的触发条件**：程序入口处被手动调用一次（README：入口先 `await configureModel()` 再 `new Butler(...)`）。
6. **函数的最终作用**：全工程的模型就位，后续所有 Agent 构造零等待、零阻塞。
7. **函数的使用场景**：`examples/butler-demo.ts`、`apps/butler-web` 等所有入口。
8. **函数的缺陷/注意事项**：**重复调用会覆盖缓存**（最后一次调用的厂商生效）——想运行中切换厂商是支持的，但要知道正在跑的 Agent 手里握的还是旧实例（构造时已注入，不会自动换脑）。

### 核心函数 8：`getModel()`（取模型——同步发放窗口）

1. **函数名称**：`getModel`，无入参，返回 `ModelInstance`（同步！不是 Promise）。
2. **函数设计的根本原因**：**因为** Agent 构造函数是同步的，同步函数里不能 await，**所以**必须有一个"同步取模型"的函数——这就是 `getModel`：缓存里有就直接给，没有就立刻抛 `ModelNotConfiguredError`（快速失败，绝不让你等到深处才发现没配）。
3. **函数语法写法的原因**：**因为**它只读一个模块级变量，**所以**天然可以是同步普通函数——这正符合"构造保持同步"的设计（文件头注释）。**为什么返回类型不带 Promise**：设计意图就是同步发放，包一层 Promise 会把"必须 await"传染给所有构造代码。
4. **函数内部完整逻辑分步讲解**：`if (!cachedModel) throw new ModelNotConfiguredError()`——没缓存就抛带操作指南的错误；有就返回。
5. **函数的触发条件**：`defineSubAgent` 组装 Agent 时（`spec.model ?? getModel()`，显式传了模型就不查缓存）；管家核心创建 Agent 时同理。
6. **函数的最终作用**：同步世界里"取大脑"的唯一正规通道。
7. **函数的使用场景**：`sub-agent.ts`、`butler-core/butler.ts`。
8. **函数的缺陷/注意事项**：**忘调 configureModel 的典型症状**就是它抛 ModelNotConfiguredError——看到这个错误不要怀疑模型本身，先查入口顺序。

### 核心函数 9：`setModel(model)`（注入模型——测试后门）

1. **函数名称**：`setModel`，入参 `model: ModelInstance`，返回同一个实例。
2. **函数设计的根本原因**：**因为**自动化测试不能连真厂商（要花钱、要网络、结果不可控），**所以**需要一个"把假模型直接塞进缓存"的后门——测试里调 `setModel(假模型)`，之后 `getModel()` 拿到的就是假模型，全链路测试跑假脑。错误提示里也写了"或代码注入: setModel(任意模型实例) 用于测试"。
3. **函数语法写法的原因**：**因为**它只是"赋值 + 原样返回"（返回值方便链式写法），**所以**同步普通函数。
4. **函数内部完整逻辑分步讲解**：`cachedModel = model; return model`——两步，无校验（信调用方传的是合法 Model 子类实例，类型系统已把关）。
5. **函数的触发条件**：测试代码初始化时；极少见的"手里已有现成模型实例"的集成场景。
6. **函数的最终作用**：模型来源彻底解耦——真厂商走 configureModel，假厂商走 setModel，下游代码毫无感知。
7. **函数的使用场景**：测试套件；需要自定义模型包装器的进阶场景。
8. **函数的缺陷/注意事项**：**生产代码不要用**——它绕过全部配置检查，塞个配置错的实例，错误会推迟到模型调用时才炸。

---

## 模块3：文件内每一个参数超详细说明

> 13 个 ModelEnv 字段中，取值模式高度一致（显式配置 > 环境变量 > 默认值），下面按组拆解，模式相同的合并说明但取值/来源各自独立讲清。

### 参数 1：`provider`（厂商名总开关）

1. **名称 + 类型**：`provider`，字符串（string），可选。
2. **参数设计原因**：**因为**工厂必须先知道"造哪家的脑"，**所以**这是全部配置里唯一没有代码默认值的分叉字段——它缺失时不报错，而是**降级去读环境变量 MODEL_PROVIDER**，再缺失才抛 ModelNotConfiguredError。
3. **参数类型选择原因**：**因为**厂商名是固定几个离散值（bedrock/openai/deepseek/meimaoapi/ollama），**所以**理论上可用枚举，但**刻意用 string**：**因为**要支持"未知厂商"的错误提示（报错时把用户输的原文回显出来），枚举会在类型层面就堵死错误输入、收不到原文。
4. **参数的传入来源**：`configureModel({ provider: 'openai' })` 显式传；或环境变量 MODEL_PROVIDER（工程 `.env` 文件）。
5. **参数的内部使用逻辑**：`createModel` 第一行完成清洗（trim 去空格 + toLowerCase 统一大小写）后进入 switch 分发。
6. **参数的取值范围**：五个合法值（大小写不敏感、可带空格）；空串触发 ModelNotConfiguredError；其他值触发"未知模型厂商"错误（报错信息列出全部合法值）。
7. **参数的最终作用**：决定整个工厂走哪条装配线。

### 参数 2-3：`bedrockRegion` / `bedrockModelId`（Bedrock 的区域与模型名）

1. **名称 + 类型**：两个字符串（string），可选。
2. **参数设计原因**：**因为** Bedrock 按区域提供服务、按模型 ID 选脑，缺了任何一个连不上，**所以**必须可配；**因为**大多数人用默认区域和默认模型就够，**所以**设三级兜底（不填也能跑）。
3. **参数类型选择原因**：**因为** AWS 区域名（如 us-east-1）和 Bedrock 模型 ID（如 global.anthropic.claude-sonnet-4-6）都是官方定义的字符串标识，**所以**用 string。
4. **参数的传入来源**：显式传参 > 环境变量 AWS_REGION / BEDROCK_MODEL_ID > 代码默认值。
5. **参数的内部使用逻辑**：loadBedrock 里两行取值链取出后，原样装进 BedrockModel 构造参数。
6. **参数的取值范围**：必须是 AWS 官方认可的区域/模型 ID 字符串，填错值在运行请求时被 AWS 拒绝（本文件校验不出这类业务错误）。
7. **参数的最终作用**：Bedrock 路线的"地址 + 型号"。

### 参数 4-5：`openaiApiKey` / `openaiModelId`（OpenAI 的钥匙与模型名）

1. **名称 + 类型**：两个字符串（string），可选。
2. **参数设计原因**：**因为**钥匙是身份凭证（没有 = 必失败），**所以**钥匙缺失要在加载阶段就报人话错误（loadOpenAI 第一步）；**因为**模型名可以不填（让 SDK 用官方默认），**所以**模型名是"有才传"的条件参数（见 loadOpenAI 第 4 步的条件展开）。
3. **参数类型选择原因**：**因为** API Key 官方就是一长串字符，**所以** string；不能用数字等类型（官方 Key 含字母和符号）。
4. **参数的传入来源**：显式传参 > 环境变量 OPENAI_API_KEY / OPENAI_MODEL_ID。
5. **参数的内部使用逻辑**：钥匙先做存在性检查（不通过直接抛错、根本不去加载 SDK）；模型名做条件展开传入。
6. **参数的取值范围**：钥匙必须是 OpenAI 签发的有效 Key（格式 sk-...，无效 Key 在首次请求时被官方拒绝）；模型名必须是 OpenAI 支持的型号。
7. **参数的最终作用**：OpenAI 路线的"身份证 + 型号"。

### 参数 6-8：`deepseekApiKey` / `deepseekModelId` / `deepseekBaseURL`（DeepSeek 三件套）

1. **名称 + 类型**：三个字符串（string），可选。
2. **参数设计原因**：**因为**走 OpenAI 兼容协议需要"钥匙 + 模型名 + 接口地址"三样才能把请求发对地方，**所以**三样都可配且都有兜底（地址默认 https://api.deepseek.com、模型默认 deepseek-chat）——**默认值存在的意义**：多数人只填钥匙就能跑，接入成本最低。
3. **参数类型选择原因**：**因为**三者本质都是 URL/标识字符串，**所以**统一 string；地址用 string 而非 URL 对象，**因为**环境变量天然只有字符串、转换纯属多余。
4. **参数的传入来源**：显式传参 > 环境变量 DEEPSEEK_API_KEY / DEEPSEEK_MODEL_ID / DEEPSEEK_BASE_URL > 代码默认值。
5. **参数的内部使用逻辑**：钥匙做前置存在性检查；地址装进 `clientConfig.baseURL`（OpenAI SDK 的重定向通道）；模型名直接传。
6. **参数的取值范围**：钥匙须 DeepSeek 签发；地址须是合法且协议兼容的 URL；模型名须该服务支持的型号。
7. **参数的最终作用**：DeepSeek 路线的"身份证 + 型号 + 收件地址"。

### 参数 9-11：`meimaoapiApiKey` / `meimaoapiModelId` / `meimaoapiBaseURL`（眉猫三件套）

1. **名称 + 类型**：三个字符串（string），可选。
2. **参数设计原因**：与 DeepSeek 三件套同理（兼容协议三要素）；**额外**因为眉猫有请求头拦截坑，**所以**这个加载器额外硬编码了自定义 User-Agent（这不是配置项，是写死的行为，见模块4）。
3. **参数类型选择原因**：同上（string）。
4. **参数的传入来源**：显式传参 > 环境变量 MEIMAOAPI_API_KEY / MEIMAOAPI_MODEL_ID / MEIMAOAPI_BASE_URL > 代码默认值（地址 https://meimaoapi.top/v1、模型 deepseek-v4-flash）。
5. **参数的内部使用逻辑**：钥匙前置检查；地址与自定义头一起装进 `clientConfig`；模型名直接传；另有 `maxTokens: 4096` 限长。
6. **参数的取值范围**：钥匙须眉猫平台签发；地址/模型名须该平台支持。
7. **参数的最终作用**：眉猫路线的"身份证 + 型号 + 收件地址"，且保证请求头不被拦。

### 参数 12-13：`ollamaBaseURL` / `ollamaModelId`（Ollama 的服务地址与模型名）

1. **名称 + 类型**：两个字符串（string），可选。
2. **参数设计原因**：**因为** Ollama 是本机服务，**所以**必须知道"服务开在哪个地址"（默认本机 11434 端口）和"用哪个已下载的本地模型"（默认 qwen2.5:7b）——**它没有钥匙**，**因为**本机服务默认不做身份验证。
3. **参数类型选择原因**：**因为**地址和模型名都是字符串标识，**所以** string。
4. **参数的传入来源**：显式传参 > 环境变量 OLLAMA_BASE_URL / OLLAMA_MODEL_ID > 代码默认值。
5. **参数的内部使用逻辑**：地址装进 `createOllama({ baseURL })`；模型名立刻作为参数调连接器（`createOllama({...})(modelId)`）；产物再交 VercelModel 包装。
6. **参数的取值范围**：地址须是运行中 Ollama 服务的 URL；模型名须本机已 `ollama pull` 过的型号（填了没下载的模型，运行时报"模型不存在"）。
7. **参数的最终作用**：Ollama 路线的"服务门牌 + 本地型号"。

### 参数 14：`model`（setModel 的入参 / 各构造处的模型参数）

1. **名称 + 类型**：`model`，`ModelInstance`（即 SDK 的 Model 类型）。
2. **参数设计原因**：**因为**注入通道的本质是"把现成实例塞进缓存"，**所以**参数就是模型实例本身。
3. **参数类型选择原因**：**因为**缓存和 getModel 的返回类型都是 ModelInstance，**所以**参数必须同型——塞别的类型编译不过（类型系统就是入口检查）。
4. **参数的传入来源**：测试代码构造的假模型实例；进阶场景的自定义模型包装。
5. **参数的内部使用逻辑**：仅一步——赋值给模块级缓存变量。
6. **参数的取值范围**：任何 Model 子类实例；null/undefined 编译不过。
7. **参数的最终作用**：让"模型从哪来"完全脱离环境配置，测试与集成的自由通道。

---

## 模块4：文件关键逻辑 & 特殊代码说明

### 1、动态 import（`await import(...)`）——整个文件的灵魂，为什么必须这么写

**因为**各厂商 SDK 是重型依赖（体积大、有的还要装额外包），而本工程的哲学是"用哪家装哪家"（文件头注释原话）；**如果**在文件顶部写静态 import（`import { BedrockModel } from ...`），程序一启动就把**所有**厂商 SDK 全部加载，没安装的厂商直接让整个程序在启动瞬间崩溃——"装不装取决于用不用"的设计就死了。**所以**全部厂商加载都用动态 import：运行到"选中这家"的那一行才去加载，其他家的代码根本不会被执行到。**语法硬要求**：动态 import 返回 Promise，必须 await，因此所有加载器都是 async 函数。

### 2、模块级变量 `let cachedModel: ModelInstance | undefined`——为什么需要一个"全局小仓库"

**因为**"创建模型"是异步的、"Agent 构造"是同步的，两者之间必须有一个"中转仓库"：configureModel（异步世界）把造好的模型放进仓库，getModel（同步世界）从仓库取。**所以**在模块顶层声明一个变量充当仓库。**为什么用 `let` + `undefined` 初始值**：要区分"还没造"（undefined）和"已造好"，getModel 靠这个判断决定放行还是抛错；**为什么不用 globalThis 之类的全局对象**：模块级变量自带"本包私有"边界，外部摸不到，只能通过三件套操作——封装性更好。

### 3、取值链 `env.X ?? process.env.X_ENV ?? '默认值'`——为什么每级都不可少

- 第一级 `env.X`：代码显式传入，优先级最高（测试和特殊部署需要覆盖一切）；
- 第二级 `process.env.X`：环境变量，部署时的正规配置方式（改配置不用改代码）；
- 第三级字面量默认值：保证"零配置也能跑"，把接入门槛降到最低。
**如果去掉某一级**：去第一级 → 测试没法覆盖配置；去第二级 → 部署必须改代码（运维噩梦）；去第三级 → 新手必须查文档填全套配置（劝退）。三级链是"灵活、可运维、低门槛"的平衡。

### 4、`case '': throw new ModelNotConfiguredError()`——为什么空串要单独一个分支

**因为**"没选厂商"和"选错了厂商"是两种完全不同的错误：前者是"还没配"（新手流程没走完，要给操作指南），后者是"配错了"（要列出合法值对照）；**所以**分两个分支、两种错误、两种提示——把新手最可能遇到的场景给最详细的指引。

### 5、loadOpenAI 里 `...(modelId ? { modelId } : {})` 条件展开——为什么不直接传 `modelId: modelId`

**因为** modelId 在这里可能为 undefined（OpenAI 没有默认模型名，是"可选透传"）；**如果**硬传 `modelId: undefined`，SDK 内部可能把这个字段当成"明确要设为空"而报参数校验错；**所以**用"有才传"的条件展开——undefined 时干脆不带这个字段，让 SDK 走自己的默认逻辑。这是处理"可选透传参数"的标准技巧。

### 6、loadMeimaoapi 的 `defaultHeaders: { 'User-Agent': 'meimao-house-butler/0.1' }`——为什么多这一行

**因为**源码注释明确记载：眉猫 API 会拦截 OpenAI 官方 SDK 的默认 User-Agent（官方 SDK 的 UA 标识会被它拒掉），**所以**必须伪装/自定义成一个自家标识的请求头才能正常通信。**删掉这一行的后果**：程序启动正常、配置全对，但每次模型请求都失败——而且错误信息来自对方服务器，极难定位。这是全文件最隐蔽也最致命的一行。

### 7、各加载器 catch 里的错误转译——为什么报错信息要带"怎么救"

**因为**加载失败的两大原因（没装依赖、配置错误）用户完全可以自己解决，只要告诉他怎么做；**所以**每个 catch 都把原始错误包进人话提示（"使用该厂商需先安装依赖: npm i xxx"）。**如果直接让原始异常冒出来**：用户看到的是 Node 模块系统的 "Cannot find module" 天书，救援成本翻几倍。

---

## 模块5：文件整体运行总结

### 1、从加载到运行完成的完整步骤流程

1. 程序启动，经由 `index.ts` 被 Agent 相关代码加载（**此刻只加载了本文件自身**，任何厂商 SDK 都还没加载——这就是"零绑定"）；
2. 入口代码执行 `await configureModel()`（或 `configureModel({ provider: 'xxx', ... })`）；
3. `createModel` 清洗厂商名 → switch 分发 → 对应 loadXxx 被调用 → 动态加载该厂商 SDK → 取值链凑齐配置 → 构造模型实例 → 存入 `cachedModel`；
4. 之后任意时刻：`defineSubAgent` / 管家构造 Agent 时调 `getModel()`（同步）→ 缓存里有就发放，没有就抛带操作指南的错误；
5. 测试场景：`setModel(假模型)` 直接改写仓库内容，全链路用假脑跑。

### 2、文件在整个工程中不可替代的作用

**它是全工程唯一"发大脑"的地方**：厂商可插拔（换厂商 = 改一个环境变量）、依赖可裁剪（用哪家装哪家）、失败可自救（错误信息带操作指南）、测试可注脑（setModel）。工程"厂商零绑定"的核心原则 100% 落在这一个文件里。

### 3、运行依赖的环境与前置条件

- 基础依赖：仅 `@strands-agents/sdk` 的类型；**厂商 SDK 按需**（openai 包已在依赖里，ollama-ai-provider 要用才装）；
- 前置条件：入口必须先 `await configureModel()`（或 setModel）；对应厂商的钥匙/服务已就绪；
- 无数据库、无协议依赖——它是纯粹的"厂商接入口"。

---

## 模块6：可复用模块 / 易错点 / 调试关键点 / 修改注意事项（⚠️ 高亮）

### ✅ 可复用模块

- **"动态 import + 加载器 + switch 分发"三件套**：任何"多厂商/多后端可插拔"需求都能照抄这套结构（存储后端、消息通道同理）；
- **三级取值链模式**（显式 > 环境变量 > 默认值）：所有需要配置的参数都该这么写；
- **`configureModel/getModel/setModel` 异步造、同步取的缓存模式**：任何"异步初始化 + 同步构造"的冲突场景都适用。

### ⚠️ 易错点

1. **忘调 `await configureModel()`**：症状是 defineSubAgent/管家构造时抛 ModelNotConfiguredError——按错误指南补入口调用即可；
2. **环境变量名拼错**：比如把 DEEPSEEK_API_KEY 写成 DEEPSEEK_APIKEY——症状是"明明 .env 里写了还报没配"，按"字段名 ↔ 环境变量名"对照表排查；
3. **OPENAI_MODEL_ID 没配也没事、配错了才炸**：OpenAI 走 SDK 默认模型，但填了个不存在的型号会在首次请求时报错（配置错误晚发现）；
4. **Ollama 三前置**：依赖没装、服务没起、模型没 pull，三者报错长相接近，按 loadOllama 错误信息逐项核对；
5. **重复 configureModel 切厂商**：缓存被覆盖，但已构造的 Agent 还握着旧脑——切厂商要在创建 Agent 之前。

### 🔍 调试关键点

- **先分清两种错误**：ModelNotConfiguredError（压根没配，查入口顺序）vs 各家 SDK 的运行错误（配了但连不上，查钥匙/网络/服务）；
- 想确认当前用的什么厂商/模型：打印 `configureModel` 的返回实例或给 getModel 结果加日志；
- 请求全部失败但启动正常：优先怀疑 loadMeimaoapi 的 User-Agent 行被删过（历史坑），再查钥匙。

### 🚫 修改红线（不能改）与可优化点

| 位置 | 能不能动 | 说明 |
|---|---|---|
| 动态 import 结构 | 🚫 不能改成静态 import | 改了 = 启动强制加载全部厂商 = 未装依赖的环境启动即崩 |
| `cachedModel` 缓存机制与三件套签名 | 🚫 不能改 | 管家、子 Agent、测试全按这套发放流程工作 |
| meimaoapi 的 `defaultHeaders` User-Agent | 🚫 不能删 | 删了请求被眉猫拦截，全链路模型调用失败且难排查 |
| ModelNotConfiguredError 的提示文案 | 🚫 不要精简 | 它是新手第一坑的自救指南 |
| switch 里新增厂商 case | ✅ 可扩展 | 照抄现有加载器结构（动态 import + 取值链 + catch 转译）；新厂商若是 OpenAI 兼容的，直接仿 loadDeepSeek 最省事 |
| 各默认模型名/区域 | ✅ 可优化 | 跟着厂商官方型号更新，注意同步 ModelEnv 注释 |
| maxTokens / temperature | ✅ 可调 | 属于回答长度与风格调参，按业务需要改，但要在文档里记录改动原因 |
