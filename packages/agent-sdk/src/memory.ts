import { z } from 'zod'
import { defineDomainTool, type DomainTool } from './capability.js'

/**
 * 记忆接口，抽象可插拔。
 *
 * 当前提供进程内实现；生产环境可替换为数据库或 MCP memory server。
 */
export interface Memory {
  /** 读取一个键的值，不存在返回 null */
  get(key: string): Promise<string | null>
  /** 写入一个键 */
  set(key: string, value: string): Promise<void>
  /** 追加一行（用于日志式记忆，如饮食记录） */
  append(key: string, entry: string): Promise<void>
  /** 删除一个键 */
  del(key: string): Promise<void>
}

export class InMemoryMemory implements Memory {
  private store = new Map<string, string>()

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null
  }

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value)
  }

  async append(key: string, entry: string): Promise<void> {
    const existing = this.store.get(key)
    this.store.set(key, existing ? `${existing}\n${entry}` : entry)
  }

  async del(key: string): Promise<void> {
    this.store.delete(key)
  }
}

/** 创建记忆实例（默认内存实现，后续可替换为工厂注入外部存储） */
export function createMemory(): Memory {
  return new InMemoryMemory()
}

/** 把 Memory 暴露为 Agent 可调用的工具。 */
export function createMemoryTools(memory: Memory, namespace = 'default'): DomainTool[] {
  const keyOf = (key: string) => `${namespace}:${key}`

  return [
    defineDomainTool({
      name: 'memory_get',
      description: '读取长期记忆中的值；不存在时返回 null。',
      inputSchema: z.object({
        key: z.string().min(1).describe('记忆键'),
      }),
      execute: async ({ key }) => ({ value: await memory.get(keyOf(key)) }),
    }),
    defineDomainTool({
      name: 'memory_set',
      description: '写入或覆盖长期记忆中的值。',
      inputSchema: z.object({
        key: z.string().min(1).describe('记忆键'),
        value: z.string().describe('要保存的文本'),
      }),
      execute: async ({ key, value }) => {
        await memory.set(keyOf(key), value)
        return { stored: true }
      },
    }),
    defineDomainTool({
      name: 'memory_append',
      description: '向长期记忆中的某个键追加一行。',
      inputSchema: z.object({
        key: z.string().min(1).describe('记忆键'),
        entry: z.string().min(1).describe('要追加的文本'),
      }),
      execute: async ({ key, entry }) => {
        await memory.append(keyOf(key), entry)
        return { appended: true }
      },
    }),
    defineDomainTool({
      name: 'memory_delete',
      description: '删除长期记忆中的某个键。',
      inputSchema: z.object({
        key: z.string().min(1).describe('记忆键'),
      }),
      execute: async ({ key }) => {
        await memory.del(keyOf(key))
        return { deleted: true }
      },
    }),
  ]
}
