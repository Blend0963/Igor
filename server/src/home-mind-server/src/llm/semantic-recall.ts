import type { Config } from "../config.js";
import type { ConversationMessage, IConversationStore } from "../memory/types.js";

const EMBEDDING_MODEL = "mistral-embed";
const EMBEDDING_URL = "https://api.mistral.ai/v1/embeddings";

async function embedText(apiKey: string, text: string): Promise<number[]> {
  const response = await fetch(EMBEDDING_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: text.slice(0, 8000) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Mistral embeddings returned HTTP ${response.status}`);
  const payload = await response.json() as { data?: Array<{ embedding?: number[] }> };
  const vector = payload.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) throw new Error("Mistral embeddings response had no vector");
  return vector;
}

/** Store semantic vectors and retrieve only by cosine similarity; never falls back to keyword matching. */
export async function rememberSemantically(
  config: Config, store: IConversationStore, messageId: string, content: string
): Promise<void> {
  if (!config.mistralApiKey || !store.storeMessageEmbedding) return;
  if (!content.trim()) return;
  try {
    const vector = await embedText(config.mistralApiKey, content);
    await store.storeMessageEmbedding(messageId, vector);
  } catch (error) {
    console.warn("[semantic-recall] Could not embed message; keyword fallback is disabled:", error instanceof Error ? error.message : error);
  }
}

export async function recallSemantically(
  config: Config, store: IConversationStore, userId: string, query: string, limit = 6
): Promise<ConversationMessage[]> {
  if (!config.mistralApiKey || !store.searchSimilarMessages || !query.trim()) return [];
  try {
    const vector = await embedText(config.mistralApiKey, query);
    return await store.searchSimilarMessages(userId, vector, limit);
  } catch (error) {
    console.warn("[semantic-recall] Semantic search unavailable; no keyword fallback used:", error instanceof Error ? error.message : error);
    return [];
  }
}
