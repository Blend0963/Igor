import { describe, it, expect, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createAuthMiddleware, isIngressRequest } from "./auth.js";

/**
 * The add-on has required a token since 2.4.0, so this middleware is the only
 * thing between the container network and full control of the user's home
 * (/api/chat drives Home Assistant; DELETE /api/memory/:userId erases everything
 * it has learned). It was previously untested because nothing set API_TOKEN.
 */

function mockReq(overrides: Partial<Request> = {}): Request {
  return { path: "/chat", headers: {}, ...overrides } as Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

const TOKEN = "a".repeat(64);

describe("createAuthMiddleware", () => {
  describe("when no token is configured", () => {
    it("lets every request through", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      createAuthMiddleware(undefined)(mockReq(), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0);
    });

    it("lets an empty-string token behave as unset", () => {
      const next = vi.fn() as unknown as NextFunction;
      createAuthMiddleware("")(mockReq(), mockRes(), next);
      expect(next).toHaveBeenCalledOnce();
    });
  });

  describe("when a token is configured", () => {
    const mw = createAuthMiddleware(TOKEN);

    it("allows /health without any credentials", () => {
      // The config flow probes /health before it has a token, and HA's own
      // health checks must not need one either.
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ path: "/health" }), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0);
    });

    it("rejects a request with no Authorization header (401)", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq(), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it("rejects a non-Bearer scheme (401)", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ headers: { authorization: `Basic ${TOKEN}` } }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });

    it("rejects a wrong token of the same length (403)", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ headers: { authorization: `Bearer ${"b".repeat(64)}` } }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it("rejects a wrong token of a different length without throwing (403)", () => {
      // timingSafeEqual throws on length mismatch, so the length guard has to
      // come first or this is a 500 — and a crash loop instead of a rejection.
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      expect(() =>
        mw(mockReq({ headers: { authorization: "Bearer short" } }), res, next)
      ).not.toThrow();
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it("rejects a token that is a prefix of the real one (403)", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ headers: { authorization: `Bearer ${TOKEN.slice(0, 32)}` } }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
    });

    it("accepts the correct token", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ headers: { authorization: `Bearer ${TOKEN}` } }), res, next);
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0);
    });

    it("accepts a request proxied through Home Assistant ingress", () => {
      // The thread panel rides the HA login: the Supervisor ingress proxy
      // drops the browser's own user headers and re-adds X-Remote-User-Id
      // itself, so its presence is Home Assistant vouching for the caller.
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(
        mockReq({
          headers: { "x-remote-user-id": "user-1" },
          socket: { remoteAddress: "172.30.32.2" } as Request["socket"],
        }),
        res,
        next
      );
      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBe(0);
    });

    it("accepts the ingress proxy over an IPv4-mapped IPv6 socket", () => {
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(
        mockReq({
          headers: { "x-remote-user-id": "user-1" },
          socket: { remoteAddress: "::ffff:172.30.32.2" } as Request["socket"],
        }),
        res,
        next
      );
      expect(next).toHaveBeenCalledOnce();
    });

    it("ignores an ingress header that does not come from the Supervisor (401)", () => {
      // Every other add-on on the hassio network can reach port 3100 and set
      // the header itself; from them it must count for nothing.
      for (const remoteAddress of ["172.30.33.5", "127.0.0.1", undefined]) {
        const next = vi.fn() as unknown as NextFunction;
        const res = mockRes();
        mw(
          mockReq({
            headers: { "x-remote-user-id": "user-1" },
            socket: { remoteAddress } as Request["socket"],
          }),
          res,
          next
        );
        expect(next, String(remoteAddress)).not.toHaveBeenCalled();
        expect(res.statusCode, String(remoteAddress)).toBe(401);
      }
    });

    it("still rejects a plain request with no ingress header (401)", () => {
      // Ingress trust is additive: the bearer-token rules below it still
      // apply to direct callers.
      const next = vi.fn() as unknown as NextFunction;
      const res = mockRes();
      mw(mockReq({ headers: {} }), res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);
    });
    it("guards every non-health route, not just chat", () => {
      for (const path of [
        "/chat",
        "/chat/stream",
        "/memory/default",
        "/conversations/default",
        "/admin/conversations",
        "/stt",
        "/tts",
      ]) {
        const next = vi.fn() as unknown as NextFunction;
        const res = mockRes();
        mw(mockReq({ path }), res, next);
        expect(next, `${path} must require auth`).not.toHaveBeenCalled();
        expect(res.statusCode, `${path} must require auth`).toBe(401);
      }
    });
  });
});

describe("isIngressRequest", () => {
  // GET /api/app-token hands the API token to the panel inside Home
  // Assistant, for the installed app; nothing else may read it.
  const fromPeer = (address: string, headers: Record<string, string> = { "x-remote-user-id": "u1" }) =>
    mockReq({ headers, socket: { remoteAddress: address } } as unknown as Partial<Request>);

  it("accepts the user header from the Supervisor ingress proxy", () => {
    expect(isIngressRequest(fromPeer("172.30.32.2"))).toBe(true);
    expect(isIngressRequest(fromPeer("::ffff:172.30.32.2"))).toBe(true);
  });

  it("refuses the header from any other address, and the proxy without it", () => {
    expect(isIngressRequest(fromPeer("172.30.33.5"))).toBe(false);
    expect(isIngressRequest(fromPeer("172.30.32.2", {}))).toBe(false);
  });
});

describe("createAuthMiddleware (0.9.3)", () => {
  const req = (address: string, auth?: string) =>
    mockReq({ headers: auth ? { authorization: auth } : {}, socket: { remoteAddress: address } } as unknown as Partial<Request>);

  it("lets Home Assistant Core alone through without a token during the handoff", () => {
    const mw = createAuthMiddleware(TOKEN, { gracePeers: ["172.30.32.1"] });
    const next = vi.fn();
    mw(req("172.30.32.1"), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    const res = mockRes();
    mw(req("172.30.33.7"), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).toHaveBeenCalledTimes(1);
    // Right after a rotation Core still sends the previous token.
    mw(req("172.30.32.1", "Bearer old-token"), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("requires the token from Core too once the handoff is done", () => {
    const res = mockRes();
    createAuthMiddleware(TOKEN, {})(req("172.30.32.1"), res, vi.fn());
    expect(res.statusCode).toBe(401);
  });

  it("shuts out an address that keeps failing, even with the right token afterwards", () => {
    const mw = createAuthMiddleware(TOKEN, { maxFailures: 3 });
    for (let i = 0; i < 3; i++) mw(req("10.0.0.9", "Bearer wrong"), mockRes(), vi.fn());
    const res = mockRes();
    const next = vi.fn();
    mw(req("10.0.0.9", `Bearer ${TOKEN}`), res, next);
    expect(res.statusCode).toBe(429);
    expect(next).not.toHaveBeenCalled();
    const other = vi.fn();
    mw(req("10.0.0.10", `Bearer ${TOKEN}`), mockRes(), other);
    expect(other).toHaveBeenCalled();
  });
});
