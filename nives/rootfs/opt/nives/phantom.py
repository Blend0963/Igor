"""What speech-to-text writes when nobody spoke.

Whisper-like models, fed silence or a hum, write the credits of the videos
they learnt from: « Sous-titrage ST' 501 », « Sous-titres réalisés par la
communauté d'Amara.org », « Merci d'avoir regardé »… Such a line is never a
request: Igor hears nothing, answers nothing and does nothing.
"""

from __future__ import annotations

import math
import re
import struct
import unicodedata

# Anywhere in what was heard: the credits of a video, never said to a house.
CREDITS = (
    "sous-titrage", "sous-titres", "sous titrage", "sous titres", "soustitrage", "st' 501", "st 501",
    "amara.org", "amara org", "radio-canada", "radio canada", "merci d'avoir regarde", "merci de votre attention",
    "abonnez-vous", "abonnez vous", "n'oubliez pas de vous abonner", "likez", "a la prochaine video",
    "a bientot pour une nouvelle video", "thanks for watching", "thank you for watching", "subtitles by",
    "subtitled by", "please subscribe", "transcription by", "www.", ".com", "zeoranger", "castingwords",
)
# The whole of what was heard: a word alone that silence turns into.
ALONE = {
    "", "merci", "merci beaucoup", "merci a tous", "merci a vous", "bonsoir", "musique", "applaudissements",
    "rires", "silence", "you", "thank you", "thanks", "bye", "okay", "ok", "hmm", "euh", "ah", "oh",
}
_NOT_WORDS = re.compile(r"[^\w' .-]+")


def normalize(text: str) -> str:
    s = unicodedata.normalize("NFKD", str(text or "").lower())
    s = "".join(c for c in s if not unicodedata.combining(c)).replace("’", "'")
    s = _NOT_WORDS.sub(" ", s)
    return re.sub(r"\s+", " ", s).strip(" .-'")


def is_phantom(text: str | None) -> bool:
    """True when what was heard is what silence sounds like to the model."""
    norm = normalize(text or "")
    if norm in ALONE:
        return True
    # [Musique], (rires), ♪…: only sounds, no words.
    if re.fullmatch(r"[\[\(].*[\]\)]", str(text or "").strip()):
        return True
    return any(c in norm for c in CREDITS)


def loudest_dbfs(pcm: bytes, sample_rate: int = 16000, bits: int = 16, window_ms: int = 30) -> float:
    """The loudest 30 ms of a recording, in dB below full scale."""
    if bits != 16 or len(pcm) < 2:
        return 0.0
    n = len(pcm) // 2
    samples = struct.unpack("<%dh" % n, pcm[: n * 2])
    win = max(1, sample_rate * window_ms // 1000)
    best = 0.0
    for i in range(0, n, win):
        chunk = samples[i : i + win]
        if chunk:
            best = max(best, sum(s * s for s in chunk) / len(chunk))
    return -120.0 if best <= 0 else 10 * math.log10(best / (32768.0 ** 2))


# Below this, the loudest moment of the recording is silence, not a voice
# (a voice near a microphone is above -35 dBFS; a quiet room around -60).
SILENCE_DBFS = -55.0
