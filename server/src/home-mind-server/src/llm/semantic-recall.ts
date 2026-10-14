import type { Config } from "../config.js";
import type { ConversationMessage, IConversationStore } from "../memory/types.js";
import type { RecallScope } from "../memory/memory-scope.js";

const EMBEDDING_MODEL = "mistral-embed";
const EMBEDDING_URL = "https://api.mistral.ai/v1/embeddings";

async function embedTexts(apiKey: string, texts: string[]): Promise<number[][]> {
  const response = await fetch(EMBEDDING_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map(text => text.slice(0, 8000)) }),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`Mistral embeddings returned HTTP ${response.status}`);
  const payload = await response.json() as { data?: Array<{ embedding?: number[]; index?: number }> };
  const data = payload.data;
  if (!Array.isArray(data) || data.length !== texts.length || data.some(item => !Array.isArray(item.embedding) || item.embedding.length === 0)) {
    throw new Error("Mistral embeddings response did not contain all requested vectors");
  }
  return [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(item => item.embedding as number[]);
}

/** Store semantic vectors and retrieve only by cosine similarity; never falls back to keyword matching. */
export async function rememberSemantically(
  config: Config, store: IConversationStore, messageId: string, content: string
): Promise<void> {
  if (!config.mistralApiKey || !store.storeMessageEmbedding) return;
  if (!content.trim()) return;
  try {
    const [vector] = await embedTexts(config.mistralApiKey, [content]);
    await store.storeMessageEmbedding(messageId, vector);
  } catch (error) {
    console.warn("[semantic-recall] Could not embed message; keyword fallback is disabled:", error instanceof Error ? error.message : error);
  }
}

export async function recallSemantically(
  config: Config, store: IConversationStore, userId: string, query: string, limit = 6,
  scope?: RecallScope
): Promise<ConversationMessage[]> {
  if (!config.mistralApiKey || !store.searchSimilarMessages || !query.trim()) return [];
  try {
    const missing = store.getMessagesWithoutEmbeddings
      ? await store.getMessagesWithoutEmbeddings(userId, 30, scope)
      : [];
    const texts = [...missing.map(message => message.content), query];
    const vectors = await embedTexts(config.mistralApiKey, texts);
    for (let index = 0; index < missing.length; index++) {
      await store.storeMessageEmbedding?.(missing[index].id, vectors[index]);
    }
    return await store.searchSimilarMessages(userId, vectors[vectors.length - 1], limit, scope);
  } catch (error) {
    console.warn("[semantic-recall] Semantic search unavailable; no keyword fallback used:", error instanceof Error ? error.message : error);
    return [];
  }
}
