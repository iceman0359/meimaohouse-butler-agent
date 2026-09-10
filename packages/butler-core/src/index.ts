/**
 * @meimaohouse/butler-core
 * 大管家核心：Butler 主类 + 管家 prompt 模板 + 工作记忆组装（Hermes 纪律）
 */
export { Butler, type ButlerOptions } from './butler.js'
export { buildButlerSystemPrompt, type RosterEntry } from './prompts.js'
export {
  assembleMemory,
  loadBrief,
  WINDOW,
  COMPRESS_THRESHOLD,
  BRIEF_MAX_CHARS,
  type AssembledContext,
} from './memory.js'
