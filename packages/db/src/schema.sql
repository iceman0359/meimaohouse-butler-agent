-- ============================================================================
-- meimaohouse-butler-agent 通用数据库 schema（SQLite）
-- 设计目标：3NF · 多用户隔离 · 主/子 agent 统一建模 · 任意子 agent 零 schema 变更接入
-- 本文件是【最终形态参考副本】（= v1 迁移 + v2 迁移重建后的 tasks 表），
-- 运行时真实 DDL 以 packages/db/src/db.ts 的 MIGRATIONS 数组为准。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- v1：核心域模型
-- ---------------------------------------------------------------------------

-- 用户（庄园主人/家庭成员）
CREATE TABLE IF NOT EXISTS users (
  user_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL,
  display_name TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username);

-- 用户偏好（1:1 用户；kind 区分偏好类别，与用户组成唯一键）
-- ER 图原为「1 用户 1 套偏好（饮食/家务/购物 4 个列）」；
-- 规范化为 (user_id, kind, content)，新增偏好类别无需改表（3NF：消除对主键的多值依赖）
CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL CHECK (kind IN ('diet','housework','shopping')),
  content       TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_pref ON user_preferences(user_id, kind);

-- Agent 注册表（主 agent 与子 agent 统一建模）
-- role 区分 butler / sub；parent_agent_id 自引用表达「主管理子」
-- 新增任意子 agent = 在 agents 表 INSERT 一行，零 schema 变更
CREATE TABLE IF NOT EXISTS agents (
  agent_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key       TEXT    NOT NULL,                    -- 领域标识，如 chef / cleaner
  role            TEXT    NOT NULL CHECK (role IN ('butler','sub')),
  name            TEXT    NOT NULL,                    -- 展示名，如 厨师
  domain          TEXT    NOT NULL,                    -- 领域名，如 厨房域
  description     TEXT    NOT NULL,                    -- 路由描述（管家靠它派活）
  system_prompt   TEXT,                                -- 职责 prompt（可空=运行时生成）
  parent_agent_id INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
  config_json     TEXT,                                -- 模型/扩展配置（JSON 文本）
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_key ON agents(agent_key);
CREATE INDEX IF NOT EXISTS ix_agents_parent ON agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS ix_agents_role   ON agents(role);

-- 会话（ER 图：agent 会话；1 用户 n 会话；负责 agent = 当前应答的主 agent）
CREATE TABLE IF NOT EXISTS sessions (
  session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id     INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,  -- 负责 agent（缺省=主管家）
  title        TEXT    NOT NULL DEFAULT '新会话',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_agent  ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS ix_sessions_latest ON sessions(user_id, updated_at DESC);

-- 消息（会话内逐条对话；sender 区分 human/butler/sub/agent）
-- 独立成表而非塞进 sessions.text：每条消息一行，3NF 且可按会话/角色/时间检索
CREATE TABLE IF NOT EXISTS messages (
  message_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sender_kind TEXT    NOT NULL CHECK (sender_kind IN ('human','butler','sub','system')),
  sender_id   TEXT,                                 -- 但管的 agent_key（human/system 时为空）
  content     TEXT    NOT NULL,
  meta_json   TEXT,                                 -- 扩展元数据（JSON 文本）
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id, message_id);

-- 任务（协议落地：TaskEnvelope 进 / ResultEnvelope 回）
-- intent/params/priority/source 来自 TaskRequest；task_key=协议 task_id
-- status/result 对应 ResultEnvelope；session_id 溯源（可空=系统直派）
CREATE TABLE IF NOT EXISTS tasks (
  task_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key     TEXT    NOT NULL,                    -- 协议 task_id（chef_xxx_yyy）
  session_id   INTEGER REFERENCES sessions(session_id) ON DELETE SET NULL,
  user_id      INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  butler_agent_id INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
  sub_agent_id    INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
  intent       TEXT    NOT NULL,
  params_json  TEXT    NOT NULL DEFAULT '{}',
  priority     TEXT    NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  source       TEXT    NOT NULL DEFAULT 'human',
  deadline     TEXT,
  status       TEXT    NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','done','failed','needs_human','deferred','unavailable')),
  summary      TEXT,
  detail_json  TEXT,
  error        TEXT,
  error_code   TEXT,
  suggestions_json TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_key     ON tasks(task_key);
CREATE INDEX IF NOT EXISTS ix_tasks_session        ON tasks(session_id);
CREATE INDEX IF NOT EXISTS ix_tasks_user           ON tasks(user_id);
CREATE INDEX IF NOT EXISTS ix_tasks_sub_agent      ON tasks(sub_agent_id);
CREATE INDEX IF NOT EXISTS ix_tasks_status_created ON tasks(status, created_at);

-- Agent 记忆（子 agent 长期记忆；通用键值 + 命名空间，替代进程内 Memory）
-- (agent_id, user_id, ns, key) 唯一；user_id 可空 = agent 级公共记忆
CREATE TABLE IF NOT EXISTS agent_memories (
  memory_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id   INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  user_id    INTEGER REFERENCES users(user_id) ON DELETE CASCADE,
  ns         TEXT    NOT NULL DEFAULT 'default',
  mem_key    TEXT    NOT NULL,
  value      TEXT    NOT NULL,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_memory_key ON agent_memories(agent_id, IFNULL(user_id,0), ns, mem_key);
CREATE INDEX IF NOT EXISTS ix_memory_agent_user ON agent_memories(agent_id, user_id);

-- 购物记录（ER 图：购物记录；挂在会话下，物品名/数量/已购状态）
-- 类型/单位独立成列（原子性，满足 1NF）；note 独立列不与名称混合
CREATE TABLE IF NOT EXISTS shopping_items (
  shopping_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT, -- 产生记录的子 agent
  name        TEXT    NOT NULL,
  quantity    REAL    NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit        TEXT,
  purchased   INTEGER NOT NULL DEFAULT 0 CHECK (purchased IN (0,1)),
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_shopping_session ON shopping_items(session_id);
CREATE INDEX IF NOT EXISTS ix_shopping_user    ON shopping_items(user_id, purchased);
CREATE INDEX IF NOT EXISTS ix_shopping_agent   ON shopping_items(agent_id);

-- 家务记录（ER 图：家务记录；类型/完成状态/可选截止时间）
CREATE TABLE IF NOT EXISTS chores (
  chore_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT, -- 产生记录的子 agent
  chore_type  TEXT    NOT NULL,
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0,1)),
  note        TEXT,
  due_at      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_chores_session ON chores(session_id);
CREATE INDEX IF NOT EXISTS ix_chores_user    ON chores(user_id, done);
CREATE INDEX IF NOT EXISTS ix_chores_agent   ON chores(agent_id);

-- 事件流水（通用审计/观测：子 agent 任意结构化事实走这里，3NF 下不污染业务表）
CREATE TABLE IF NOT EXISTS agent_events (
  event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
  session_id INTEGER REFERENCES sessions(session_id) ON DELETE SET NULL,
  agent_id   INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
  task_id    INTEGER REFERENCES tasks(task_id) ON DELETE SET NULL,
  event_type TEXT    NOT NULL,
  payload_json TEXT,
  created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_agent_type ON agent_events(agent_id, event_type, created_at);
CREATE INDEX IF NOT EXISTS ix_events_session    ON agent_events(session_id);
