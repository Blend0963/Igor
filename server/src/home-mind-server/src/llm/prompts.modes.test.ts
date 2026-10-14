import { describe, it, expect } from "vitest";
import { buildSystemPrompt, buildSystemPromptText } from "./prompts.js";

const PERSONA = "Tu es Mado, le majordome de la maison.";

describe("prompt modes", () => {
  const voice = buildSystemPromptText([], "voice");
  const text = buildSystemPromptText([], "text");
  const thread = buildSystemPromptText([], "thread");

  it("keeps the boolean signature: true is voice, false is text", () => {
    // Everything but the timestamps, which move between two calls.
    const stable = (p: string) => p.split("## Current Context:")[0];
    expect(stable(buildSystemPromptText([], true))).toBe(stable(voice));
    expect(stable(buildSystemPromptText([], false))).toBe(stable(text));
  });

  it("gives a thread the chat-app scope and a Markdown style", () => {
    expect(thread).toContain("THIS CONVERSATION: A CHAT THREAD");
    expect(thread).toMatch(/not your only purpose/);
    expect(thread).toContain("Response Style (chat panel)");
    expect(thread).toContain("```yaml");
    expect(thread).toMatch(/copy button/);
  });

  it("keeps the home tools and confirm-first flows in a thread", () => {
    for (const section of [
      "WHEN TO USE TOOLS vs ANSWER DIRECTLY",
      "FORGETTING MEMORIES (CONFIRM FIRST)",
      "SCHEDULED / RECURRING ACTIONS",
      "MEMORY IS NOT THE PRESENT",
      "## Language:",
    ]) {
      expect(thread, section).toContain(section);
    }
  });

  it("drops the plain-text and speech-to-text rules from a thread", () => {
    expect(thread).not.toContain("PLAIN TEXT ONLY");
    expect(thread).not.toContain("Speech-to-Text) Awareness");
    expect(text).toContain("PLAIN TEXT ONLY");
  });

  it("names its own default identity per mode", () => {
    expect(thread).toMatch(/^You are MaDo, a capable general-purpose assistant/);
    expect(voice).toMatch(/^You are MaDo, a helpful smart home voice assistant/);
  });

  it("never asks the voice to read URLs aloud", () => {
    expect(voice).not.toContain("include direct source URLs");
    expect(voice).toMatch(/NEVER read out a URL/);
  });

  it("carries no Slovenian examples into any mode", () => {
    for (const prompt of [voice, text, thread]) {
      expect(prompt).not.toMatch(/Slovenian|spalnica|Prižg|kuhinji/);
    }
  });

  it("states the owner's persona wins on style only when there is one", () => {
    for (const mode of ["voice", "text", "thread"] as const) {
      const withPersona = buildSystemPromptText([], mode, PERSONA);
      expect(withPersona.startsWith(PERSONA)).toBe(true);
      expect(withPersona).toContain("PERSONA PRECEDENCE");
      expect(withPersona).toMatch(/cannot switch off: the confirm-first flows/);
      expect(buildSystemPromptText([], mode)).not.toContain("PERSONA PRECEDENCE");
    }
  });

  it("builds the same instructions for the Anthropic variant", () => {
    const blocks = buildSystemPrompt([], "thread", PERSONA) as Array<{ text: string }>;
    expect(blocks[0].text).toContain("THIS CONVERSATION: A CHAT THREAD");
    expect(blocks[0].text).toContain("PERSONA PRECEDENCE");
  });
});
