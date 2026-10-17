"""igor-ear: listen without a wake word, observation mode.

  python -m igor_ear run      listen; note (or, in act mode, send) what is for Igor
  python -m igor_ear bench    record a few seconds and time the transcription
  python -m igor_ear report   summary of what was noted
  python -m igor_ear check "éteins le salon"   test the rules on a sentence

Observation mode (the default) never sends anything anywhere: it writes, on
this machine only, what it heard and what it would have done. Act mode
([mode] act = true) sends the sentences that name Igor to Home Assistant's
Assist pipeline, in the satellite's name, and the satellite says the answer.
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

log = logging.getLogger("igor-ear")

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


def sent_summary(entry: dict) -> str:
    """What Home Assistant made of a sent sentence, for the journal."""
    heard = entry.get("voxtral") or ""
    outcome = entry.get("error") or entry.get("answer") or "no answer"
    return f" -> heard {heard!r}, {'error' if entry.get('error') else 'answered'}: {outcome}" if heard or entry.get("error") \
        else f" -> Home Assistant transcribed nothing ({outcome})"


def run(settings: Settings) -> None:
    from . import ha
    from .audio import frames
    from .listener import Listener, Outcome
    from collections import deque

    from .segmenter import Segmenter, Utterance
    from .stt import Transcriber
    from .vad import Vad

    mode = "act" if settings.act else "observation"
    log.info("igor-ear %s, %s mode, source %s", __version__, mode, settings.source)
    if settings.addressing == "smart":
        log.info("Smart addressing: %s at %s judges sentences without the name (%s)%s",
                 settings.smart_model, settings.smart_url, "acts" if settings.smart_act else "noted only",
                 f"; paused while sound comes from {settings.sound_from}")
    prune(settings)
    connected = bool(settings.ha_url and settings.ha_token)
    if connected and settings.presence_entity and settings.presence_entity.startswith("assist_satellite."):
        log.warning("presence_entity is a satellite (%s): did you mean [home_assistant] satellite?", settings.presence_entity)
    if settings.act and not (connected and settings.satellite):
        raise SystemExit("Act mode needs [home_assistant] url, token and satellite in the settings")

    from .gate import SatelliteGate

    gate = SatelliteGate()

    def changed(entity: str, state: str) -> None:
        if entity == settings.satellite:
            gate.update(state)
        elif entity == settings.presence_entity:
            log.info("Presence: %s", state)

    watcher = None
    if connected:
        watched = [settings.satellite, settings.presence_entity]
        if settings.addressing == "smart" and settings.sound_from in {"players", "both"}:
            watched += settings.media_players
        watcher = ha.Watcher(settings.ha_url, settings.ha_token, watched, changed)
        watcher.start()

    def busy() -> bool:
        if watcher is None or not settings.satellite:
            return False
        gate.update(watcher.state(settings.satellite))
        return gate.busy()

    def home() -> bool:
        if watcher is None or not settings.presence_entity:
            return True
        state = watcher.state(settings.presence_entity)
        # Unknown or unavailable says nothing about the house: keep listening.
        if state is None or state.lower() in {"unknown", "unavailable", ""}:
            return True
        return state.lower() in {s.lower() for s in settings.home_states}

    from .media import audible

    speakers = None
    if settings.addressing == "smart" and settings.sound_from in {"speakers", "both"}:
        from .speakers import Speakers

        speakers = Speakers(settings.sink, settings.quiet_db)
        speakers.start()

    def players_sounding(unknown: bool) -> bool:
        if settings.sound_from not in {"players", "both"} or not settings.media_players or watcher is None:
            return False
        if not watcher.connected:
            return unknown
        return any(audible(watcher.state(m), watcher.attributes(m)) for m in settings.media_players)

    def media_sounding(unknown: bool = True) -> bool:
        """Sound in the house (out of this machine's speakers, or from a
        listed media player): no sentence without the name is judged.
        Unknown (monitor unreadable, Home Assistant unreachable) gives
        `unknown`: for judging, sounding, since needing the name is better
        than acting on a film; for closing the ear, not, so the name still
        works."""
        if settings.addressing != "smart":
            return False
        if speakers is not None and speakers.sounding(unknown):
            return True
        return players_sounding(unknown)

    judge = None
    if settings.addressing == "smart":
        from .judge import Judge

        judge = Judge(settings.smart_url, settings.smart_model)

    device_id = None
    if settings.act:
        try:
            device_id = ha.device_of(settings.ha_url, settings.ha_token, settings.satellite)
        except Exception as err:  # noqa: BLE001
            log.warning("Satellite device not found (%s); Igor will answer in its written style", err)
        log.info("Acting for %s (device %s)", settings.satellite, device_id or "unknown")

    def act(audio: np.ndarray, conversation: str | None) -> Outcome:
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
        try:
            r = ha.run_pipeline(settings.ha_url, settings.ha_token, pcm, settings.pipeline or None,
                                conversation, device_id)
        except Exception as err:  # noqa: BLE001
            return Outcome(error=str(err))
        if r.speech:
            try:
                ha.announce(settings.ha_url, settings.ha_token, settings.satellite, r.speech)
            except Exception as err:  # noqa: BLE001
                r.error = r.error or f"announce: {err}"
        return Outcome(r.heard, r.speech, r.conversation_id, r.continue_conversation, r.error)

    heard_failed = [False]

    def on_heard(waiting: bool, seconds: float | None) -> None:
        """Show on the wall tablet at once that Igor was heard. In the
        background: the words must not wait for it."""
        def call() -> None:
            try:
                ha.heard(settings.ha_url, settings.ha_token, settings.satellite, waiting, seconds)
            except Exception as err:  # noqa: BLE001 - a display only
                if not heard_failed[0]:
                    heard_failed[0] = True
                    log.info("The tablet is not told when Igor is heard (%s); add-on 0.11.1 or later needed", err)
        threading.Thread(target=call, daemon=True).start()

    vad, segmenter = Vad(), Segmenter()
    stt = Transcriber(settings.model, settings.device, settings.language, settings.cpu_threads, settings.hotwords,
                      settings.beam_size)
    listener = Listener(
        stt,
        Addressing(extra_targets=settings.extra_targets),
        act if settings.act else None,
        busy=busy,
        followup=settings.followup,
        name_wait=settings.name_wait,
        followup_seconds=settings.followup_seconds,
        keep_rejected_text=settings.rejected_text,
        on_heard=on_heard if settings.act and settings.satellite else None,
        judge=judge,
        judge_allowed=lambda: not media_sounding(),
        judge_acts=settings.smart_act,
    )
    utterances: queue.Queue[Utterance] = queue.Queue(maxsize=8)
    pending: deque[Utterance] = deque()

    def worker() -> None:
        last_prune = time.monotonic()
        while True:
            u = pending.popleft() if pending else utterances.get()
            last_end = [u.end]

            def more() -> np.ndarray | None:
                """The next part, if the speaker went on within join_gap."""
                while True:
                    try:
                        nxt = pending.popleft() if pending else utterances.get(timeout=0.1)
                    except queue.Empty:
                        if segmenter.in_speech and segmenter.speech_start - last_end[0] <= settings.join_gap:
                            continue  # still talking: wait for that part to end
                        if segmenter.now - last_end[0] >= settings.join_gap:
                            return None
                        continue
                    if nxt.start - last_end[0] <= settings.join_gap:
                        last_end[0] = nxt.end
                        return nxt.audio
                    pending.appendleft(nxt)  # a new sentence, handled next
                    return None

            entry = listener.handle(u.audio, more, u.start, u.end)
            note(settings, entry)
            if entry["reason"] not in {"satellite_busy", "noise"} or entry.get("accepted"):
                label = "SENT" if entry.get("sent") else ("WOULD SEND" if entry["accepted"] else
                                                          ("WOULD ACT " if entry["reason"] == "smart_would_act" else "ignored   "))
                log.info("%s %-18s %s%s", label,
                         entry["reason"], entry.get("text", ""), sent_summary(entry) if entry.get("sent") else "")
            if time.monotonic() - last_prune > 86400:
                prune(settings)
                last_prune = time.monotonic()

    threading.Thread(target=worker, daemon=True).start()
    away = False
    closed = False
    for frame in frames(settings.source):
        # [smart] when_media = "closed": nothing at all is heard while a
        # television or radio makes sound, not even the name.
        if settings.when_media == "closed" and media_sounding(unknown=False):
            if not closed:
                segmenter.reset()
                vad.reset()
                log.info("A television or radio is sounding: not listening")
            closed = True
            continue
        if closed:
            log.info("Quiet again: listening")
        closed = False
        if not home():
            if not away:
                segmenter.reset()
                vad.reset()
                log.info("Nobody home: not listening")
            away = True
            continue
        if away:
            log.info("Someone home: listening")
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
    stt = Transcriber(settings.model, settings.device, settings.language, settings.cpu_threads, settings.hotwords,
                      settings.beam_size)
    print(f"Ready on {stt.device} (beam {stt.beam_size}) in {time.monotonic() - t0:.1f}s")
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


def sound(settings: Settings, seconds: float) -> None:
    """What the speakers' watch sees, every half second, to set quiet_db."""
    from .speakers import Speakers

    speakers = Speakers(settings.sink, settings.quiet_db)
    speakers.start()
    print(f"Watching {speakers.monitor} for {seconds:.0f}s; sound above {settings.quiet_db:.0f} dB pauses the smart judge.")
    end = time.monotonic() + seconds
    time.sleep(1)
    while time.monotonic() < end:
        level = "silence" if speakers.level == float("-inf") else f"{speakers.level:6.1f} dB"
        state = "SOUND" if speakers.sounding(unknown=False) else "quiet"
        print(f"  {level:>10}  mute={speakers.muted}  volume={speakers.volume}%  -> {state}", flush=True)
        time.sleep(0.5)


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
    print("\nFor Igor:")
    for e in entries:
        if e["accepted"]:
            sent = f"  -> heard {e.get('voxtral', '')!r}, answered {e.get('answer') or e.get('error', '')!r}" if e.get("sent") else ""
            print(f"  {e['time']}  [{e['reason']}]  {e.get('text', '')}{sent}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="igor-ear", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("run")
    b = sub.add_parser("bench")
    b.add_argument("--seconds", type=float, default=5)
    b.add_argument("--device", choices=["auto", "cuda", "cpu"])
    sub.add_parser("report")
    so = sub.add_parser("sound", help="watch the speakers' level, to set [smart] quiet_db")
    so.add_argument("--seconds", type=float, default=15)
    c = sub.add_parser("check")
    c.add_argument("text")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s", stream=sys.stdout)
    # faster-whisper announces every clip it processes; only its problems matter here.
    logging.getLogger("faster_whisper").setLevel(logging.WARNING)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    try:
        settings = load()
    except ValueError as err:  # tomllib.TOMLDecodeError
        print(f"Error in {CONFIG}: {err}\n"
              "Check that every value is on one line, between double quotes, and closed.", file=sys.stderr)
        return 2
    if args.command == "run":
        if not CONFIG.exists():
            log.warning("No %s; using defaults", CONFIG)
        run(settings)
    elif args.command == "bench":
        if args.device:
            settings.device = args.device
        bench(settings, args.seconds)
    elif args.command == "sound":
        sound(settings, args.seconds)
    elif args.command == "report":
        report(settings)
    elif args.command == "check":
        d = Addressing(extra_targets=settings.extra_targets).decide(args.text)
        print(f"{'WOULD SEND' if d.accepted else 'ignored'} ({d.reason})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
