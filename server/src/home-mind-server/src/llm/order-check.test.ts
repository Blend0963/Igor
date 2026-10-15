import { describe, it, expect, vi } from "vitest";
import type OpenAI from "openai";
import { askIsOrder } from "./order-check.js";

const clientReplying = (content: string) => {
  const create = vi.fn().mockResolvedValue({ choices: [{ message: { content } }], usage: { prompt_tokens: 120, completion_tokens: 1 } });
  return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
};

describe("askIsOrder", () => {
  it("reads yes and no", async () => {
    expect((await askIsOrder(clientReplying("Yes.").client, "m", "plonge la maison dans le noir", undefined)).order).toBe(true);
    expect((await askIsOrder(clientReplying("no").client, "m", "bonsoir", undefined)).order).toBe(false);
    expect((await askIsOrder(clientReplying("maybe").client, "m", "hmm", undefined)).order).toBe(false);
  });

  it("sends the message and the previous reply, without tools, to the given model", async () => {
    const { client, create } = clientReplying("yes");
    await askIsOrder(client, "mistral-small-latest", "fais-le", "Veux-tu que j'éteigne le salon ?");
    const sent = create.mock.calls[0][0];
    expect(sent.model).toBe("mistral-small-latest");
    expect(sent.tools).toBeUndefined();
    expect(sent.messages[1].content).toContain("Veux-tu que j'éteigne le salon ?");
    expect(sent.messages[1].content).toContain("Message: fais-le");
  });
});
