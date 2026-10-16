/**
 * Replies still being written, so a panel that lost its stream can find
 * them again.
 *
 * A reply does not stop when the page that asked for it goes away: the
 * engine runs to the end and stores the answer. But the chat panel lives in
 * Home Assistant's ingress frame, which is torn down as soon as the person
 * opens another page, and the stream goes with it; coming back, they saw
 * their question with no answer and took Igor for having stopped. The panel
 * now asks which threads are still running (to animate them in the list)
 * and follows the open one through its text so far until it is stored.
 */

export interface RunningTurn {
  conversationId: string;
  startedAt: string;
  /** The server's latest heads-up ("Réflexion…", "Lecture des fichiers…"). */
  status?: string;
  /** The reply so far, every model turn of it. */
  text: string;
}

/** Longest reply text kept for a reconnecting panel, in characters. */
const MAX_LIVE_CHARS = 200_000;
/** A turn older than this is forgotten even if nothing finished it. */
const STALE_MS = 15 * 60 * 1000;

export class RunningTurns {
  private turns = new Map<string, { userId: string; conversationId: string; startedAt: string; status?: string; text: string; at: number; controller: AbortController }>();

  private key(userId: string, conversationId: string): string {
    return `${userId}\u0000${conversationId}`;
  }

  start(userId: string, conversationId: string): RunningTurnHandle {
    const key = this.key(userId, conversationId);
    const turn: { userId: string; conversationId: string; startedAt: string; status?: string; text: string; at: number; controller: AbortController } = {
      userId,
      conversationId,
      startedAt: new Date().toISOString(),
      text: "",
      at: Date.now(),
      controller: new AbortController(),
    };
    // A newer request on the same thread supersedes the old one: stop it
    // rather than leave it running where the stop button can no longer reach.
    this.turns.get(key)?.controller.abort();
    this.turns.set(key, turn);
    let parts = 0;
    return {
      signal: turn.controller.signal,
      chunk: (text) => {
        if (turn.text.length < MAX_LIVE_CHARS) turn.text += text;
      },
      newTurn: () => {
        // The text before a batch of tools and the answer after it are
        // separate messages; keep them apart the way the stream does.
        if (parts++ > 0 && turn.text && !turn.text.endsWith("\n\n")) turn.text += "\n\n";
      },
      status: (text) => {
        turn.status = text;
      },
      finish: () => {
        // A newer request on the same thread owns the entry now.
        if (this.turns.get(key) === turn) this.turns.delete(key);
      },
    };
  }

  /** This user's threads with a reply in progress. */
  list(userId: string): RunningTurn[] {
    this.prune();
    return [...this.turns.values()]
      .filter((t) => t.userId === userId)
      .map(({ conversationId, startedAt, status }) => ({ conversationId, startedAt, status, text: "" }));
  }

  /** The stop button: aborts the reply in progress. False when none is running. */
  stop(userId: string, conversationId: string): boolean {
    const turn = this.turns.get(this.key(userId, conversationId));
    if (!turn) return false;
    turn.controller.abort();
    return true;
  }

  get(userId: string, conversationId: string): RunningTurn | undefined {
    this.prune();
    const turn = this.turns.get(this.key(userId, conversationId));
    if (!turn) return undefined;
    const { startedAt, status, text } = turn;
    return { conversationId, startedAt, status, text };
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, turn] of this.turns) if (now - turn.at > STALE_MS) this.turns.delete(key);
  }
}

export interface RunningTurnHandle {
  /** Aborted by stop(). */
  signal: AbortSignal;
  chunk(text: string): void;
  newTurn(): void;
  status(text: string): void;
  finish(): void;
}
