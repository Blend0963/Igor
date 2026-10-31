"""Igor's answer said sentence by sentence, while it is still being written.

Home Assistant streams the answer (intent-progress events); waiting for the
end, then for the voice of the whole answer, made a long answer start late.
The first whole sentence is announced as soon as it is written; the next
ones follow in order, each heard to its end before the next is announced.
"""
from __future__ import annotations

import queue
import re
import threading
from collections.abc import Callable

# A sentence ends with . ! ? or … (a closing quote or bracket may follow),
# then a space: "3.5" or "M.Dupont" do not end one.
SENTENCE_END = re.compile(r'[.!?…]+["»)]?\s+')


class Sentences:
    """Cuts streamed text into sentences of at least `min_chars`: a short
    one ("Bien.") waits for the next, so the voice does not stutter."""

    def __init__(self, min_chars: int = 25) -> None:
        self.min_chars = min_chars
        self._buf = ""

    def push(self, text: str) -> list[str]:
        self._buf += text
        out: list[str] = []
        while True:
            cut = next((m.end() for m in SENTENCE_END.finditer(self._buf)
                        if len(self._buf[:m.end()].strip()) >= self.min_chars), None)
            if cut is None:
                return out
            out.append(self._buf[:cut].strip())
            self._buf = self._buf[cut:]

    def rest(self) -> str:
        rest, self._buf = self._buf.strip(), ""
        return rest


class Speaker:
    """Says sentences in order on its own thread, inside one `voice.say`
    (the ear stays closed from the first to the last)."""

    def __init__(self, say_one: Callable[[str], None], voice) -> None:
        self.say_one, self.voice = say_one, voice
        self.errors: list[str] = []
        self._queue: queue.Queue[str | None] = queue.Queue()
        self._thread: threading.Thread | None = None

    @property
    def started(self) -> bool:
        return self._thread is not None

    def add(self, sentence: str) -> None:
        if not sentence.strip():
            return
        self._queue.put(sentence.strip())
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()

    def finish(self, timeout: float = 180) -> None:
        """No more sentences: wait until the last one is said."""
        if self._thread is not None:
            self._queue.put(None)
            self._thread.join(timeout)

    def _run(self) -> None:
        def speak_all() -> None:
            while (sentence := self._queue.get()) is not None:
                began = self.voice.clock()
                try:
                    self.say_one(sentence)
                except Exception as err:  # noqa: BLE001 - the next sentence may still go
                    self.errors.append(str(err))
                    continue
                self.voice.between(began)

        self.voice.say(speak_all)
