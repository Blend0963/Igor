import { describe, it, expect, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import { createRouter } from "./routes.js";
import type { IChatEngine, ChatRequest, ChatStreamEvents } from "../llm/interface.js";
import type { IMemoryStore } from "../memory/interface.js";
import { InMemoryConversationStore } from "../memory/conversation-memory.js";
import { WorkspaceStore } from "../memory/workspace-store.js";
import { readZip } from "../files/zip.js";

async function withServer(router: express.Router, fn: (base: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise<ReturnType<typeof app.listen>>((r) => { const s = app.listen(0, () => r(s)); });
  try {
    await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api`);
  } finally {
    server.close();
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const body = async (res: Response | Promise<Response>): Promise<any> => (await res).json();
const json = (body: unknown) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

describe("workspace routes", () => {
  const setup = (chat?: IChatEngine["chat"]) => {
    const conversations = new InMemoryConversationStore();
    const workspace = new WorkspaceStore();
    const llm = {
      chat: vi.fn(
        chat ??
          (async (req: ChatRequest) => {
            conversations.storeMessage(req.conversationId!, req.userId, "user", req.message);
            conversations.storeMessage(req.conversationId!, req.userId, "assistant", "ok");
            return { response: "ok", toolsUsed: [], factsLearned: 0, usage: { model: "mistral-large-latest", calls: 1, promptTokens: 1000, cachedTokens: 0, completionTokens: 10 } };
          })
      ),
    } as unknown as IChatEngine;
    const router = createRouter(llm, {} as IMemoryStore, "shodh", "0", undefined, conversations, undefined, undefined, undefined, undefined, {}, { workspace });
    return { conversations, workspace, llm, router };
  };

  it("adds a project's instructions to its threads, and counts the cost", async () => {
    const { workspace, llm, router } = setup();
    await withServer(router, async (base) => {
      const project = await body(fetch(`${base}/projects/default`, json({ name: "Jardin", instructions: "Parle comme un jardinier." })));
      await fetch(`${base}/conversations/default/mado-thread%3Aa/project`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: project.id }) });
      await fetch(`${base}/chat`, json({ message: "salut", conversationId: "mado-thread:a" }));
      expect(vi.mocked(llm.chat).mock.calls[0][0].customPrompt).toContain('Project "Jardin"\nParle comme un jardinier.');
      const list = await body(fetch(`${base}/conversations/default`));
      expect(list[0].projectId).toBe(project.id);
      const usage = await body(fetch(`${base}/usage/default`));
      expect(usage.byConversation[0]).toMatchObject({ conversationId: "mado-thread:a", calls: 1 });
      expect(usage.total).toBeGreaterThan(0);
    });
    expect(workspace.listProjects("default")).toHaveLength(1);
  });

  it("searches threads, truncates for regenerate, and exports", async () => {
    const { conversations, router } = setup();
    const first = conversations.storeMessage("mado-thread:b", "default", "user", "Comment rempoter un ficus ?");
    conversations.storeMessage("mado-thread:b", "default", "assistant", "Avec un pot plus grand.");
    conversations.storeMessage("mado-user:default", "default", "user", "ficus du salon");
    await withServer(router, async (base) => {
      const hits = await body(fetch(`${base}/search/default?q=ficus`));
      expect(hits).toHaveLength(1);
      expect(hits[0]).toMatchObject({ conversationId: "mado-thread:b", role: "user" });
      expect(hits[0].snippet).toContain("ficus");

      const docx = await fetch(`${base}/conversations/default/mado-thread%3Ab/export?format=docx`);
      expect(docx.headers.get("content-type")).toContain("wordprocessingml");
      expect(readZip(Buffer.from(await docx.arrayBuffer())).some((e) => e.name === "word/document.xml")).toBe(true);
      const md = await (await fetch(`${base}/conversations/default/mado-thread%3Ab/export?format=md`)).text();
      expect(md).toContain("## MaDo");

      expect((await fetch(`${base}/conversations/default/mado-thread%3Ab/truncate`, json({ messageId: first }))).status).toBe(200);
      expect(conversations.getConversationHistory("mado-thread:b", 10)).toHaveLength(0);
      expect((await fetch(`${base}/conversations/default/mado-thread%3Ab/truncate`, json({ messageId: "nope" }))).status).toBe(404);
    });
  });

  it("stops a reply in progress", async () => {
    let seen: AbortSignal | undefined;
    const { router } = setup(async (req: ChatRequest, events?: unknown) => {
      seen = req.signal;
      (events as ChatStreamEvents)?.onChunk?.("début");
      await new Promise<void>((resolve) => req.signal?.addEventListener("abort", () => resolve()));
      return { response: "début\n\n*[Réponse interrompue]*", toolsUsed: [], factsLearned: 0, interrupted: true };
    });
    await withServer(router, async (base) => {
      const pending = fetch(`${base}/chat`, json({ message: "x", conversationId: "mado-thread:c" }));
      await vi.waitFor(async () => expect(await body(fetch(`${base}/running/default`))).toHaveLength(1));
      expect(await body(fetch(`${base}/running/default/mado-thread%3Ac/stop`, { method: "POST" }))).toEqual({ stopped: true });
      const res = await body(pending);
      expect(res.interrupted).toBe(true);
      expect(seen?.aborted).toBe(true);
    });
  });
});
