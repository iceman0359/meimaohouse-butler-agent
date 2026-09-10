/**
 * 记忆接口 —— 抽象可插拔。
 *
 * 当前提供进程内内存实现，用于框架跑通；生产环境应替换为外部存储
 * （数据库 / MCP memory server），避免把长期记忆塞进 system prompt 导致上下文膨胀。
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
