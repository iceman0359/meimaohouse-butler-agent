/**
 * 大管家 Web 服务（零框架，Node 原生 http）
 *
 * 接口：
 *   GET  /              聊天页面
 *   GET  /db.html       数据库浏览器（只读）
 *   GET  /api/health    模型配置状态 { modelConfigured, provider }
 *   GET  /api/agents    花名册 [{ id, name, domain, description }]
 *   POST /api/chat      { message } -> { reply }
 *   GET  /api/db/tables            全部表 + 行数
 *   GET  /api/db/table/<名>?limit&offset   表结构/DDL/索引/数据
 *
 * 存储：启动即建库/迁移（BUTLER_DB_PATH，缺省 ./data/butler.db），
 *       管家与全部子 agent 身份入库；chat 持久化 会话/消息/事件；
 *       管家与子 agent 的 memory 工具经 createSqliteMemory 落到同一库。
 *
 * 运行：npm run web （先配置 .env 的 MODEL_PROVIDER；未配置时界面会提示）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, isAbsolute, join, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureModel, ModelNotConfiguredError } from '@meimaohouse/agent-sdk'
import { Butler } from '@meimaohouse/butler-core'
import {
  closeDatabase,
  createSqliteMemory,
  describeTable,
  ensureButlerAgent,
  ensureSubAgent,
  listIndexes,
  listTables,
  openDatabase,
  selectRows,
} from '@meimaohouse/db'
import { agents } from './agents.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT ?? 8790)
const MAX_BODY_BYTES = 16 * 1024

if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error(`PORT 配置无效: ${process.env.PORT}`)
}

class RequestBodyTooLargeError extends Error {}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/* ---------------- 数据库装配（建库 + 迁移 + agent 身份入库，幂等） ---------------- */

const db = openDatabase()
const butlerRow = ensureButlerAgent(db)
const subAgentIds = new Map<string, number>()
for (const sa of agents) {
  const row = ensureSubAgent(db, sa.spec, { parentAgentId: butlerRow.agent_id })
  subAgentIds.set(sa.spec.id, row.agent_id)
}
console.log(`[butler-web] 数据库就绪: ${process.env.BUTLER_DB_PATH ?? './data/butler.db'}（agents 已登记）`)

/* ---------------- 管家装配（无状态工作记忆 + SQLite 持久化） ---------------- */

// 管家的 memory 工具（memory_get/set/append/delete）经 createSqliteMemory 落库
const butler = new Butler({
  subAgents: agents,
  db,
  memory: createSqliteMemory(db, { agentId: butlerRow.agent_id, ns: 'butler' }),
})

let modelConfigured = false
let modelProvider = ''
try {
  await configureModel()
  modelConfigured = true
  modelProvider = process.env.MODEL_PROVIDER ?? ''
  console.log(`[butler-web] 模型已配置: provider=${modelProvider}`)
} catch (err) {
  console.warn(
    `[butler-web] 模型未配置（界面将提示；配置后重启即可）: ${
      err instanceof Error ? err.message.split('\n')[0] : err
    }`,
  )
}

/* ---------------- 工具函数 ---------------- */

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BODY_BYTES) {
      throw new RequestBodyTooLargeError('请求体过大')
    }
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf-8')
}

/* ---------------- 数据库浏览器 API（只读，表名白名单校验） ---------------- */

function dbTablePayload(name: string, limit: number, offset: number) {
  const info = listTables(db).find((t) => t.name === name)
  if (!info) return undefined
  return {
    name,
    rowCount: info.rowCount,
    ddl: info.ddl,
    columns: describeTable(db, name),
    indexes: listIndexes(db, name),
    rows: selectRows(db, name, limit, offset),
    limit,
    offset,
  }
}

/* ---------------- 路由 ---------------- */

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  const path = url.pathname

  try {
    /* API */
    if (path === '/api/health') {
      return sendJson(res, 200, { modelConfigured, modelProvider })
    }

    if (path === '/api/agents') {
      return sendJson(res, 200, { agents: butler.listAgents() })
    }

    if (path === '/api/db/tables') {
      return sendJson(res, 200, {
        tables: listTables(db).map((t) => ({ name: t.name, kind: t.kind, rowCount: t.rowCount })),
      })
    }

    if (path.startsWith('/api/db/table/') && req.method === 'GET') {
      const name = decodeURIComponent(path.slice('/api/db/table/'.length))
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      const payload = dbTablePayload(name, limit, offset)
      if (!payload) return sendJson(res, 404, { error: `未知表: ${name}` })
      return sendJson(res, 200, payload)
    }

    if (path === '/api/chat' && req.method === 'POST') {
      if (!modelConfigured) {
        return sendJson(res, 503, {
          error: '模型未配置',
          hint: '请在 .env 中设置 MODEL_PROVIDER（见根目录 .env.example）后重启服务。',
        })
      }
      const contentType = req.headers['content-type'] ?? ''
      if (!contentType.toLowerCase().includes('application/json')) {
        return sendJson(res, 415, { error: 'Content-Type 必须是 application/json' })
      }
      let body: unknown
      try {
        const rawBody = await readBody(req)
        body = JSON.parse(rawBody || '{}')
      } catch (err) {
        if (err instanceof RequestBodyTooLargeError) throw err
        return sendJson(res, 400, { error: '请求体必须是合法 JSON' })
      }
      if (!body || typeof body !== 'object') {
        return sendJson(res, 400, { error: '请求体必须是 JSON 对象' })
      }
      const payload = body as { message?: unknown }
      const message: string = typeof payload.message === 'string' ? payload.message.trim() : ''
      if (!message) return sendJson(res, 400, { error: 'message 不能为空' })
      const reply = await butler.chat(message)
      return sendJson(res, 200, { reply })
    }

    /* 静态文件 */
    const relPath = path === '/' ? 'index.html' : path.slice(1)
    const filePath = resolve(PUBLIC_DIR, relPath)
    const relativePath = relative(PUBLIC_DIR, filePath)
    if (relativePath.startsWith('..') || isAbsolute(relativePath)) {
      return sendJson(res, 403, { error: 'forbidden' })
    }
    const content = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    return res.end(content)
  } catch (err) {
    if (err instanceof RequestBodyTooLargeError) {
      return sendJson(res, 413, { error: err.message })
    }
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return sendJson(res, 404, { error: 'not found' })
    }
    if (err instanceof ModelNotConfiguredError) {
      return sendJson(res, 503, {
        error: '模型未配置',
        hint: '请在 .env 中设置 MODEL_PROVIDER（见根目录 .env.example）后重启服务。',
      })
    }
    console.error('[butler-web] 请求处理失败:', err)
    return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
  }
})

server.requestTimeout = 30_000
server.headersTimeout = 10_000

server.listen(PORT, () => {
  console.log(`[butler-web] 大管家 Web 界面已启动: http://127.0.0.1:${PORT}`)
  console.log(`[butler-web] 数据库浏览器: http://127.0.0.1:${PORT}/db.html`)
  console.log(`[butler-web] 已装配子 Agent: ${agents.map((a) => a.spec.id).join(', ')}`)
})

// 优雅退出：先关 HTTP，再关数据库（checkpoint WAL，把 -wal 日志合并回主文件）
function shutdown(): void {
  server.close(() => {
    try {
      closeDatabase(db)
    } catch {
      /* 已关闭则忽略 */
    }
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
