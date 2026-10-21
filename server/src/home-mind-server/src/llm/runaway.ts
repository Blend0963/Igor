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
// Spoken replies have no use for markup: bold and code marks ("**Hugo
// Poirier**", `__`, backticks) are dropped, and so is a lone "*" of italics
// inside a sentence, or the voice reads them out. But an "*aside*" opening a
// sentence ("*Je corrige :*", "*C'est tout. Je m'arrête.*") is the model
// talking about its own answer, which is how its loops go on: the reply ends
// there. (0.11.6 ended at any "*", which cut every answer with bold in it.)
const BOLD = /(?<!\*)\*\*(?!\*)|__|`/g;
const ASIDE = /(?:^|[.!?…:]\s+|\n\s*)\*(?=[^\s*])/;
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
  private heldStar = "";

  /** The model said the sentence was not for it: say nothing. */
  get silent(): boolean {
    return this.reason === "not_for_me";
  }

  /** Text that may be passed on now. */
  push(chunk: string): string {
    if (this.stopped) return "";
    if (this.spokenOnly) {
      // A "*" that ended the last chunk may be the first half of "**".
      chunk = this.heldStar + chunk;
      this.heldStar = "";
      this.pending = (this.pending + chunk.replace(EMOJI, "")).replace(BOLD, "");
      if (/(?<!\*)\*$/.test(this.pending)) {
        this.heldStar = "*";
        this.pending = this.pending.slice(0, -1);
      }
    } else {
      this.pending += chunk;
    }
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
    const cut = this.spokenOnly ? this.cutPoint() : undefined;
    const rule = cut !== undefined;
    const limit = cut ?? this.pending.length;
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
      out += this.spokenOnly ? sentence.replace(/\*/g, "") : sentence;
      this.pending = this.pending.slice(end);
      if (rule) return out + this.cutAtRule();
    }
    if (rule) out += this.cutAtRule();
    return out;
  }

  /** What is left once the stream has ended. */
  flush(): string {
    this.pending += this.heldStar;
    this.heldStar = "";
    if (this.spokenOnly) this.pending = this.pending.replace(/\*/g, "");
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

  /** Where a spoken reply must end: a "---" rule, or an aside opening a sentence. */
  private cutPoint(): number | undefined {
    const rule = RULE.exec(this.pending);
    const aside = ASIDE.exec(this.pending);
    const at = aside ? aside.index + aside[0].length - 1 : undefined;
    if (rule && (at === undefined || rule.index <= at)) return rule.index;
    return at;
  }

  private cutAtRule(): string {
    const rule = RULE.exec(this.pending);
    const cut = this.cutPoint();
    const before = cut !== undefined ? this.pending.slice(0, cut) : this.pending;
    this.stop(rule && rule.index === cut ? "rule" : "aside");
    return this.repeats(before) ? "" : before.replace(/\*/g, "").trimEnd();
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
