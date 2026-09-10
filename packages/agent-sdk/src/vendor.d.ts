/**
 * 可选厂商的类型声明（不强制安装）。
 * ollama-ai-provider 仅在 MODEL_PROVIDER=ollama 时被动态 import；
 * 未安装该包时，此声明保证类型检查通过；运行时缺失会得到清晰的错误提示。
 */
declare module 'ollama-ai-provider' {
  export interface CreateOllamaOptions {
    baseURL?: string
  }
  export function createOllama(
    options?: CreateOllamaOptions,
  ): (modelId: string) => any
}
