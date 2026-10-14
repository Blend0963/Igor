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
 * Home Assistant authenticated — but only when it actually comes from that
 * proxy. Port 3100 is unexposed on the host, yet every other add-on on the
 * hassio network can still reach it and set the header itself, so the header
 * is honoured only from the Supervisor's ingress address (172.30.32.2, the one
 * address the add-on docs say ingress traffic comes from).
 */
const INGRESS_USER_HEADER = "x-remote-user-id";
export const INGRESS_PROXY_ADDRESSES = ["172.30.32.2"] as const;

/** The peer address with any IPv4-mapped IPv6 prefix ("::ffff:") removed. */
function peerAddress(req: Request): string | undefined {
  const address = req.socket?.remoteAddress;
  return address?.startsWith("::ffff:") ? address.slice(7) : address;
}

/** True when Home Assistant ingress authenticated this request. */
export function isIngressRequest(
  req: Request,
  ingressProxies: readonly string[] = INGRESS_PROXY_ADDRESSES
): boolean {
  const peer = peerAddress(req);
  return req.headers[INGRESS_USER_HEADER] !== undefined && peer !== undefined && ingressProxies.includes(peer);
}

export function createAuthMiddleware(
  token: string | undefined,
  ingressProxies: readonly string[] = INGRESS_PROXY_ADDRESSES
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
    // Anyone else on the network can set it too, hence the address check.
    if (isIngressRequest(req, ingressProxies)) {
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
