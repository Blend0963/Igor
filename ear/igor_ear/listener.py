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

import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import numpy as np

from .addressing import NAME, Addressing, name_only, normalize

RATE = 16000
GAP = np.zeros(RATE // 5, dtype=np.float32)  # 0.2 s between "Igor" and the order

# Longer than this, only the head and the tail are transcribed for the name.
LONG_S = 16.0
HEAD_S = 8.0
TAIL_S = 6.0

# What the smart judge is shown of the conversation before a sentence.
CONTEXT_SENTENCES = 4
CONTEXT_SECONDS = 90.0

# Below these, Whisper is guessing words into noise.
MAX_NO_SPEECH = 0.6
MIN_LOGPROB = -1.0


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
        judge: Callable[[list[tuple[float, str]], str], bool | None] | None = None,
        judge_allowed: Callable[[], bool] = lambda: True,
        judge_acts: bool = False,
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
        # Smart mode: the judge, whether it may judge now (no television
        # sounding), and whether its "yes" acts or is only noted.
        self.judge, self.judge_allowed, self.judge_acts = judge, judge_allowed, judge_acts
        self._recent: deque[tuple[float, str]] = deque(maxlen=CONTEXT_SENTENCES)
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

    def handle(self, audio: np.ndarray, more: Callable[[], np.ndarray | None] | None = None) -> dict:
        """One utterance. `more()` returns the next part of the same speech,
        if the speaker went on after a short pause, else None."""
        entry: dict = {
            "time": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "audio_s": round(len(audio) / RATE, 2),
        }
        if self.busy():
            entry.update(accepted=False, reason="satellite_busy")
            return entry
        heard = self._hear(audio)
        now = self.clock()
        entry["stt_s"] = round(heard.seconds, 2)
        # Silence or noise is dropped. A doubtful transcription (low log
        # probability, common with the small models) is dropped too, unless
        # it carries the name: that is all that matters here, Igor gets the
        # audio itself.
        noise = not heard.text or heard.no_speech > MAX_NO_SPEECH or (
            heard.logprob < MIN_LOGPROB and not NAME.search(normalize(heard.text))
        )

        armed = self._armed is not None and now <= self._armed_until
        followup_open = self.followup and now <= self._followup_until
        send = audio
        if noise:
            accepted, reason = False, "noise"
        elif armed:
            accepted, reason = True, "after_name"
            send = np.concatenate([self._armed, GAP, audio])
        else:
            decision = self.rules.decide(heard.text, since_igor_spoke=0.0 if followup_open else None)
            accepted, reason = decision.accepted, decision.reason
            if accepted and reason == "name" and name_only(heard.text):
                self._armed, self._armed_until = audio, now + self.name_wait
                entry.update(accepted=False, reason="name_alone_waiting", text=heard.text)
                if self.act is not None and self.on_heard is not None:
                    self.on_heard(True, self.name_wait)
                self._remember(now, heard.text)
                return entry
            if not accepted and reason == "not_addressed" and self.judge is not None:
                accepted, reason = self._ask_judge(now, heard.text, entry)
        if not noise:
            self._armed = None
            self._remember(now, heard.text)

        entry.update(accepted=accepted, reason=reason)
        if accepted or self.keep_rejected_text:
            entry["text"] = heard.text
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
