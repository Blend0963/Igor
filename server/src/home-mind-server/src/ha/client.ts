import type { Config } from "../config.js";
import { wsCommand } from "./websocket.js";
import { AssistExposure, notExposedMessage } from "./exposure.js";

export interface EntityState {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

/**
 * One recorder row. Everything but `state` and `last_changed` is optional
 * because we ask for `minimal_response`, under which HA returns those two alone
 * for every entry other than the first and last.
 */
export interface HistoryEntry {
  entity_id?: string;
  state: string;
  attributes?: Record<string, unknown>;
  last_changed: string;
  last_updated?: string;
}

export interface AutomationTrace {
  domain?: string;
  item_id: string;
  run_id?: string;
  state?: string;
  script_execution?: string | null;
  error?: string;
  last_step?: string | null;
  timestamp?: { start?: string; finish?: string | null };
  trigger?: string | null;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

/** Input for creating an automation. trigger/condition/action may be a single object or an array. */
export interface AutomationConfig {
  alias: string;
  trigger: unknown;
  condition?: unknown;
  action: unknown;
  mode?: string;
  description?: string;
}

/** Result of a successful automation creation. */
export interface CreatedAutomation {
  id: string;
  alias: string;
  entity_id: string;
}

/**
 * What HA's services catalog says about a service's response. HA rejects a
 * call with `?return_response` on a service that has none ("none"), and
 * rejects a call WITHOUT it on a service that must return one ("only").
 */
export type ServiceResponseSupport = "none" | "optional" | "only";

/** Shape HA returns when a response was requested (`?return_response`). */
export interface ServiceCallWithResponse {
  changed_states: EntityState[];
  service_response: unknown;
}

/** The entity IDs a service call targets; HA accepts one, a list, or "a, b". */
function targetedEntities(target: unknown): string[] {
  const ids = typeof target === "string" ? [target] : Array.isArray(target) ? target : [];
  return ids
    .filter((t): t is string => typeof t === "string")
    .flatMap((t) => t.split(","))
    .map((t) => t.trim())
    .filter((t) => t !== "");
}

/** Targets that select entities indirectly, which the exposure list cannot vet. */
const INDIRECT_TARGETS = ["area_id", "device_id", "floor_id", "label_id"] as const;

/** Lifecycle services of the script domain; any other `script.X` runs script X. */
const SCRIPT_LIFECYCLE = new Set(["turn_on", "turn_off", "toggle", "reload"]);

/**
 * Shape checks for every model-supplied value that ends up in an HA URL path.
 *
 * The base URL is `http://supervisor/core` in the add-on, and fetch() resolves
 * `..` segments, so an unchecked `entity_id` of `../../addons` or a `domain` of
 * `../../backups/new/full` sends the add-on's Supervisor token to the
 * Supervisor API instead of to Home Assistant. Home Assistant's own ids never
 * contain anything outside these alphabets.
 */
const ENTITY_ID_PATTERN = /^[a-z0-9_]+\.[a-z0-9_]+$/;
const SERVICE_PART_PATTERN = /^[a-z0-9_]+$/;
const AUTOMATION_CONFIG_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

function requireEntityIdShape(entityId: unknown): asserts entityId is string {
  if (typeof entityId !== "string" || !ENTITY_ID_PATTERN.test(entityId)) {
    throw new Error(
      `"${String(entityId)}" is not a valid entity_id. Use the exact id (domain.object_id, lower case) ` +
        `from search_entities or get_entities.`
    );
  }
}

/**
 * Services the assistant may never run, directly or from an automation it
 * writes. The `hassio` domain drives the Supervisor itself (stop, uninstall or
 * write to the stdin of other add-ons, restore backups, reboot or shut down
 * the host), and `homeassistant.stop` leaves the house without Home Assistant
 * until someone restarts it by hand. Nothing a voice assistant is asked for
 * needs these, and the model also reads untrusted text (web results, entity
 * names), which must never be able to talk it into them.
 */
const BLOCKED_SERVICE_DOMAINS = new Set(["hassio"]);
const BLOCKED_SERVICES = new Set(["homeassistant.stop"]);

export function isBlockedService(domain: string, service: string): boolean {
  return BLOCKED_SERVICE_DOMAINS.has(domain) || BLOCKED_SERVICES.has(`${domain}.${service}`);
}

function blockedServiceMessage(id: string): string {
  return `The service "${id}" is not available to you: it controls the Home Assistant host or its add-ons. Do not retry it under another name.`;
}

/**
 * The config-API path of one automation. The id is read back from HA's own
 * state attributes, but an automation written by hand or by another tool can
 * carry anything there, so it is checked rather than trusted.
 */
function automationConfigPath(id: string): string {
  if (typeof id !== "string" || !AUTOMATION_CONFIG_ID_PATTERN.test(id)) {
    throw new Error(`"${String(id)}" is not a valid automation config id.`);
  }
  return `/api/config/automation/config/${id}`;
}

let lastAutomationId = 0;

/**
 * Config id for a new automation: a millisecond timestamp, like the ids HA's
 * own editor writes, but never repeated within this process. The model's tool
 * calls run in parallel, so two creates from one step can land in the same
 * millisecond; with a bare Date.now() they got the same id, HA kept only the
 * second write, and both calls still reported success.
 */
function nextAutomationId(): string {
  lastAutomationId = Math.max(Date.now(), lastAutomationId + 1);
  return lastAutomationId.toString();
}

/**
 * Lower-case and strip combining diacritics, so "Garaža" and "garaza" compare
 * equal. Letters that do not decompose (ł, ø, ß) are left as they are.
 * NFD splits an accented letter into base + combining mark; the range
 * U+0300-U+036F is exactly those marks.
 */
export function foldAccents(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export class HomeAssistantClient {
  private baseUrl: string;
  private token: string;
  private skipTlsVerify: boolean;

  // Cache settings
  private cacheTTL: number = 10000; // 10 seconds default
  private allStatesCache: CacheEntry<EntityState[]> | null = null;
  private entityCache: Map<string, CacheEntry<EntityState>> = new Map();
  // The services catalog changes only when integrations load or unload, so it
  // can live much longer than entity state. It is never invalidated by a
  // service call. Missing or failed → looked up again next time.
  private serviceResponseTTL: number = 5 * 60 * 1000;
  private serviceResponseCache: CacheEntry<Map<string, ServiceResponseSupport>> | null = null;

  /**
   * @param exposure The entities the user exposed to Assist. When given, it
   *   bounds what the tools can read and drive, the same bound Home Assistant's
   *   own agent puts on its tools. Omitted, or reporting "no opinion", it leaves
   *   the client unfiltered.
   */
  constructor(
    config: Config,
    private readonly exposure?: AssistExposure
  ) {
    this.baseUrl = config.haUrl.replace(/\/$/, "");
    this.token = config.haToken;
    this.skipTlsVerify = config.haSkipTlsVerify;
  }

  /**
   * Refuses an entity the user has not exposed, before any request is made.
   *
   * Throwing beats returning an empty result: the tool handler hands the
   * message to the model, so "not exposed" is said out loud instead of looking
   * like a device that is missing or broken.
   */
  private async requireExposed(...entityIds: string[]): Promise<void> {
    if (!this.exposure) return;
    for (const id of entityIds) {
      if (!(await this.exposure.allows(id))) throw new Error(notExposedMessage(id));
    }
  }

  /**
   * Refuses a service call that would reach past the exposure list.
   *
   * Named entities are checked one by one, including those in a nested
   * `target`. Area, device, floor and label targets would have to be resolved
   * to know what they hit, so while the list has an opinion they are refused
   * and the model is told to name entities. A call with no target touches no
   * entity, except `script.<name>`, which runs that script.
   */
  private async requireExposedTargets(
    domain: string,
    service: string,
    payload: Record<string, unknown>
  ): Promise<void> {
    if (!this.exposure || (await this.exposure.list()) === null) return;
    const nested =
      payload.target && typeof payload.target === "object"
        ? (payload.target as Record<string, unknown>)
        : {};
    const indirect = INDIRECT_TARGETS.find(
      (k) => payload[k] !== undefined || nested[k] !== undefined
    );
    if (indirect) {
      throw new Error(
        `Targeting by ${indirect} is not available to you: only entities the user exposed to the ` +
          `assistant may be controlled. Call the service with the exposed entity_ids instead.`
      );
    }
    const ids = [...targetedEntities(payload.entity_id), ...targetedEntities(nested.entity_id)];
    if (ids.includes("all")) {
      throw new Error(
        `entity_id "all" is not available to you: it reaches entities the user has not exposed. ` +
          `Call the service with the exposed entity_ids instead.`
      );
    }
    if (domain === "script" && !SCRIPT_LIFECYCLE.has(service)) ids.push(`script.${service}`);
    await this.requireExposed(...ids);
  }

  /**
   * Check if cache entry is still valid
   */
  private isCacheValid<T>(entry: CacheEntry<T> | null | undefined): entry is CacheEntry<T> {
    if (!entry) return false;
    return Date.now() - entry.timestamp < this.cacheTTL;
  }

  /**
   * Invalidate all caches (call after service calls)
   */
  private invalidateCache(): void {
    this.allStatesCache = null;
    this.entityCache.clear();
  }

  private async fetch<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;

    const fetchOptions: RequestInit = {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    // Handle self-signed certificates
    if (this.skipTlsVerify && url.startsWith("https://")) {
      const { Agent } = await import("undici");
      (fetchOptions as any).dispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API error ${response.status}: ${text}`);
    }

    return response.json() as Promise<T>;
  }

  private async fetchText(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<string> {
    const url = `${this.baseUrl}${endpoint}`;

    const fetchOptions: RequestInit = {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
        ...options.headers,
      },
    };

    if (this.skipTlsVerify && url.startsWith("https://")) {
      const { Agent } = await import("undici");
      (fetchOptions as any).dispatcher = new Agent({
        connect: { rejectUnauthorized: false },
      });
    }

    const response = await fetch(url, fetchOptions);

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HA API error ${response.status}: ${text}`);
    }

    return response.text();
  }

  /**
   * Get all states (cached)
   */
  private async getAllStatesCached(): Promise<EntityState[]> {
    if (this.isCacheValid(this.allStatesCache)) {
      return this.allStatesCache.data;
    }

    const states = await this.fetch<EntityState[]>("/api/states");
    this.allStatesCache = { data: states, timestamp: Date.now() };

    // Also populate individual entity cache
    for (const state of states) {
      this.entityCache.set(state.entity_id, { data: state, timestamp: Date.now() });
    }

    return states;
  }

  /**
   * Get state of a single entity (cached)
   */
  async getState(entityId: string): Promise<EntityState> {
    requireEntityIdShape(entityId);
    await this.requireExposed(entityId);

    // Check individual cache first
    const cached = this.entityCache.get(entityId);
    if (this.isCacheValid(cached)) {
      return cached.data;
    }

    // Check if we have a recent all-states cache
    if (this.isCacheValid(this.allStatesCache)) {
      const state = this.allStatesCache.data.find(s => s.entity_id === entityId);
      if (state) return state;
    }

    // Fetch individual entity
    const state = await this.fetch<EntityState>(`/api/states/${entityId}`);
    this.entityCache.set(entityId, { data: state, timestamp: Date.now() });
    return state;
  }

  /**
   * Get all entities, optionally filtered by domain (cached)
   */
  async getEntities(domain?: string): Promise<EntityState[]> {
    const states = await this.visibleStates();

    if (domain) {
      return states.filter((s) => s.entity_id.startsWith(`${domain}.`));
    }

    return states;
  }

  /**
   * The states the house watch reads: what the assistant may see, or with
   * `all` the whole house (HOUSE_WATCH=all, the user's explicit choice; the
   * watch only reports, it never acts).
   */
  async getStatesForWatch(all: boolean): Promise<EntityState[]> {
    return all ? this.getAllStatesCached() : this.visibleStates();
  }

  /** Every state the assistant may see: all of them when the list has no opinion. */
  private async visibleStates(): Promise<EntityState[]> {
    const states = await this.getAllStatesCached();
    return this.exposure ? this.exposure.filter(states) : states;
  }

  /**
   * Search entities by name or ID substring (cached).
   *
   * Both sides are accent-folded before comparing. An entity_id is ASCII by
   * construction, so a query in the user's own language ("garaža") could never
   * match the entity slugged from it ("garaza_vrata"), and a friendly name is
   * whatever the installer typed, sometimes accented and sometimes not.
   */
  async searchEntities(query: string): Promise<EntityState[]> {
    const states = await this.visibleStates();
    const needle = foldAccents(query);

    return states.filter((s) => {
      const name = (s.attributes.friendly_name as string) || "";
      return (
        foldAccents(s.entity_id).includes(needle) ||
        foldAccents(name).includes(needle)
      );
    });
  }

  /**
   * Call a Home Assistant service (invalidates cache).
   *
   * Services that return data (`weather.get_forecasts`, `calendar.get_events`,
   * `todo.get_items`, ...) must be called with `?return_response`, and services
   * that don't must NOT be — HA 400s either way round. Which is which is
   * declared in the services catalog, so the decision is made here from that,
   * never by the caller: the query parameter goes on when the catalog says the
   * service supports a response, and the result then carries HA's
   * `{ changed_states, service_response }` instead of the changed-states list.
   * A `return_response` key inside `data` is accepted as a hint (it is not a
   * service field, so it is stripped from the payload) and can only ADD the
   * parameter for a service the catalog doesn't know; it never forces it onto
   * a service the catalog says has no response.
   */
  async callService(
    domain: string,
    service: string,
    entityId?: string,
    data?: Record<string, unknown>
  ): Promise<EntityState[] | ServiceCallWithResponse> {
    if (
      typeof domain !== "string" ||
      typeof service !== "string" ||
      !SERVICE_PART_PATTERN.test(domain) ||
      !SERVICE_PART_PATTERN.test(service)
    ) {
      throw new Error(
        `"${String(domain)}.${String(service)}" is not a valid service. Use a real service id ` +
          `(call list_services to discover them).`
      );
    }
    if (isBlockedService(domain, service)) {
      throw new Error(blockedServiceMessage(`${domain}.${service}`));
    }

    const payload: Record<string, unknown> = { ...data };
    const hint = payload.return_response === true;
    delete payload.return_response;
    if (entityId) {
      payload.entity_id = entityId;
    }

    // Every entity this call would touch, whether named in `entityId` or handed
    // in through `data`: a model that has been told an entity is out of scope
    // will otherwise try the other door.
    await this.requireExposedTargets(domain, service, payload);

    const support = await this.getServiceResponseSupport(domain, service);
    const wantResponse =
      support === "only" || support === "optional" || (support === undefined && hint);

    const endpoint = `/api/services/${domain}/${service}${wantResponse ? "?return_response" : ""}`;
    const result = await this.fetch<EntityState[] | ServiceCallWithResponse>(endpoint, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Invalidate cache after service call since states may have changed
    this.invalidateCache();

    return result;
  }

  /**
   * Whether `domain.service` supports a response, per HA's services catalog:
   * `response: null` → "none", `{ optional: true }` → "optional",
   * `{ optional: false }` → "only". `undefined` when the service is not in the
   * catalog or the catalog could not be fetched — best-effort, a catalog hiccup
   * must never stop a light from turning on.
   */
  private async getServiceResponseSupport(
    domain: string,
    service: string
  ): Promise<ServiceResponseSupport | undefined> {
    const cached = this.serviceResponseCache;
    if (!cached || Date.now() - cached.timestamp >= this.serviceResponseTTL) {
      try {
        const raw = await this.fetch<
          { domain: string; services: Record<string, { response?: { optional?: boolean } | null }> }[]
        >("/api/services");
        const map = new Map<string, ServiceResponseSupport>();
        for (const entry of raw) {
          for (const [name, desc] of Object.entries(entry.services ?? {})) {
            const r = desc?.response;
            map.set(
              `${entry.domain}.${name}`,
              r == null ? "none" : r.optional ? "optional" : "only"
            );
          }
        }
        this.serviceResponseCache = { data: map, timestamp: Date.now() };
      } catch {
        return undefined;
      }
    }
    return this.serviceResponseCache!.data.get(`${domain}.${service}`);
  }

  /**
   * Render a Jinja2 template via the HA template API.
   * Returns the rendered plain-text result (HA returns text/plain, not JSON).
   */
  async renderTemplate(template: string): Promise<string> {
    return this.fetchText("/api/template", {
      method: "POST",
      body: JSON.stringify({ template }),
    });
  }

  /**
   * Get historical states for an entity (not cached - historical data)
   */
  async getHistory(
    entityId: string,
    startTime?: string,
    endTime?: string
  ): Promise<HistoryEntry[]> {
    requireEntityIdShape(entityId);
    await this.requireExposed(entityId);

    const start = startTime || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    // URL-encode every interpolated value. The `+` in `+HH:MM` tz offsets is
    // otherwise decoded as a space in query strings by aiohttp (HA's HTTP
    // layer), producing "Invalid end_time" 400s for any LLM that includes
    // an explicit timezone offset in its history args.
    // `minimal_response` drops attributes from every entry except the first and
    // last. We only ever read state + last_changed, so serializing icon,
    // friendly_name and device_class onto fifty thousand rows was work HA did
    // purely for us to discard: six of these calls took 15-23s each on a real
    // house. The first entry stays complete, which is where the unit comes from.
    let endpoint = `/api/history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response=true`;

    if (endTime) {
      endpoint += `&end_time=${encodeURIComponent(endTime)}`;
    }

    const result = await this.fetch<HistoryEntry[][]>(endpoint);
    return result[0] || [];
  }

  /** Wrap a single object (or undefined) into the array form HA's config API expects. */
  private toArray(value: unknown): unknown[] {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null) return [];
    return [value];
  }

  /**
   * Coerce common LLM action malformations into a valid HA action shape:
   *  - a stray `domain` key (HA 400s on it) is folded into the service id
   *    (e.g. {service:"mobile_app_x", domain:"notify"} → {service:"notify.mobile_app_x"})
   *  - `service_data` is renamed to `data` (HA's current key)
   * Recurses into control structures (choose/if/sequence/...) but not into payloads.
   */
  private cleanActionNode(node: unknown): unknown {
    if (Array.isArray(node)) return node.map((n) => this.cleanActionNode(n));
    if (!node || typeof node !== "object") return node;
    const obj = node as Record<string, unknown>;
    const isCall = typeof obj.service === "string" || typeof obj.action === "string";
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (isCall && key === "domain") continue; // dropped; folded into service below
      if (isCall && key === "service_data") {
        if (obj.data === undefined) out.data = value; // rename service_data → data
        continue;
      }
      // Leave payload values untouched; recurse into control structures.
      if (key === "data" || key === "target" || key === "metadata" || key === "variables") {
        out[key] = value;
      } else {
        out[key] = this.cleanActionNode(value);
      }
    }
    if (
      isCall &&
      typeof obj.domain === "string" &&
      typeof out.service === "string" &&
      !(out.service as string).includes(".")
    ) {
      out.service = `${obj.domain}.${out.service}`;
    }
    return out;
  }

  private normalizeActions(actions: unknown[]): unknown[] {
    return actions.map((a) => this.cleanActionNode(a));
  }

  /** Best-effort prediction of the entity_id HA derives from an alias (slugify). */
  private slugify(alias: string): string {
    return alias
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
  }

  // Automations are NOT bounded by the Assist exposure list yet. The
  // create/update payloads the assistant writes can name any entity, and
  // listAutomations() reads every automation, exposed or not: automations are
  // rarely exposed, and filtering them would leave the assistant unable to
  // find, change or delete the ones it just made. Bounding what an automation
  // may target is a separate change.

  /**
   * Create (or overwrite) a Home Assistant automation via the config API, then
   * reload automations so it registers immediately. Returns the authoritative
   * entity_id (read back from HA, since the alias→slug derivation can differ on
   * collisions). Throws a friendly error if the HA `config` integration is absent.
   */
  async createAutomation(config: AutomationConfig): Promise<CreatedAutomation> {
    const id = nextAutomationId();
    const body = {
      id,
      alias: config.alias,
      description: config.description ?? "",
      mode: config.mode ?? "single",
      trigger: this.toArray(config.trigger),
      condition: this.toArray(config.condition),
      action: this.normalizeActions(this.toArray(config.action)),
    };

    // Reject actions that reference non-existent services (e.g. a guessed
    // notify.mobile_app_* placeholder) before writing a broken automation.
    await this.validateActionServices(body.action);

    try {
      await this.fetch(automationConfigPath(id), {
        method: "POST",
        body: JSON.stringify(body),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/HA API error 40[45]\b/.test(message)) {
        throw new Error(
          "Couldn't create the automation — this Home Assistant doesn't have the config editor enabled. Add `config:` (or `default_config:`) to configuration.yaml and restart HA, then try again."
        );
      }
      throw error;
    }

    // Reload so the new automation registers immediately (also invalidates the state cache).
    await this.callService("automation", "reload");

    return {
      id,
      alias: config.alias,
      entity_id: await this.resolveAutomationEntityId(id, config.alias),
    };
  }

  /**
   * List all automation entities (config-id lives in attributes.id). Reads past
   * the exposure list on purpose; see the note above createAutomation().
   */
  async listAutomations(): Promise<EntityState[]> {
    const states = await this.getAllStatesCached();
    return states.filter((s) => s.entity_id.startsWith("automation."));
  }

  /** Delete an automation by its config id, then reload. */
  async deleteAutomation(id: string): Promise<void> {
    await this.fetch(automationConfigPath(id), { method: "DELETE" });
    await this.callService("automation", "reload");
  }

  /** Find the entity_id HA assigned to a just-created automation (by config id), with slug fallback. */
  private async resolveAutomationEntityId(id: string, alias: string): Promise<string> {
    try {
      const automations = await this.listAutomations();
      const match = automations.find((a) => a.attributes.id === id);
      if (match) return match.entity_id;
    } catch {
      // Fall through to the predicted slug below.
    }
    return `automation.${this.slugify(alias)}`;
  }

  /** Read an automation's stored config by its config id (the value in attributes.id). */
  async getAutomationConfig(id: string): Promise<Record<string, unknown>> {
    return this.fetch<Record<string, unknown>>(automationConfigPath(id));
  }

  /**
   * Update an existing automation: read its current config, overlay only the
   * provided fields, validate service references, write back to the same id,
   * and reload. Returns the (possibly changed) authoritative entity_id.
   */
  async updateAutomation(
    id: string,
    changes: Partial<AutomationConfig>
  ): Promise<CreatedAutomation> {
    const current = await this.getAutomationConfig(id);
    // HA's config API returns plural keys (triggers/conditions/actions); older
    // forms / our POST body use singular. Read BOTH so an un-changed field is
    // preserved from current instead of being wiped to [] (this silently
    // destroyed actions on trigger-only updates before the fix).
    const curTrigger = current.trigger ?? current.triggers;
    const curCondition = current.condition ?? current.conditions;
    const curAction = current.action ?? current.actions;
    const merged = {
      id,
      alias: changes.alias ?? (current.alias as string),
      description: changes.description ?? (current.description as string) ?? "",
      mode: changes.mode ?? (current.mode as string) ?? "single",
      trigger:
        changes.trigger !== undefined
          ? this.toArray(changes.trigger)
          : this.toArray(curTrigger),
      condition:
        changes.condition !== undefined
          ? this.toArray(changes.condition)
          : this.toArray(curCondition),
      action: this.normalizeActions(
        changes.action !== undefined
          ? this.toArray(changes.action)
          : this.toArray(curAction)
      ),
    };

    await this.validateActionServices(merged.action);

    await this.fetch(automationConfigPath(id), {
      method: "POST",
      body: JSON.stringify(merged),
    });
    await this.callService("automation", "reload");

    return {
      id,
      alias: merged.alias,
      entity_id: await this.resolveAutomationEntityId(id, merged.alias),
    };
  }

  /**
   * List available Home Assistant services (actions), as a map of
   * domain -> service names. Optionally filter to a single domain.
   * Use to discover real service ids (e.g. notify.mobile_app_<device>).
   */
  async listServices(domain?: string): Promise<Record<string, string[]>> {
    const raw = await this.fetch<{ domain: string; services: Record<string, unknown> }[]>(
      "/api/services"
    );
    const map: Record<string, string[]> = {};
    for (const entry of raw) {
      if (domain && entry.domain !== domain) continue;
      map[entry.domain] = Object.keys(entry.services ?? {});
    }
    return map;
  }

  /** Build the set of all known "domain.service" ids. */
  private async getKnownServiceIds(): Promise<Set<string>> {
    const raw = await this.fetch<{ domain: string; services: Record<string, unknown> }[]>(
      "/api/services"
    );
    const set = new Set<string>();
    for (const entry of raw) {
      for (const name of Object.keys(entry.services ?? {})) {
        set.add(`${entry.domain}.${name}`);
      }
    }
    return set;
  }

  /**
   * Throw a descriptive error if an automation action references a service that
   * doesn't exist (e.g. a guessed notify.mobile_app_* placeholder). Best-effort:
   * if the service list can't be fetched, validation is skipped (never blocks on
   * an API hiccup). Templated service names ("{{ ... }}") are skipped.
   */
  private async validateActionServices(action: unknown): Promise<void> {
    // Checked on the raw text, not only on the parsed refs below, so a
    // templated service name ("{{ 'hassio.host_shutdown' }}") is caught too.
    const raw = JSON.stringify(action ?? null);
    for (const dom of BLOCKED_SERVICE_DOMAINS) {
      if (new RegExp(`\\b${dom}\\.`).test(raw)) throw new Error(blockedServiceMessage(`${dom}.*`));
    }
    for (const id of BLOCKED_SERVICES) {
      if (raw.includes(id)) throw new Error(blockedServiceMessage(id));
    }

    const refs = new Set<string>();
    const collect = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(collect);
        return;
      }
      if (node && typeof node === "object") {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (
            (key === "service" || key === "action") &&
            typeof value === "string" &&
            /^[a-z_]+\.[a-z0-9_]+$/.test(value) &&
            !value.includes("{{")
          ) {
            refs.add(value);
          } else {
            collect(value);
          }
        }
      }
    };
    collect(action);
    if (refs.size === 0) return;

    let known: Set<string>;
    try {
      known = await this.getKnownServiceIds();
    } catch {
      return; // Can't fetch services → don't block on our own validation failing.
    }

    const unknown = [...refs].filter((ref) => !known.has(ref));
    if (unknown.length === 0) return;

    const hints = unknown.map((ref) => {
      const dom = ref.split(".")[0];
      const sameDomain = [...known].filter((k) => k.startsWith(`${dom}.`)).slice(0, 12);
      return sameDomain.length
        ? `"${ref}" doesn't exist — available ${dom} services: ${sameDomain.join(", ")}`
        : `"${ref}" doesn't exist and there are no services in the "${dom}" domain`;
    });

    throw new Error(
      `The automation action references services that don't exist in this Home Assistant. ${hints.join("; ")}. Use a real service id (call list_services to discover them) — never invent or use placeholder names.`
    );
  }

  /**
   * A still image from a camera, at most 1024 px wide (Home Assistant scales
   * it): enough to see who is at the door, and a fraction of the vision
   * tokens a full-HD frame costs.
   */
  async getCameraSnapshot(entityId: string, width = 1024): Promise<{ data: Buffer; mime: string }> {
    requireEntityIdShape(entityId);
    if (!entityId.startsWith("camera.")) throw new Error(`${entityId} is not a camera (camera.* entities only).`);
    await this.requireExposed(entityId);
    const url = `${this.baseUrl}/api/camera_proxy/${entityId}?width=${Math.max(64, Math.min(1920, Math.round(width)))}`;
    const options: RequestInit = { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(20000) };
    if (this.skipTlsVerify && url.startsWith("https://")) {
      const { Agent } = await import("undici");
      (options as any).dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    }
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`The camera did not return an image (HTTP ${response.status}).`);
    return {
      data: Buffer.from(await response.arrayBuffer()),
      mime: (response.headers.get("content-type") ?? "image/jpeg").split(";")[0],
    };
  }

  /**
   * Long-term statistics (recorder), the hourly / daily / monthly aggregates
   * behind the energy dashboard. They reach back years where raw history is
   * purged after ten days, and a month of daily rows is a few hundred tokens
   * where the raw readings are thousands.
   */
  async getStatistics(
    statisticIds: string[],
    start: string,
    end: string | undefined,
    period: "5minute" | "hour" | "day" | "week" | "month",
    types: string[]
  ): Promise<Record<string, Record<string, unknown>[]>> {
    for (const id of statisticIds) {
      // Entity statistics carry the entity id; external ones ("domain:name") pass as they are.
      if (/^[a-z0-9_]+\.[a-z0-9_]+$/.test(id)) await this.requireExposed(id);
      else if (!/^[a-z0-9_]+:[a-z0-9_]+$/.test(id)) throw new Error(`"${id}" is not a statistic id.`);
    }
    return wsCommand(this.baseUrl, this.token, {
      type: "recorder/statistics_during_period",
      start_time: start,
      ...(end ? { end_time: end } : {}),
      statistic_ids: statisticIds,
      period,
      types,
    });
  }

  /**
   * The stored runs of automations (the "traces" of the automation editor):
   * which ran, when, and how each ended. Home Assistant keeps the last few
   * per automation (5 by default), since its last restart.
   */
  async getAutomationTraces(itemId?: string): Promise<AutomationTrace[]> {
    if (itemId !== undefined && !/^[A-Za-z0-9_-]+$/.test(itemId)) throw new Error(`"${itemId}" is not an automation id.`);
    return wsCommand(this.baseUrl, this.token, { type: "trace/list", domain: "automation", ...(itemId ? { item_id: itemId } : {}) });
  }

  /**
   * The stored config of a script or scene, as the UI editor keeps it
   * (scripts.yaml by object id, scenes.yaml by their id attribute).
   */
  async getScriptOrSceneConfig(kind: "script" | "scene", id: string): Promise<Record<string, unknown>> {
    if (!AUTOMATION_CONFIG_ID_PATTERN.test(id)) throw new Error(`"${id}" is not a valid ${kind} config id.`);
    return this.fetch<Record<string, unknown>>(`/api/config/${kind}/config/${id}`);
  }

  /** Home Assistant's own check of its configuration (what "Check configuration" runs). */
  async checkConfig(): Promise<{ result: string; errors: string | null; warnings?: string | null }> {
    return this.fetch("/api/config/core/check_config", { method: "POST" });
  }

  /** Home Assistant's own settings: the house's time zone, for schedules. */
  async getConfig(): Promise<{ time_zone?: string; location_name?: string; language?: string }> {
    return this.fetch("/api/config");
  }

  /**
   * A notification: through a notify service ("mobile_app_pixel") when one
   * is configured, else as a persistent notification in Home Assistant.
   */
  async notify(service: string | undefined, title: string, message: string): Promise<void> {
    if (service) {
      const name = service.replace(/^notify\./, "");
      if (!SERVICE_PART_PATTERN.test(name)) throw new Error(`"${service}" is not a notify service name.`);
      await this.fetch(`/api/services/notify/${name}`, { method: "POST", body: JSON.stringify({ title, message }) });
      return;
    }
    await this.fetch("/api/services/persistent_notification/create", {
      method: "POST",
      body: JSON.stringify({ title, message }),
    });
  }
}
