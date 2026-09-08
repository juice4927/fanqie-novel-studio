import type { ApiSurface } from "../../../src/shared/ai/types";
import { createAnthropicMessagesDriver } from "./anthropic-messages";
import { createOpenAiChatDriver } from "./openai-chat";
import { createOpenAiResponsesDriver } from "./openai-responses";
import type { DriverConfig, ModelDriver } from "./types";

export * from "./anthropic-messages";
export * from "./openai-chat";
export * from "./openai-responses";
export * from "./sse";
export * from "./types";
export * from "./usage";

/** 按协议面选择驱动；协议面来自来源声明或一次性协商结果。 */
export function createDriver(apiSurface: ApiSurface, config: DriverConfig): ModelDriver {
  if (apiSurface === "anthropic-messages") return createAnthropicMessagesDriver(config);
  if (apiSurface === "openai-responses") return createOpenAiResponsesDriver(config);
  return createOpenAiChatDriver(config);
}
