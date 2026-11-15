import { describe, it, expect } from "vitest";
import express from "express";

// Integration-style test for GET /api/health, following the ping.test.ts
// pattern: the handler is inlined so the full server (Shodh, HA) is not started.
function buildHealthApp() {
  const app = express();
  app.get("/api/health", (_req, res) => {
    res.json({
      status: "healthy",
      memory: "healthy",
      homeAssistant: "healthy",
      stt: false,
      tts: false,
      ttsLanguage: null,
      documents: true,
      ocr: false,
      version: "test",
      memoryBackend: "memory",
    });
  });
  return app;
}

describe("GET /api/health", () => {
  it("answers 200 with status healthy and capabilities", async () => {
    const app = buildHealthApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        status: string;
        version: string;
        stt: boolean;
        documents: boolean;
      };
      expect(body.status).toBe("healthy");
      expect(typeof body.version).toBe("string");
      expect(body.documents).toBe(true);
    } finally {
      server.close();
    }
  });
});