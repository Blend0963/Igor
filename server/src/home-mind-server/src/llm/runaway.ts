/**
 * Stops repetitive model output before it reaches the user.
 *
 * The guard buffers one sentence at a time so a repeated sentence is never
 * streamed twice. In spoken mode it also drops emoji (TTS often reads their
 * names) and stops at self-correction separators that commonly precede loops.
 * In written mode normal Markdown and emoji are preserved; repeated sentences
 * are still detected before they can be streamed twice.
 */
/**
 * What the model answers, alone, to a sentence from the always-on microphone
 * that was not said to it ("c'est Igor qui a fait ça"): the turn then ends in
 * silence. Spoken mode holds the first characters back until they are known
 * not to be this, so nothing of it is ever passed on.
 */
export const NOT_FOR_ME = "NOT_FOR_ME";

const EMOJI = /[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}\u{FE0F}\u{200D}\u{20E3}]/gu;
const RULE = /(^|\s)(?:-{3,}|\*{3,}|_{3,})(?=\s|$)/;
// Spoken replies have no use for markup either: an "*aside*" ("*Je corrige :*",
// "*C'est tout. Je m'arrête.*") is the model talking about its own answer, which
// is how its loops go on. The reply ends where the first one opens.
const ASIDE = /\*(?=\S)/;
// In a spoken reply, a sentence this close to one already said (share of
// words in common) is the same answer again, reworded.
const NEAR_REPEAT = 0.75;
const NEAR_REPEAT_MIN_WORDS = 5;
// A sentence ends at . ! ? or … followed by a space or a line break.
const SENTENCE_END = /[.!?…]+["»)\]]*\s+/;
// Shorter sentences ("Oui.", "D'accord.") may honestly come back.
const MIN_REPEAT_LENGTH = 12;

function key(sentence: string): string {
  return sentence.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, "");
}

function words(sentence: string): Set<string> {
  return new Set(
    sentence.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  );
}

function likeness(a: Set<string>, b: Set<string>): number {
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common || 1);
}

export class SpokenGuard {
  private pending = "";

  constructor(private readonly spokenOnly = true) {}
  private readonly seen = new Set<string>();
  private readonly said: Set<string>[] = [];
  /** True once the reply has been cut; whatever comes next is dropped. */
  stopped = false;
  /** Why it was cut, for the log. */
  reason: "repeat" | "near_repeat" | "rule" | "aside" | "not_for_me" | undefined;
  private opened = false;

  /** The model said the sentence was not for it: say nothing. */
  get silent(): boolean {
    return this.reason === "not_for_me";
  }

  /** Text that may be passed on now. */
  push(chunk: string): string {
    if (this.stopped) return "";
    this.pending += this.spokenOnly ? chunk.replace(EMOJI, "") : chunk;
    if (this.spokenOnly && !this.opened) {
      const head = this.pending.replace(/^[\s"'«*`[(]+/, "");
      if (head.startsWith(NOT_FOR_ME)) {
        this.stop("not_for_me");
        return "";
      }
      // Could still become NOT_FOR_ME: wait for more before saying anything.
      if (NOT_FOR_ME.startsWith(head)) return "";
      this.opened = true;
    }
    let out = "";
    const rule = this.spokenOnly ? (RULE.exec(this.pending) ?? ASIDE.exec(this.pending)) : null;
    const limit = rule ? rule.index : this.pending.length;
    let match: RegExpExecArray | null;
    while (!this.stopped) {
      // This global regex is reused across calls; reset its cursor whenever the
      // pending buffer changes or exec() can skip an otherwise matching sentence.
      SENTENCE_END.lastIndex = 0;
      match = SENTENCE_END.exec(this.pending.slice(0, limit + 1));
      if (!match) break;
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
    if (this.spokenOnly && !this.opened && NOT_FOR_ME.startsWith(this.pending.replace(/^[\s"'«*`[(]+/, "").trimEnd())) {
      // The whole reply was a beginning of NOT_FOR_ME ("NOT_FOR"): silence too.
      if (this.pending.trim()) this.stop("not_for_me");
      this.pending = "";
      return "";
    }
    const rest = this.pending;
    this.pending = "";
    return this.repeats(rest) ? "" : rest;
  }

  private cutAtRule(): string {
    const rule = RULE.exec(this.pending);
    const aside = rule ? null : ASIDE.exec(this.pending);
    const at = rule ?? aside;
    const before = at ? this.pending.slice(0, at.index) : this.pending;
    this.stop(rule || !aside ? "rule" : "aside");
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
    if (this.spokenOnly) {
      const w = words(sentence);
      if (w.size >= NEAR_REPEAT_MIN_WORDS) {
        if (this.said.some((s) => likeness(w, s) >= NEAR_REPEAT)) {
          this.stop("near_repeat");
          return true;
        }
        this.said.push(w);
      }
    }
    return false;
  }

  private stop(reason: NonNullable<SpokenGuard["reason"]>): void {
    this.stopped = true;
    this.reason ??= reason;
    this.pending = "";
  }
}
