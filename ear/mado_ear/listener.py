"""What to do with each sentence heard.

Kept apart from the microphone and from Home Assistant so it can be tested
with fakes. For each utterance:

1. linux-voice-assistant busy (listening after its wake word, thinking,
   speaking)? Ignored: it is handling the request, or it is MaDo's own voice.
2. Local transcription (Whisper small), only to find the name.
3. "MaDo" anywhere in the sentence: taken. "MaDo" alone ("MaDo ?"): the
   next sentence, within a few seconds, is the order, and both are sent
   together. Right after MaDo asked a question, the answer is taken without
   the name (follow-up).
4. Taken, in act mode: if the speaker goes on after a short pause, the rest
   is joined first (`more`). Then the recorded audio (not Whisper's words)
   goes to the Assist pipeline, so Voxtral hears all of it properly, and the
   satellite says MaDo's answer. In observation mode it is only noted.

A long sentence is not transcribed in full just to find the name: its first
8 and last 6 seconds are, where "MaDo" is said in practice.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable

import numpy as np

from .addressing import NAME, Addressing, name_only, normalize

RATE = 16000
GAP = np.zeros(RATE // 5, dtype=np.float32)  # 0.2 s between "MaDo" and the order

# Longer than this, only the head and the tail are transcribed for the name.
LONG_S = 16.0
HEAD_S = 8.0
TAIL_S = 6.0

# Below these, Whisper is guessing words into noise.
MAX_NO_SPEECH = 0.6
MIN_LOGPROB = -1.0


@dataclass
class Outcome:
    """What MaDo did with a sentence sent to it."""

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
    ) -> None:
        self.stt, self.rules, self.act, self.busy = stt, rules, act, busy
        self.followup, self.followup_seconds, self.name_wait = followup, followup_seconds, name_wait
        self.keep_rejected_text = keep_rejected_text
        self.clock = clock
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
        # it carries the name: that is all that matters here, MaDo gets the
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
            decision = self.rules.decide(heard.text, since_mado_spoke=0.0 if followup_open else None)
            accepted, reason = decision.accepted, decision.reason
            if accepted and reason == "name" and name_only(heard.text):
                self._armed, self._armed_until = audio, now + self.name_wait
                entry.update(accepted=False, reason="name_alone_waiting", text=heard.text)
                return entry
        if not noise:
            self._armed = None

        entry.update(accepted=accepted, reason=reason)
        if accepted or self.keep_rejected_text:
            entry["text"] = heard.text
        if not accepted or self.act is None:
            return entry

        # The speaker may go on after a pause: join the rest first.
        joined = 0
        while more is not None and (part := more()) is not None:
            send = np.concatenate([send, GAP, part])
            joined += 1
        if joined:
            entry["joined"] = joined
        entry["sent_s"] = round(len(send) / RATE, 2)

        # Act: the audio itself goes to MaDo through the Assist pipeline.
        conversation = self._conversation if reason == "followup" else None
        outcome = self.act(send, conversation)
        entry.update(sent=True, voxtral=outcome.heard, answer=outcome.speech)
        if outcome.error:
            entry["error"] = outcome.error
        if self.followup and outcome.continue_conversation:
            self._followup_until = self.clock() + self.followup_seconds
            self._conversation = outcome.conversation_id
        else:
            self._followup_until = float("-inf")
            self._conversation = None
        return entry
