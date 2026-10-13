import type { Config } from "../config.js";
import type { IMemoryStore } from "../memory/interface.js";
import type { IConversationStore } from "../memory/types.js";
import { HomeAssistantClient } from "../ha/client.js";
import { DeviceScanner } from "../ha/device-scanner.js";
import { TopologyScanner } from "../ha/topology-scanner.js";
import type { IChatEngine, IFactExtractor } from "./interface.js";
import { LLMClient } from "./client.js";
import { OpenAIChatEngine } from "./openai-client.js";
import { FactExtractor } from "../memory/extractor.js";
import { OpenAIFactExtractor } from "../memory/openai-extractor.js";

export function createChatEngine(
  config: Config,
  memory: IMemoryStore,
  conversations: IConversationStore,
  extractor: IFactExtractor,
  ha: HomeAssistantClient,
  scanner: DeviceScanner,
  topology: TopologyScanner
): IChatEngine {
  switch (config.llmProvider) {
    case "openai":
      return new OpenAIChatEngine(config, memory, conversations, extractor, ha, scanner, topology);
    case "ollama":
      return new OpenAIChatEngine(
        {
          ...config,
          openaiApiKey: "ollama",
          openaiBaseUrl: config.ollamaBaseUrl ?? "http://localhost:11434/v1",
        },
        memory,
        conversations,
        extractor,
        ha,
        scanner,
        topology
      );
    case "anthropic":
      return new LLMClient(config, memory, conversations, extractor, ha, scanner, topology);
  }
}

export function createFactExtractor(config: Config): IFactExtractor {
  // The extraction pass is a short, structured call that rereads one turn —
  // it does not need the main model's general ability, so `extractionModel`
  // can point it at a cheaper model. Unset keeps it on the main chat model.
  const extractionModel = config.extractionModel ?? config.llmModel;
  switch (config.llmProvider) {
    case "openai":
      return new OpenAIFactExtractor(
        config.openaiApiKey!,
        extractionModel,
        config.openaiBaseUrl,
        config.openaiResponseFormat,
        config.openaiMaxTokens,
        config.reasoningEffort
      );
    case "ollama":
      return new OpenAIFactExtractor(
        "ollama",
        extractionModel,
        config.ollamaBaseUrl ?? "http://localhost:11434/v1",
        config.openaiResponseFormat,
        config.openaiMaxTokens,
        config.reasoningEffort
      );
    case "anthropic":
      return new FactExtractor(config.anthropicApiKey!, extractionModel);
  }
}
