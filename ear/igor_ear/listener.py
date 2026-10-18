"""What to do with each sentence heard.

Kept apart from the microphone and from Home Assistant so it can be tested
with fakes. For each utterance:

1. linux-voice-assistant busy (listening after its wake word, thinking,
   speaking)? Ignored: it is handling the request, or it is Igor's own voice.
2. Local transcription (Whisper small), only to find the name.
3. "Igor" anywhere in the sentence: taken. "Igor" alone ("Igor ?"): the
   next sentence, within a few seconds, is the order, and both are sent
   together. Right after Igor asked a question, the answer is taken without
   the name (follow-up). In the "smart" mode, a sentence without the name
   that looks like a request goes to a small local AI (judge.py) with the
   sentences heard just before; it decides, unless a television or radio is
   making sound (then the name is needed).
4. Taken, in act mode: if the speaker goes on after a short pause, the rest
   is joined first (`more`). Then the recorded audio (not Whisper's words)
   goes to the Assist pipeline, so Voxtral hears all of it properly, and the
   satellite says Igor's answer. In observation mode it is only noted.

A long sentence is not transcribed in full just to find the name: its first
8 and last 6 seconds are, where "Igor" is said in practice.
"""
from __future__ import annotations

import difflib
import logging
import time
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import numpy as np

from .addressing import HALLUCINATIONS, Addressing, normalize
from .spotter import Spot

log = logging.getLogger("igor-ear")

RATE = 16000
GAP = np.zeros(RATE // 5, dtype=np.float32)  # 0.2 s between "Igor" and the order

# Longer than this, only the head and the tail are transcribed for the name.
LONG_S = 16.0
HEAD_S = 8.0
TAIL_S = 6.0

# "Éteins la lumière… Igor": with a pause before the name, the order is the
# sentence before. It is joined in when it ended this short a time before.
PREVIOUS_GAP = 2.0

# What the smart judge is shown of the conversation before a sentence.
CONTEXT_SENTENCES = 4
CONTEXT_SECONDS = 90.0

# A sentence this close to what Igor said this recently is its own voice,
# come back through the microphone.
OWN_VOICE_SECONDS = 30.0
OWN_VOICE_LIKENESS = 0.7

# Below these, Whisper is guessing words into noise.
MAX_NO_SPEECH = 0.6
MIN_LOGPROB = -1.0
# A word said alone ("Igor ?") is a very short sound, and Whisper doubts it
# is speech at all; the voice detector already heard a voice. With the
# name, only near certainty of no speech drops it.
MAX_NO_SPEECH_NAME = 0.9


@dataclass
class Outcome:
    """What Igor did with a sentence sent to it."""

    heard: str = ""
    speech: str = ""
    conversation_id: str | None = None
    continue_conversation: bool = False
    error: str = ""


class Listener:
    def __init__(
        self,
        stt: Callable,
        rules: Addressing,
        act: Callable[[np.ndarray, str | None], Outcome] | None = None,
        busy: Callable[[], bool] = lambda: False,
        followup: bool = True,
        followup_seconds: float = 8.0,
        name_wait: float = 6.0,
        keep_rejected_text: bool = True,
        clock: Callable[[], float] = time.monotonic,
        on_heard: Callable[[bool, float | None], None] | None = None,
        on_name_alone: Callable[[Callable[[], None]], None] | None = None,
        judge: Callable[[list[tuple[float, str]], str], bool | None] | None = None,
        judge_allowed: Callable[[], bool] = lambda: True,
        judge_acts: bool = False,
        spotter: Callable[[np.ndarray], Spot] | None = None,
    ) -> None:
        self.stt, self.rules, self.act, self.busy = stt, rules, act, busy
        self.followup, self.followup_seconds, self.name_wait = followup, followup_seconds, name_wait
        self.keep_rejected_text = keep_rejected_text
        self.clock = clock
        # Called the moment Igor is addressed, before the words are sent (the
        # tablet shows it at once): (False, None). And when Igor listens for
        # the request, after the name alone or a question of its own:
        # (True, how long it listens).
        self.on_heard = on_heard
        # "Igor" said alone: Igor answers aloud ("Oui ?"), then calls the
        # function it is given, once silent: the wait for the order starts.
        self.on_name_alone = on_name_alone
        # Smart mode: the judge, whether it may judge now (no television
        # sounding), and whether its "yes" acts or is only noted.
        self.judge, self.judge_allowed, self.judge_acts = judge, judge_allowed, judge_acts
        # A second ear for the name (Vosk, on the CPU), run while Whisper
        # transcribes on the GPU.
        self.spotter = spotter
        self._spotting = ThreadPoolExecutor(1, "spotter") if spotter is not None else None
        self._recent: deque[tuple[float, str]] = deque(maxlen=CONTEXT_SENTENCES)
        # What Igor said aloud lately, to know its own voice if it comes back.
        self._said: deque[tuple[float, str]] = deque(maxlen=4)
        # The last sentence not taken, with its end on the stream clock, in
        # case the name comes right after it.
        self._previous: tuple[np.ndarray, str, float] | None = None
        self._armed: np.ndarray | None = None
        self._armed_until = float("-inf")
        self._followup_until = float("-inf")
        self._conversation: str | None = None

    def _hear(self, audio: np.ndarray):
        if len(audio) <= LONG_S * RATE:
            return self.stt(audio)
        head = self.stt(audio[: int(HEAD_S * RATE)])
        tail = self.stt(audio[-int(TAIL_S * RATE):])
        head.text = f"{head.text} … {tail.text}".strip(" …")
        head.seconds += tail.seconds
        head.no_speech = min(head.no_speech, tail.no_speech)
        head.logprob = max(head.logprob, tail.logprob)
        return head

    def rearm(self) -> None:
        """Igor has finished its "Oui ?": the order is waited for from now."""
        if self._armed is None:
            return
        self._armed_until = self.clock() + self.name_wait
        log.info("Listening for the order, without the name, for %.0f s", self.name_wait)
        if self.on_heard is not None:
            self.on_heard(True, self.name_wait)

    def disarm(self) -> None:
        """The order will not be taken here (the satellite listens for it)."""
        self._armed, self._armed_until = None, float("-inf")

    def _with_spotted_name(self, text: str, spot: Spot | None, entry: dict) -> str:
        """Whisper missed the name Vosk heard: put it where Vosk heard it, so
        the rules (name alone, name at the end…) read the sentence right."""
        if spot is None or not spot.found:
            return text
        entry["vosk"] = " ".join(spot.names)
        if self.rules.name.search(normalize(text)):
            return text
        entry["vosk_only"] = True
        name = self.rules.names[0].capitalize()
        # Alone: Whisper wrote at most a word or two for it ("Ma dot.").
        if spot.alone and len(normalize(text).split()) <= 2:
            return f"{name} ?"
        if spot.last and not spot.first:
            return f"{text} {name}"
        return f"{name}, {text}"

    def said(self, text: str) -> None:
        """Igor is about to say this aloud."""
        if normalize(text):
            self._said.append((self.clock(), normalize(text)))

    def _own_voice(self, text: str) -> tuple[str, str] | None:
        """(what Igor said, what was heard after it), when this sentence
        starts with Igor's own words: its voice came back. An answer that
        only repeats some of them ("oui, tous les volets") starts otherwise."""
        heard = normalize(text).split()
        now = self.clock()
        for t, said in reversed(self._said):
            words = said.split()
            if now - t > OWN_VOICE_SECONDS or not heard or not words:
                continue
            head = " ".join(heard[: len(words)])
            if difflib.SequenceMatcher(None, head, " ".join(words)).ratio() >= OWN_VOICE_LIKENESS:
                return said, " ".join(heard[len(words):])
        return None

    def _spot(self, audio: np.ndarray):
        if self._spotting is None:
            return None

        def timed():
            started = time.monotonic()
            return self.spotter(audio), time.monotonic() - started
        return self._spotting.submit(timed)

    def waiting(self) -> bool:
        """Igor waits for words: after the name alone, or after its question."""
        now = self.clock()
        return (self._armed is not None and now <= self._armed_until) or (self.followup and now <= self._followup_until)

    def _remember(self, now: float, text: str) -> None:
        self._recent.append((now, text))

    def _ask_judge(self, now: float, text: str, entry: dict) -> tuple[bool, str]:
        """Smart mode, a sentence without the name: the local AI decides."""
        if not self.rules.looks_like_request(text):
            return False, "not_addressed"
        if not self.judge_allowed():
            return False, "media_playing"
        context = [(now - t, said) for t, said in self._recent if now - t <= CONTEXT_SECONDS]
        started = self.clock()
        verdict = self.judge(context, text)
        entry["judge_s"] = round(self.clock() - started, 2)
        entry["judge"] = verdict
        if not verdict:
            return False, "judged_not_for_igor" if verdict is False else "judge_unavailable"
        return (True, "smart") if self.judge_acts else (False, "smart_would_act")

    def _before(self, start: float | None) -> tuple[np.ndarray, str] | None:
        """The sentence that ended just before this one, if any."""
        if self._previous is None or start is None:
            return None
        audio, text, end = self._previous
        return (audio, text) if 0 <= start - end <= PREVIOUS_GAP else None

    def handle(self, audio: np.ndarray, more: Callable[[], np.ndarray | None] | None = None,
               start: float | None = None, end: float | None = None) -> dict:
        """One utterance. `more()` returns the next part of the same speech,
        if the speaker went on after a short pause, else None. `start` and
        `end` are on the stream's clock (seconds of audio read)."""
        previous, self._previous = self._previous, None
        entry: dict = {
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "audio_s": round(len(audio) / RATE, 2),
        }
        # Igor waits for an order: whatever is said is for it. The satellite
        # may still report its own "Je vous écoute" for a moment; that voice
        # is already kept out (the ear was closed, and own_voice below).
        waiting = self.waiting()
        if self.busy():
            if not waiting:
                entry.update(accepted=False, reason="satellite_busy")
                return entry
            entry["satellite_busy_ignored"] = True
        self._previous = previous
        spotting = self._spot(audio)
        heard = self._hear(audio)
        spot = None
        if spotting is not None:
            try:
                spot, seconds = spotting.result()
                entry["vosk_s"] = round(seconds, 2)
            except Exception as err:  # noqa: BLE001 - Whisper alone then
                entry["vosk_error"] = str(err)
        text = self._with_spotted_name(heard.text, spot, entry)
        now = self.clock()
        entry["stt_s"] = round(heard.seconds, 2)
        # Silence or noise is dropped. A doubtful transcription (low log
        # probability, common with the small models) is dropped too, unless
        # it carries the name: that is all that matters here, Igor gets the
        # audio itself.
        named = bool(self.rules.name.search(normalize(text)))
        noise = not text or heard.no_speech > (MAX_NO_SPEECH_NAME if named else MAX_NO_SPEECH) or (
            heard.logprob < MIN_LOGPROB and not named
        )
        if spot is not None and spot.found and named:
            noise = False  # Vosk heard the name too: a voice, whatever Whisper thinks
        if waiting:
            # An order after "Je vous écoute": a short answer ("le salon")
            # often gets Whisper's doubt; only near certain noise is dropped.
            norm = normalize(text)
            noise = not norm or heard.no_speech > MAX_NO_SPEECH_NAME or any(h in norm for h in HALLUCINATIONS)
        entry.update(no_speech=round(heard.no_speech, 2), logprob=round(heard.logprob, 2))

        armed = self._armed is not None and now <= self._armed_until
        followup_open = self.followup and now <= self._followup_until
        send = audio
        echo = None if noise else self._own_voice(text)
        if echo is not None:
            entry["igor_said"] = echo[0]
            if len(echo[1].split()) <= 1:
                # Igor hearing itself: dropped, and whatever it waits for still is.
                entry.update(accepted=False, reason="own_voice", text=text)
                return entry
            # Its voice, then someone speaking: the rules read what came after.
            text = echo[1]
        if noise:
            accepted, reason = False, "noise"
        elif armed:
            accepted, reason = True, "after_name"
            send = np.concatenate([self._armed, GAP, audio])
        else:
            decision = self.rules.decide(text, since_igor_spoke=0.0 if followup_open else None)
            accepted, reason = decision.accepted, decision.reason
            if reason == "near_name":
                reason = "name"
                entry["near_name"] = True
            before = self._before(start) if accepted and reason == "name" else None
            alone = self.rules.name_only(text)
            rest = self.rules.name.sub(" ", normalize(text))
            if (before is not None and self.rules.looks_like_request(before[1])
                    and not self.rules.looks_like_request(rest)):
                # "Éteins la lumière… Igor", "Éteins la lumière… du salon,
                # Igor": the order, or its start, was the sentence just before.
                send = np.concatenate([before[0], GAP, audio])
                entry["previous"] = before[1]
            elif accepted and reason == "name" and alone:
                self._armed, self._armed_until = audio, now + self.name_wait
                entry.update(accepted=False, reason="name_alone_waiting", text=text)
                if self.act is not None and self.on_name_alone is not None:
                    # Igor answers first; the wait starts once it is silent.
                    if self.on_heard is not None:
                        self.on_heard(False, None)
                    self.on_name_alone(self.rearm)
                elif self.act is not None and self.on_heard is not None:
                    self.on_heard(True, self.name_wait)
                self._remember(now, text)
                return entry
            if not accepted and reason == "not_addressed" and self.judge is not None:
                accepted, reason = self._ask_judge(now, text, entry)
        if not noise:
            self._armed = None
            self._remember(now, text)
        self._previous = None if accepted or noise or end is None else (audio, text, end)

        entry.update(accepted=accepted, reason=reason)
        if accepted or self.keep_rejected_text:
            entry["text"] = text
        if not accepted or self.act is None:
            return entry

        if self.on_heard is not None:
            self.on_heard(False, None)

        # The speaker may go on after a pause: join the rest first.
        joined = 0
        while more is not None and (part := more()) is not None:
            send = np.concatenate([send, GAP, part])
            joined += 1
        if joined:
            entry["joined"] = joined
        entry["sent_s"] = round(len(send) / RATE, 2)

        # Act: the audio itself goes to Igor through the Assist pipeline.
        conversation = self._conversation if reason == "followup" else None
        outcome = self.act(send, conversation)
        entry.update(sent=True, voxtral=outcome.heard, answer=outcome.speech)
        if outcome.error:
            entry["error"] = outcome.error
        if self.followup and outcome.continue_conversation:
            # Igor asked a question (and has finished saying it): the answer
            # is taken without the name, and the tablet shows it listens.
            self._followup_until = self.clock() + self.followup_seconds
            self._conversation = outcome.conversation_id
            if self.on_heard is not None:
                self.on_heard(True, self.followup_seconds)
        else:
            self._followup_until = float("-inf")
            self._conversation = None
        return entry
