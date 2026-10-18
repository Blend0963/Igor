import numpy as np

from igor_ear.segmenter import FRAME, Segmenter


def feed(seg, probs):
    out = []
    for p in probs:
        u = seg.push(np.full(FRAME, p, dtype=np.float32), p)
        if u is not None:
            out.append(u.audio)
    return out


def test_one_utterance_with_preroll():
    seg = Segmenter()
    probs = [0.0] * 20 + [0.9] * 40 + [0.0] * 30
    (u,) = feed(seg, probs)
    preroll = seg._preroll.maxlen   # 22 frames (700 ms), the last 3 of them speech
    assert len(u) == FRAME * (preroll + 37 + seg.end_frames)


def test_too_short_is_dropped():
    assert feed(Segmenter(), [0.9] * 5 + [0.0] * 40) == []


def test_the_name_alone_is_kept():
    # "Igor" said before a pause: about a third of a second of speech.
    assert len(feed(Segmenter(), [0.0] * 30 + [0.9] * 10 + [0.0] * 40)) == 1


def test_long_speech_is_cut():
    seg = Segmenter(max_utterance_s=2)
    out = feed(seg, [0.9] * 200)
    assert len(out) >= 2


def test_short_pause_keeps_one_utterance():
    probs = [0.9] * 20 + [0.1] * 10 + [0.9] * 20 + [0.0] * 30
    assert len(feed(Segmenter(), probs)) == 1


def test_times_on_the_stream_clock():
    seg = Segmenter()
    probs = [0.0] * 20 + [0.9] * 40 + [0.0] * 30
    got = None
    for p in probs:
        u = seg.push(np.zeros(FRAME, dtype=np.float32), p)
        got = u or got
    frame_s = FRAME / 16000
    assert abs(got.start - (23 - seg._preroll.maxlen) * frame_s) < 1e-9   # pre-roll included
    assert abs(got.end - (60 + seg.end_frames) * frame_s) < 1e-9
    assert abs(got.end - got.start - len(got.audio) / 16000) < 1e-9


def test_a_minute_fits_in_one_utterance():
    assert len(feed(Segmenter(), [0.9] * 1500 + [0.0] * 30)) == 1  # 48 s


def test_the_voice_detector_starts_afresh_after_silence():
    from igor_ear import vad as vad_module

    v = vad_module.Vad.__new__(vad_module.Vad)
    v.reset()
    v._h += 1.0                               # some state from the room
    import math

    for _ in range(math.ceil(vad_module.FRESH_AFTER_S / vad_module.FRAME_S) - 1):
        v.quiet()
    assert v._h.any()                         # not yet
    v.quiet()
    assert not v._h.any() and v._quiet == 0   # cleared after 3 s of silence
