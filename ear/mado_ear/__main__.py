"""mado-ear: listen without a wake word, observation mode.

  python -m mado_ear run      listen and note what would have gone to MaDo
  python -m mado_ear bench    record a few seconds and time the transcription
  python -m mado_ear report   summary of what was noted
  python -m mado_ear check "éteins le salon"   test the rules on a sentence

Observation mode never sends anything anywhere: it writes, on this machine
only, what it heard and what it would have done, so the rules can be judged
before MaDo acts on them.
"""
from __future__ import annotations

import argparse
import json
import logging
import queue
import sys
import threading
import time
from collections import Counter
from datetime import datetime, timedelta, timezone

import numpy as np

from . import __version__
from .addressing import Addressing
from .config import CONFIG, Settings, load

log = logging.getLogger("mado-ear")

# Below these, Whisper is guessing words into noise.
MAX_NO_SPEECH = 0.6
MIN_LOGPROB = -1.0


def prune(settings: Settings) -> None:
    """Drop notes older than keep_days."""
    path = settings.log_file
    if not path.exists():
        return
    limit = datetime.now(timezone.utc) - timedelta(days=settings.keep_days)
    kept = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            if datetime.fromisoformat(json.loads(line)["time"]) >= limit:
                kept.append(line)
        except (ValueError, KeyError):
            continue
    path.write_text("".join(k + "\n" for k in kept), encoding="utf-8")


def note(settings: Settings, entry: dict) -> None:
    settings.log_file.parent.mkdir(parents=True, exist_ok=True)
    with settings.log_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry, ensure_ascii=False) + "\n")


def run(settings: Settings) -> None:
    from .audio import frames
    from .presence import Presence
    from .segmenter import RATE, Segmenter
    from .stt import Transcriber
    from .vad import Vad

    log.info("mado-ear %s, observation mode, source %s", __version__, settings.source)
    prune(settings)
    rules = Addressing(extra_targets=settings.extra_targets)
    presence = Presence(settings.ha_url, settings.ha_token, settings.presence_entity, settings.home_states)
    vad, segmenter = Vad(), Segmenter()
    stt = Transcriber(settings.model, settings.device, settings.language, settings.cpu_threads)
    utterances: queue.Queue[np.ndarray] = queue.Queue(maxsize=4)

    def worker() -> None:
        last_prune = time.monotonic()
        while True:
            audio = utterances.get()
            heard = stt(audio)
            seconds = round(len(audio) / RATE, 2)
            if not heard.text or heard.no_speech > MAX_NO_SPEECH or heard.logprob < MIN_LOGPROB:
                accepted, reason = False, "noise"
            else:
                decision = rules.decide(heard.text)
                accepted, reason = decision.accepted, decision.reason
            entry = {
                "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "accepted": accepted,
                "reason": reason,
                "audio_s": seconds,
                "stt_s": round(heard.seconds, 2),
            }
            if accepted or settings.rejected_text:
                entry["text"] = heard.text
            note(settings, entry)
            log.info("%s %-13s %.1fs audio, %.2fs stt%s", "WOULD SEND" if accepted else "ignored   ",
                     reason, seconds, heard.seconds, f": {heard.text}" if accepted else "")
            if time.monotonic() - last_prune > 86400:
                prune(settings)
                last_prune = time.monotonic()

    threading.Thread(target=worker, daemon=True).start()
    away = False
    for frame in frames(settings.source):
        if not presence.home():
            if not away:
                segmenter.reset()
                vad.reset()
            away = True
            continue
        away = False
        utterance = segmenter.push(frame, vad(frame))
        if utterance is not None:
            try:
                utterances.put_nowait(utterance)
            except queue.Full:
                log.warning("Transcription behind; one sentence skipped")


def bench(settings: Settings, seconds: float) -> None:
    from .audio import frames
    from .stt import Transcriber
    from .vad import Vad

    print(f"Loading the model ({settings.model}, {settings.device})…", flush=True)
    t0 = time.monotonic()
    stt = Transcriber(settings.model, settings.device, settings.language, settings.cpu_threads)
    print(f"Ready on {stt.device} in {time.monotonic() - t0:.1f}s")
    print(f"Speak now: recording {seconds:.0f}s from {settings.source}…", flush=True)
    vad, chunks, probs = Vad(), [], []
    for frame in frames(settings.source):
        chunks.append(frame)
        probs.append(vad(frame))
        if len(chunks) * 512 >= seconds * 16000:
            break
    audio = np.concatenate(chunks)
    print(f"Level: peak {np.abs(audio).max():.2f}; voice in {sum(p >= 0.5 for p in probs) * 32 / 1000:.1f}s of {seconds:.0f}s")
    heard = stt(audio)
    print(f"Transcribed in {heard.seconds:.2f}s on {stt.device}: {heard.text!r}")
    print(f"(no_speech {heard.no_speech:.2f}, logprob {heard.logprob:.2f})")


def report(settings: Settings) -> None:
    path = settings.log_file
    entries = [json.loads(l) for l in path.read_text(encoding="utf-8").splitlines() if l.strip()] if path.exists() else []
    if not entries:
        print("Nothing noted yet.")
        return
    reasons = Counter(e["reason"] for e in entries)
    stt = [e["stt_s"] for e in entries]
    print(f"{len(entries)} sentences since {entries[0]['time']}; transcription {np.mean(stt):.2f}s on average, {max(stt):.2f}s at worst")
    for reason, count in reasons.most_common():
        print(f"  {reason:14} {count}")
    print("\nWould have gone to MaDo:")
    for e in entries:
        if e["accepted"]:
            print(f"  {e['time']}  [{e['reason']}]  {e.get('text', '')}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="mado-ear", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    b = sub.add_parser("bench")
    b.add_argument("--seconds", type=float, default=5)
    b.add_argument("--device", choices=["auto", "cuda", "cpu"])
    sub.add_parser("report")
    c = sub.add_parser("check")
    c.add_argument("text")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    # faster-whisper announces every clip it processes; only its problems matter here.
    logging.getLogger("faster_whisper").setLevel(logging.WARNING)
    settings = load()
    if args.command == "run":
        if not CONFIG.exists():
            log.warning("No %s; using defaults", CONFIG)
        run(settings)
    elif args.command == "bench":
        if args.device:
            settings.device = args.device
        bench(settings, args.seconds)
    elif args.command == "report":
        report(settings)
    elif args.command == "check":
        d = Addressing(extra_targets=settings.extra_targets).decide(args.text)
        print(f"{'WOULD SEND' if d.accepted else 'ignored'} ({d.reason})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
