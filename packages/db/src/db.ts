/**
 * 数据库连接与迁移管理。
 *
 * - 单文件 SQLite（better-sqlite3，同步 API），WAL 模式 + 外键强制开启；
 * - 迁移：每个 schema 版本一段 DDL，按 user_version 单调执行；
 *   v1 = 全量核心表（见 schema.sql，此处内联等价 DDL，避免运行时读文件路径问题）；
 * - 本模块不持业务逻辑，业务访问一律走 repositories（见 ./repositories.ts）。
 */
import DatabaseCtor from 'better-sqlite3'
import type { Database } from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export interface DbOptions {
  /** SQLite 文件路径；缺省 './data/butler.db'；':memory:' 用于测试 */
  path?: string
}

/** 迁移脚本：index 0 → user_version 1，依序执行 */
const MIGRATIONS: string[] = [
  // ---- v1：核心域模型 ----
  `
CREATE TABLE IF NOT EXISTS users (
  user_id     INTEGER PRIMARY KEY AUTOINCREMENT,
  username    TEXT    NOT NULL,
  display_name TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_users_username ON users(username);

CREATE TABLE IF NOT EXISTS user_preferences (
  preference_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  kind          TEXT    NOT NULL CHECK (kind IN ('diet','housework','shopping')),
  content       TEXT    NOT NULL,
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_pref ON user_preferences(user_id, kind);

CREATE TABLE IF NOT EXISTS agents (
  agent_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_key       TEXT    NOT NULL,
  role            TEXT    NOT NULL CHECK (role IN ('butler','sub')),
  name            TEXT    NOT NULL,
  domain          TEXT    NOT NULL,
  description     TEXT    NOT NULL,
  system_prompt   TEXT,
  parent_agent_id INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
  config_json     TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_agents_key ON agents(agent_key);
CREATE INDEX IF NOT EXISTS ix_agents_parent ON agents(parent_agent_id);
CREATE INDEX IF NOT EXISTS ix_agents_role   ON agents(role);

CREATE TABLE IF NOT EXISTS sessions (
  session_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id     INTEGER REFERENCES agents(agent_id) ON DELETE SET NULL,
  title        TEXT    NOT NULL DEFAULT '新会话',
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS ix_sessions_agent  ON sessions(agent_id);
CREATE INDEX IF NOT EXISTS ix_sessions_latest ON sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  message_id  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  sender_kind TEXT    NOT NULL CHECK (sender_kind IN ('human','butler','sub','system')),
  sender_id   TEXT,
  content     TEXT    NOT NULL,
  meta_json   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_messages_session ON messages(session_id, message_id);

CREATE TABLE IF NOT EXISTS tasks (
  task_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key     TEXT    NOT NULL,
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
               CHECK (status IN ('pending','done','failed','needs_human','deferred')),
  summary      TEXT,
  detail_json  TEXT,
  error        TEXT,
  suggestions_json TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_key     ON tasks(task_key);
CREATE INDEX IF NOT EXISTS ix_tasks_session        ON tasks(session_id);
CREATE INDEX IF NOT EXISTS ix_tasks_user           ON tasks(user_id);
CREATE INDEX IF NOT EXISTS ix_tasks_sub_agent      ON tasks(sub_agent_id);
CREATE INDEX IF NOT EXISTS ix_tasks_status_created ON tasks(status, created_at);

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

CREATE TABLE IF NOT EXISTS shopping_items (
  shopping_id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
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

CREATE TABLE IF NOT EXISTS chores (
  chore_id    INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  INTEGER NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  user_id     INTEGER NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  agent_id    INTEGER NOT NULL REFERENCES agents(agent_id) ON DELETE RESTRICT,
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
`,
  // ---- v2：任务状态新增 unavailable（协议演进：能力未配置语义）+ error_code 字段。
  // CHECK 约束无法 ALTER，重建 tasks 表（数据完整迁移，索引重建）。
  `
CREATE TABLE tasks_v2 (
  task_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  task_key     TEXT    NOT NULL,
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
INSERT INTO tasks_v2 (task_id, task_key, session_id, user_id, butler_agent_id, sub_agent_id,
                      intent, params_json, priority, source, deadline, status,
                      summary, detail_json, error, suggestions_json, created_at, completed_at)
SELECT task_id, task_key, session_id, user_id, butler_agent_id, sub_agent_id,
       intent, params_json, priority, source, deadline, status,
       summary, detail_json, error, suggestions_json, created_at, completed_at FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_v2 RENAME TO tasks;
CREATE UNIQUE INDEX IF NOT EXISTS ux_tasks_key     ON tasks(task_key);
CREATE INDEX IF NOT EXISTS ix_tasks_session        ON tasks(session_id);
CREATE INDEX IF NOT EXISTS ix_tasks_user           ON tasks(user_id);
CREATE INDEX IF NOT EXISTS ix_tasks_sub_agent      ON tasks(sub_agent_id);
CREATE INDEX IF NOT EXISTS ix_tasks_status_created ON tasks(status, created_at);
`,
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS.length

/** 打开（或创建）数据库并迁移到最新版本 */
export function openDatabase(opts: DbOptions = {}): Database {
  const path = opts.path ?? process.env.BUTLER_DB_PATH ?? './data/butler.db'
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true })
  }
  const db = new DatabaseCtor(path)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
}

/** 逐版本执行迁移（幂等：已执行的版本跳过） */
export function migrate(db: Database): void {
  const current = Number(db.pragma('user_version', { simple: true }) as number)
  if (current >= MIGRATIONS.length) return
  // 重建表型迁移（v2）需要临时关闭外键（PRAGMA 在事务内是 no-op，必须在事务外切）
  db.pragma('foreign_keys = OFF')
  try {
    for (let v = current; v < MIGRATIONS.length; v++) {
      const apply = db.transaction(() => {
        db.exec(MIGRATIONS[v])
        db.pragma(`user_version = ${v + 1}`)
      })
      apply()
    }
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

/** 关闭连接（测试与优雅退出用） */
export function closeDatabase(db: Database): void {
  db.close()
}
