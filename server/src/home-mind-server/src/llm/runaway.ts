/**
 * Stops repetitive model output before it reaches the user.
 *
 * The guard buffers one sentence at a time so a repeated sentence is never
 * streamed twice. In spoken mode it also drops emoji (TTS often reads their
 * names) and stops at self-correction separators that commonly precede loops.
 * In written mode normal Markdown and emoji are preserved; repeated sentences
 * are still detected before they can be streamed twice.
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

  constructor(private readonly spokenOnly = true) {}
  private readonly seen = new Set<string>();
  /** True once the reply has been cut; whatever comes next is dropped. */
  stopped = false;
  /** Why it was cut, for the log. */
  reason: "repeat" | "rule" | undefined;

  /** Text that may be passed on now. */
  push(chunk: string): string {
    if (this.stopped) return "";
    this.pending += this.spokenOnly ? chunk.replace(EMOJI, "") : chunk;
    let out = "";
    const rule = this.spokenOnly ? RULE.exec(this.pending) : null;
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
