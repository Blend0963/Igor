import { describe, it, expect } from "vitest";
import express from "express";

// The handler is inlined here on purpose: importing index.ts would start the
// whole server (Shodh connection, HA scan...). The route under test is the
// exact same 4-line handler mounted in index.ts.
function buildPingApp() {
  const app = express();
  app.get("/api/ping", (_req, res) => {
    res.json({ status: "ok", version: "test", uptime: process.uptime(), timestamp: Date.now() });
  });
  return app;
}

describe("GET /api/ping", () => {
  it("answers ok with a numeric timestamp", async () => {
    const app = buildPingApp();
    const server = app.listen(0);
    try {
      const port = (server.address() as { port: number }).port;
      const res = await fetch(`http://127.0.0.1:${port}/api/ping`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; timestamp: number; uptime: number };
      expect(body.status).toBe("ok");
      expect(typeof body.timestamp).toBe("number");
      expect(typeof body.uptime).toBe("number");
    } finally {
      server.close();
    }
  });
});