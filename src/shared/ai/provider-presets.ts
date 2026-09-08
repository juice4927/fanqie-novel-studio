import type { ApiSurfacePreference, AuthScheme } from "./types";

export interface ProviderPreset {
  key: string;
  label: string;
  baseUrl: string;
  apiSurface: ApiSurfacePreference;
  authScheme: AuthScheme;
  /** 仅作预填，最终以 /models 刷新与目录为准。 */
  defaultModel: string;
  docsUrl: string;
  note: string;
  localEndpoint?: boolean;
}

/** 添加来源时的预设模板：只预填地址与协议面，不预填密钥。 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    key: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    apiSurface: "auto",
    authScheme: "bearer",
    defaultModel: "gpt-6",
    docsUrl: "https://platform.openai.com/docs",
    note: "首次连接会自动协商 Responses 或 Chat Completions",
  },
  {
    key: "anthropic",
    label: "Anthropic Claude",
    baseUrl: "https://api.anthropic.com/v1",
    apiSurface: "anthropic-messages",
    authScheme: "x-api-key",
    defaultModel: "claude-sonnet-4-20250514",
    docsUrl: "https://docs.anthropic.com",
    note: "Messages API，驱动自动附带 anthropic-version 头",
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "deepseek-chat",
    docsUrl: "https://platform.deepseek.com/api-docs",
    note: "适合拆书与状态提取等大批量任务",
  },
  {
    key: "dashscope",
    label: "阿里云百炼（兼容模式）",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "qwen-max",
    docsUrl: "https://help.aliyun.com/zh/model-studio",
    note: "百炼的 OpenAI 兼容端点",
  },
  {
    key: "zhipu",
    label: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "glm-4.6",
    docsUrl: "https://open.bigmodel.cn/dev/api",
    note: "",
  },
  {
    key: "moonshot",
    label: "Moonshot Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "kimi-k2-0905-preview",
    docsUrl: "https://platform.moonshot.cn/docs",
    note: "",
  },
  {
    key: "volcengine",
    label: "火山方舟（豆包）",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "",
    docsUrl: "https://www.volcengine.com/docs/82379",
    note: "模型名填方舟控制台的接入点 ID",
  },
  {
    key: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "",
    docsUrl: "https://openrouter.ai/docs",
    note: "可在附加请求头里加 HTTP-Referer 与 X-Title 供 OpenRouter 统计",
  },
  {
    key: "siliconflow",
    label: "硅基流动 SiliconFlow",
    baseUrl: "https://api.siliconflow.cn/v1",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "",
    docsUrl: "https://docs.siliconflow.cn",
    note: "",
  },
  {
    key: "azure-openai",
    label: "Azure OpenAI",
    baseUrl: "https://<resource>.openai.azure.com/openai/v1",
    apiSurface: "openai-chat",
    authScheme: "api-key",
    defaultModel: "",
    docsUrl: "https://learn.microsoft.com/azure/ai-services/openai",
    note: "在附加查询参数里填 api-version，例如 2024-10-21",
  },
  {
    key: "gateway",
    label: "自建网关（OneAPI / NewAPI）",
    baseUrl: "",
    apiSurface: "openai-chat",
    authScheme: "bearer",
    defaultModel: "",
    docsUrl: "",
    note: "地址与模型名由你填写；密钥头名不同时选自定义请求头",
  },
  {
    key: "local",
    label: "本地模型（Ollama / LM Studio）",
    baseUrl: "http://127.0.0.1:11434/v1",
    apiSurface: "openai-chat",
    authScheme: "none",
    defaultModel: "",
    docsUrl: "",
    note: "需要开启“本地端点”开关；只接受字面量回环/私网 IP",
    localEndpoint: true,
  },
];

export function findProviderPreset(key: string) {
  return PROVIDER_PRESETS.find((preset) => preset.key === key);
}
