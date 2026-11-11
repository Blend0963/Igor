import fs from "node:fs";
import type { Request } from "express";
import { isIngressRequest } from "./auth.js";

/**
 * The house's key, on the panel's side.
 *
 * The integration refuses every Assist request while the key is away
 * (security.py), but the thread panel talks to this server directly, through
 * Home Assistant ingress, and never passes there. The integration therefore
 * sends the key entity and the users still answered while locked
 * (`allowed_users`) to `POST /api/security`; this server keeps them (a file
 * next to the database) and checks the key itself before a panel request.
 *
 * Only ingress requests are checked: they are the panel, and Home Assistant
 * says who is logged in (X-Remote-User-Id / -Name / -Display-Name). Requests
 * with the API token are the integration, which checked already, or the
 * owner's installed app, which holds the token.
 *
 * Locked unless the key entity reads « on », as in security.py; a key that
 * cannot be read locks too.
 *
 * The threads are locked only when the owner asks for it (`lock_threads`,
 * off unless set): the key locks the house's voice and screens, and the
 * thread panel is already behind a Home Assistant login.
 */
export const LOCKED_MESSAGE = "Igor est verrouillé : la clé est absente.";

export interface LockSettings {
  keyEntity?: string;
  allowedUsers: string[];
  /** The thread panel locks with the key too. Off unless set. */
  lockThreads?: boolean;
}

const USER_HEADERS = ["x-remote-user-id", "x-remote-user-name", "x-remote-user-display-name"] as const;

export class HouseLock {
  private current: LockSettings = { allowedUsers: [] };

  constructor(
    private readonly file: string | undefined,
    private readonly readKey: (entityId: string) => Promise<string | undefined>
  ) {
    if (!file) return;
    try {
      this.current = HouseLock.clean(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      /* first start, or nothing configured yet */
    }
  }

  static clean(raw: unknown): LockSettings {
    const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const key = typeof o.keyEntity === "string" ? o.keyEntity : typeof o.key_entity === "string" ? o.key_entity : "";
    const users = Array.isArray(o.allowedUsers) ? o.allowedUsers : Array.isArray(o.allowed_users) ? o.allowed_users : [];
    return {
      keyEntity: /^[a-z_]+\.[a-z0-9_]+$/.test(key) ? key : undefined,
      allowedUsers: users.map((u) => String(u).trim()).filter((u) => u && u.length <= 100).slice(0, 50),
      ...(o.lockThreads === true || o.lock_threads === true ? { lockThreads: true } : {}),
    };
  }

  settings(): LockSettings {
    return { ...this.current, allowedUsers: [...this.current.allowedUsers] };
  }

  set(raw: unknown): LockSettings {
    this.current = HouseLock.clean(raw);
    if (this.file) {
      try {
        fs.writeFileSync(this.file, JSON.stringify(this.current), { mode: 0o600 });
      } catch (error) {
        console.warn(`[lock] Could not keep the key settings: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.settings();
  }

  /** Is the person behind this panel request one still answered while locked? */
  allowed(req: Request): boolean {
    const wanted = new Set(this.current.allowedUsers.map((u) => u.toLowerCase()));
    if (!wanted.size) return false;
    return USER_HEADERS.some((h) => {
      const v = req.headers[h];
      return typeof v === "string" && v.trim() !== "" && wanted.has(v.trim().toLowerCase());
    });
  }

  /** null when the request may go on, else the message to answer. */
  async refusal(req: Request, ingressProxies?: readonly string[]): Promise<string | null> {
    if (!isIngressRequest(req, ingressProxies)) return null;
    const key = this.current.keyEntity;
    if (!key || !this.current.lockThreads) return null;
    let state: string | undefined;
    try {
      state = await this.readKey(key);
    } catch {
      state = undefined;
    }
    if (state === "on") return null;
    return this.allowed(req) ? null : LOCKED_MESSAGE;
  }
}
