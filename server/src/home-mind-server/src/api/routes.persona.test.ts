import { describe, it, expect } from "vitest";
import { composePersona, describePersonaSource, resolveChatStyle } from "./routes.js";

describe("describePersonaSource", () => {
  // nives#54: a user set the add-on's Custom Prompt correctly and nothing
  // happened, because the integration was also sending one and silently won.
  // Since 2.4.23 the integration's duplicate persona field is gone; requests
  // carrying a customPrompt now come from the AI Task entity or API clients,
  // and the add-on's Configuration tab is the one user-facing field.
  const HAL = "You are HAL 9000, the calm and precise computer from 2001: A Space Odyssey.";

  it("names the built-in default when nothing is set", () => {
    expect(describePersonaSource(undefined, undefined)).toMatch(/built-in default/i);
  });

  it("names the add-on config when only that is set", () => {
    const line = describePersonaSource(undefined, HAL);
    expect(line).toMatch(/add-on configuration/i);
    expect(line).toContain("You are HAL 9000");
  });

  it("names the request when only that carries a prompt", () => {
    const line = describePersonaSource(HAL, undefined);
    expect(line).toMatch(/sent with the request/i);
  });

  it("WARNS that the add-on's prompt is overridden when both are set", () => {
    const line = describePersonaSource("You are Ava.", HAL);
    expect(line).toMatch(/sent with the request/i);
    expect(line).toMatch(/overridden/i);
    expect(line).toContain("You are Ava.");
    // The losing value must not be shown as if it were in effect.
    expect(line).not.toContain("HAL 9000");
  });

  it("treats whitespace-only as unset", () => {
    expect(describePersonaSource("   ", undefined)).toMatch(/built-in default/i);
    expect(describePersonaSource("   ", HAL)).toMatch(/add-on configuration/i);
  });

  it("truncates a long prompt instead of dumping it", () => {
    const long = "You are a very thorough assistant. ".repeat(20);
    const line = describePersonaSource(long, undefined);
    expect(line.length).toBeLessThan(160);
    expect(line).toContain("…");
  });
});

describe("resolveChatStyle", () => {
  const COMMON = "Tu es Igor.";
  const personas = { voice: "Style vocal.", thread: "Style écrit." };

  it("runs a chat-panel thread in thread mode with the common + thread persona", () => {
    const style = resolveChatStyle(
      { isVoice: true, conversationId: "mado-thread:t1" },
      COMMON,
      { ...personas, assistMode: "voice" }
    );
    expect(style).toEqual({ isVoice: false, mode: "thread", customPrompt: "Tu es Igor.\n\nStyle écrit." });
  });

  it("trusts the integration in auto mode", () => {
    expect(resolveChatStyle({ isVoice: true }, COMMON, personas)).toMatchObject({
      mode: "voice",
      customPrompt: "Tu es Igor.\n\nStyle vocal.",
    });
    expect(resolveChatStyle({ isVoice: false }, COMMON, personas)).toMatchObject({
      mode: "text",
      customPrompt: "Tu es Igor.",
    });
  });

  it("forces every Assist request to voice or text when configured", () => {
    expect(resolveChatStyle({ isVoice: false }, COMMON, { ...personas, assistMode: "voice" })).toMatchObject({
      isVoice: true,
      mode: "voice",
    });
    expect(resolveChatStyle({ isVoice: true }, COMMON, { ...personas, assistMode: "text" })).toMatchObject({
      isVoice: false,
      mode: "text",
    });
  });

  it("lets a prompt sent with the request replace the configured ones", () => {
    expect(
      resolveChatStyle({ isVoice: false, customPrompt: "Task mode." }, COMMON, personas).customPrompt
    ).toBe("Task mode.");
  });

  it("works with only a per-mode persona, or none at all", () => {
    expect(composePersona(undefined, "Style vocal.")).toBe("Style vocal.");
    expect(composePersona("  ", "")).toBeUndefined();
    expect(resolveChatStyle({ isVoice: false }).customPrompt).toBeUndefined();
  });
});
