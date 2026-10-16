import numpy as np

from mado_ear.segmenter import FRAME, Segmenter


def feed(seg, probs):
    out = []
    for p in probs:
        u = seg.push(np.full(FRAME, p, dtype=np.float32), p)
        if u is not None:
            out.append(u)
    return out


def test_one_utterance_with_preroll():
    seg = Segmenter()
    probs = [0.0] * 20 + [0.9] * 40 + [0.0] * 30
    (u,) = feed(seg, probs)
    # pre-roll (10 frames, the last 3 of them speech) + speech + the closing silence
    assert len(u) == FRAME * (10 + 37 + seg.end_frames)


def test_too_short_is_dropped():
    assert feed(Segmenter(), [0.9] * 5 + [0.0] * 40) == []


def test_long_speech_is_cut():
    seg = Segmenter(max_utterance_s=2)
    out = feed(seg, [0.9] * 200)
    assert len(out) >= 2


def test_short_pause_keeps_one_utterance():
    probs = [0.9] * 20 + [0.1] * 10 + [0.9] * 20 + [0.0] * 30
    assert len(feed(Segmenter(), probs)) == 1
