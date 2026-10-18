/**
 * Keeps a spoken reply from running away.
 *
 * A small model on a plain command (FAST_MODEL) sometimes loops: it answers,
 * adds an emoji, then writes "--- *I must not add emojis, I correct:*" and
 * the same answer again, and again, until the output cap (2000 tokens) is
 * spent. The satellite reads all of it aloud and the tablet shows it.
 *
 * The guard sits between the stream and its listener, one sentence at a
 * time: a sentence already said in this reply, or a "---" rule (a spoken
 * reply has no use for one; it is how these loops start), ends the reply
 * there. Emojis are dropped on the way: the voice would read their names.
 * A sentence is passed on once it is complete, so nothing of a repeat is
 * ever heard.
 */
const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const RULE = /(^|\s)(?:-{3,}|\*{3,}|_{3,})(?=\s|$)/;
// A sentence ends at . ! ? or … followed by a space or a line break.
const SENTENCE_END = /[.!?…]+["»)\]]*\s+/;
// Shorter sentences ("Oui.", "D'accord.") may honestly come back.
const MIN_REPEAT_LENGTH = 12;

function key(sentence: string): string {
  return sentence.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
}

export class SpokenGuard {
  private pending = "";
  private readonly seen = new Set<string>();
  /** True once the reply has been cut; whatever comes next is dropped. */
  stopped = false;
  /** Why it was cut, for the log. */
  reason: "repeat" | "rule" | undefined;

  /** Text that may be passed on now. */
  push(chunk: string): string {
    if (this.stopped) return "";
    this.pending += chunk.replace(EMOJI, "");
    let out = "";
    const rule = RULE.exec(this.pending);
    const limit = rule ? rule.index : this.pending.length;
    let match: RegExpExecArray | null;
    while (!this.stopped && (match = SENTENCE_END.exec(this.pending.slice(0, limit + 1))) !== null) {
      const end = match.index + match[0].length;
      const sentence = this.pending.slice(0, end);
      if (this.repeats(sentence)) return out;
      out += sentence;
      this.pending = this.pending.slice(end);
      if (rule) return out + this.cutAtRule();
    }
    if (rule) out += this.cutAtRule();
    return out;
  }

  /** What is left once the stream has ended. */
  flush(): string {
    if (this.stopped || !this.pending) return "";
    const rest = this.pending;
    this.pending = "";
    return this.repeats(rest) ? "" : rest;
  }

  private cutAtRule(): string {
    const rule = RULE.exec(this.pending);
    const before = rule ? this.pending.slice(0, rule.index) : this.pending;
    this.stop("rule");
    return this.repeats(before) ? "" : before.trimEnd();
  }

  private repeats(sentence: string): boolean {
    const k = key(sentence);
    if (k.length >= MIN_REPEAT_LENGTH) {
      if (this.seen.has(k)) {
        this.stop("repeat");
        return true;
      }
      this.seen.add(k);
    }
    return false;
  }

  private stop(reason: "repeat" | "rule"): void {
    this.stopped = true;
    this.reason ??= reason;
    this.pending = "";
  }
}
