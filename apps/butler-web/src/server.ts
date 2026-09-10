/**
 * 大管家 Web 服务（零框架，Node 原生 http）
 *
 * 接口：
 *   GET  /            聊天页面
 *   GET  /api/health  模型配置状态 { modelConfigured, provider }
 *   GET  /api/agents  花名册 [{ id, name, domain, description }]
 *   POST /api/chat    { message } -> { reply }
 *
 * 存储：启动即建库/迁移（BUTLER_DB_PATH，缺省 ./data/butler.db），
 *       管家与全部子 agent 身份入库，chat 持久化 会话/消息/事件。
 *
 * 运行：npm run web （先配置 .env 的 MODEL_PROVIDER；未配置时界面会提示）
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, dirname, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureModel, ModelNotConfiguredError } from '@meimaohouse/agent-sdk'
import { Butler } from '@meimaohouse/butler-core'
import {
  openDatabase,
  closeDatabase,
  ensureButlerAgent,
  ensureSubAgent,
  listTables,
  describeTable,
  listIndexes,
  selectRows,
} from '@meimaohouse/db'
import { agents } from './agents.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = join(__dirname, '..', 'public')
const PORT = Number(process.env.PORT ?? 8790)

/* ---------------- 数据库装配（建库 + agent 身份入库，幂等） ---------------- */

const db = openDatabase()
const butlerRow = ensureButlerAgent(db)
for (const sa of agents) {
  ensureSubAgent(db, sa.spec, { parentAgentId: butlerRow.agent_id })
}
console.log(`[butler-web] 数据库就绪: ${process.env.BUTLER_DB_PATH ?? './data/butler.db'}（agents 已登记）`)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/* ---------------- 管家装配（常驻进程，保留多轮对话记忆 + SQLite 持久化） ---------------- */

const butler = new Butler({ subAgents: agents, db })

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
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf-8')
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

    /* 数据库浏览器 API（只读） */
    if (path === '/api/db/tables') {
      return sendJson(res, 200, { tables: listTables(db).map((t) => ({ name: t.name, kind: t.kind, rowCount: t.rowCount })) })
    }

    if (path.startsWith('/api/db/table/') && req.method === 'GET') {
      const name = decodeURIComponent(path.slice('/api/db/table/'.length))
      const limit = Number(url.searchParams.get('limit') ?? 50)
      const offset = Number(url.searchParams.get('offset') ?? 0)
      try {
        const info = listTables(db).find((t) => t.name === name)
        if (!info) return sendJson(res, 404, { error: `未知表: ${name}` })
        return sendJson(res, 200, {
          name,
          rowCount: info.rowCount,
          ddl: info.ddl,
          columns: describeTable(db, name),
          indexes: listIndexes(db, name),
          rows: selectRows(db, name, limit, offset),
          limit,
          offset,
        })
      } catch (err) {
        return sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
      }
    }

    if (path === '/api/chat' && req.method === 'POST') {
      if (!modelConfigured) {
        return sendJson(res, 503, {
          error: '模型未配置',
          hint: '请在 .env 中设置 MODEL_PROVIDER（见根目录 .env.example）后重启服务。',
        })
      }
      const body = JSON.parse((await readBody(req)) || '{}')
      const message: string = typeof body.message === 'string' ? body.message.trim() : ''
      if (!message) return sendJson(res, 400, { error: 'message 不能为空' })
      const reply = await butler.chat(message)
      return sendJson(res, 200, { reply })
    }

    /* 静态文件 */
    const relPath = path === '/' ? 'index.html' : path.slice(1)
    const filePath = normalize(join(PUBLIC_DIR, relPath))
    if (!filePath.startsWith(PUBLIC_DIR)) {
      return sendJson(res, 403, { error: 'forbidden' })
    }
    const content = await readFile(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    return res.end(content)
  } catch (err) {
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

server.listen(PORT, () => {
  console.log(`[butler-web] 大管家 Web 界面已启动: http://127.0.0.1:${PORT}`)
  console.log(`[butler-web] 已装配子 Agent: ${agents.map((a) => a.spec.id).join(', ')}`)
})

// 优雅退出：先关 HTTP，再关数据库（checkpoint WAL，把 -wal 日志合并回主文件）
process.on('SIGINT', () => {
  server.close(() => {
    try {
      closeDatabase(db)
    } catch {
      /* 已关闭则忽略 */
    }
    process.exit(0)
  })
})
