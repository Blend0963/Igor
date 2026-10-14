import type { Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";

/**
 * Creates a bearer token auth middleware.
 * When token is undefined, all requests pass through (backward compat with HA integration).
 * When token is set, requests must include "Authorization: Bearer <token>",
 * or arrive through Home Assistant ingress (see below).
 * Health endpoint is always public.
 *
 * Ingress: the thread panel is served through Home Assistant ingress, which
 * already authenticates the user with the Home Assistant login. The Supervisor
 * proxy drops the user headers from the browser request and re-adds them itself
 * (supervisor/const.py), so a request carrying X-Remote-User-Id is one that
 * Home Assistant authenticated. This trust is only sound while the raw port is
 * not reachable directly, and the add-on leaves port 3100 unexposed by default.
 */
const INGRESS_USER_HEADER = "x-remote-user-id";

export function createAuthMiddleware(
  token: string | undefined
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction) => {
    // No token configured = no auth enforced
    if (!token) {
      return next();
    }

    // Health endpoint is always public
    if (req.path === "/health") {
      return next();
    }

    // Behind Home Assistant ingress, the HA login is the authentication:
    // the Supervisor stamps the user header the browser cannot set itself.
    if (req.headers[INGRESS_USER_HEADER] !== undefined) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing or invalid Authorization header" });
    }

    const provided = authHeader.slice(7);
    const providedBuf = Buffer.from(provided);
    const tokenBuf = Buffer.from(token);

    if (providedBuf.length !== tokenBuf.length || !timingSafeEqual(providedBuf, tokenBuf)) {
      return res.status(403).json({ error: "Invalid API token" });
    }

    next();
  };
}
