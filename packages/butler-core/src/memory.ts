/**
 * 记忆组装器（butler 工作记忆）—— Hermes 纪律的实现：上下文恒定有界。
 *
 * 结构（每轮动态组装，进程内不攒历史）：
 *   system prompt（人设+花名册，原有）
 *   + 【长期纪要】agent_memories(ns='brief')，覆盖式更新，≤500 字
 *   + 【近期对话】最近 WINDOW 条消息，从 DB 现读
 *
 * 水位与压缩：
 *   - 水位 baseline：上次已压缩到的 message_id（agent_memories, ns='brief', key='watermark'）；
 *   - 未压缩消息 > COMPRESS_THRESHOLD 条时，用但管模型把 [水位, 最新] 段压缩进纪要
 *     （纪要员规则：解决即弃 / 过期待办过期自灭 / 只保留未决+偏好+承诺），推进水位；
 *   - 重启恢复：纪要与水位都在 DB，窗口现读 → 零失忆。
 */
import type { Db } from '@meimaohouse/db'
import { MemoryRepository, MessageRepository } from '@meimaohouse/db'
import type { MessageRow } from '@meimaohouse/db'

export const WINDOW = 20 // 近期窗口：最近 20 条
export const COMPRESS_THRESHOLD = 30 // 未压缩消息超过 30 条触发压缩
export const BRIEF_MAX_CHARS = 600 // 纪要长度上限（约 500 汉字）

export interface AssembledContext {
  /** 拼进本轮请求的历史文本（纪要 + 窗口消息） */
  historyText: string
  /** 本轮实际使用的窗口消息（含本轮之外的近期历史） */
  window: MessageRow[]
  /** 是否在本次调用中触发了压缩 */
  compressed: boolean
}

function fmtMessage(m: MessageRow): string {
  const who = m.sender_kind === 'human' ? '主人' : m.sender_kind === 'butler' ? '管家' : m.sender_kind
  const content = m.content.length > 200 ? m.content.slice(0, 200) + '…' : m.content
  return `[${who}] ${content.replace(/\s+/g, ' ')}`
}

/** 读当前纪要与水位 */
export function loadBrief(db: Db, userId: number): { brief: string; watermark: number } {
  const repo = new MemoryRepository(db)
  const brief = repo.get({ agentId: butlerAgentId(db), userId, ns: 'brief' }, 'brief') ?? ''
  const wm = repo.get({ agentId: butlerAgentId(db), userId, ns: 'brief' }, 'watermark')
  return { brief, watermark: wm ? Number(wm) : 0 }
}

function butlerAgentId(db: Db): number {
  const row = db.prepare("SELECT agent_id FROM agents WHERE agent_key = 'butler'").get() as
    | { agent_id: number }
    | undefined
  if (!row) throw new Error('agents 表中没有 butler，请先 ensureButlerAgent(db)')
  return row.agent_id
}

/**
 * 组装本轮工作记忆；水位到达阈值时同步执行压缩（压缩失败不影响本轮对话）。
 * summarize 为但管模型封装：输入压缩指令 prompt，输出纪要文本。
 */
export async function assembleMemory(
  db: Db,
  userId: number,
  summarize: (prompt: string) => Promise<string>,
): Promise<AssembledContext> {
  const mem = new MemoryRepository(db)
  const scope = { agentId: butlerAgentId(db), userId, ns: 'brief' }
  const msg = new MessageRepository(db)

  const { brief, watermark } = loadBrief(db, userId)
  const latest = msg.latestIdByUser(userId)

  /* ---- ① 压缩检查：未压缩消息量超阈值 → 生成新纪要 ---- */
  let compressed = false
  let currentBrief = brief
  const pending = latest - watermark
  if (pending >= COMPRESS_THRESHOLD && latest > 0) {
    try {
      const segment = msg
        .listByUser(userId, { afterId: watermark, limit: 200, order: 'asc' })
        .map(fmtMessage)
        .join('\n')
      const oldBriefPart = currentBrief ? `【当前纪要（在此基础上修订）】\n${currentBrief}\n\n` : ''
      const prompt = `你是庄园管家的记忆管理员。下面是管家与主人近期的一段对话记录${currentBrief ? '（此前已有一份纪要）' : ''}。
请把它压缩成一份不超过 ${BRIEF_MAX_CHARS} 字的【长期纪要】，只保留三类信息：
1. 未决事项/待办（谁、什么时候、做什么）；
2. 主人的稳定偏好与长期约定；
3. 重要承诺与背景事实。

硬性清除规则：
- 主人已明确办结/取消/拒绝的事项 → 删除，不再出现；
- 带日期的待办若日期已过且对话中没有后续跟进 → 删除；
- 与以上三类无关的寒暄、过程细节 → 删除。
其余未变化的内容原样保留。只输出纪要正文，不要任何解释或标题。

${oldBriefPart}【待压缩的对话记录】
${segment}`
      const next = (await summarize(prompt)).trim()
      if (next && next.length <= BRIEF_MAX_CHARS * 3) {
        // 容错：模型偶尔超长也收下（尾部截断），但不让失控输出污染记忆
        currentBrief = next.slice(0, BRIEF_MAX_CHARS * 3)
        mem.set(scope, 'brief', currentBrief)
        mem.set(scope, 'watermark', String(latest))
        compressed = true
      }
    } catch {
      /* 压缩失败：本轮照常用旧纪要，下轮重试 */
    }
  }

  /* ---- ② 组装上下文：纪要 + 最近 WINDOW 条 ---- */
  const window = msg.listByUser(userId, { limit: WINDOW, order: 'desc' }).reverse()
  const parts: string[] = []
  if (currentBrief) {
    parts.push(`【长期纪要（之前对话的浓缩，含未决事项与约定）】\n${currentBrief}`)
  }
  if (window.length > 0) {
    parts.push(`【近期对话（最近 ${window.length} 条）】\n${window.map(fmtMessage).join('\n')}`)
  }
  return { historyText: parts.join('\n\n'), window, compressed }
}
