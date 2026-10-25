"""The television's words, compared with what the microphone heard."""
import numpy as np

from igor_ear.reference import FRAME, RATE, Reference, merge_parts, tv_flags


def w(word, start, end):
    return {"word": word, "start": start, "end": end}


def word(text, start, end):
    from igor_ear.addressing import normalize
    return (text, start, end, normalize(text))


def test_fragments_of_one_word_are_joined():
    parts = [(0.0, 1.0, "allume la", [w(" all", 0.1, 0.3), w("ume", 0.3, 0.5), w(" la", 0.5, 0.7)])]
    assert [x[0] for x in merge_parts(parts)] == ["allume", "la"]
    assert merge_parts(parts)[0][1:3] == (0.1, 0.5)


def test_a_new_piece_starts_a_new_word():
    parts = [(0.0, 1.0, "a", [w(" Igor", 0.1, 0.4)]), (1.0, 2.0, "b", [w("ume", 1.1, 1.4)])]
    assert [x[0] for x in merge_parts(parts)] == ["Igor", "ume"]


def test_pieces_without_words_give_nothing():
    assert merge_parts([(0.0, 1.0, "text")]) == []
    assert merge_parts([]) == []


def test_punctuation_stays_with_its_word_and_is_not_part_of_the_match():
    parts = [(0.0, 1.0, "x", [w(" Igor", 0.1, 0.4), w(",", 0.4, 0.4), w(" quelle", 0.5, 0.8)])]
    words = merge_parts(parts)
    assert [x[0] for x in words] == ["Igor,", "quelle"] and words[0][3] == "igor"


def test_television_words_are_flagged_where_it_said_them():
    tv = [word(t, i * 0.4, i * 0.4 + 0.3) for i, t in enumerate("on va pas se faire ban".split())]
    mic = [word("on", 0.0, 0.3), word("va", 0.4, 0.7), word("pas", 0.8, 1.1), word("faire", 1.6, 1.9),
           word("ban", 2.0, 2.3), word("Igor", 3.0, 3.4)]
    assert tv_flags(mic, tv) == [True, True, True, True, True, False]


def test_a_word_the_other_hearing_missed_is_filled_in():
    tv = [word(t, i * 0.4, i * 0.4 + 0.3) for i, t in enumerate("on va pas faire ban".split())]
    mic = [word("on", 0.0, 0.3), word("va", 0.4, 0.7), word("euh", 0.8, 1.0), word("pas", 1.2, 1.4),
           word("faire", 1.6, 1.9), word("ban", 2.0, 2.3)]
    assert all(tv_flags(mic, tv))


def test_one_short_common_word_proves_nothing():
    tv = [word("la", 1.0, 1.2)]
    mic = [word("allume", 0.0, 0.4), word("la", 0.5, 0.7), word("lumière", 0.8, 1.2)]
    assert tv_flags(mic, tv) == [False, False, False]


def test_a_word_said_far_from_the_microphones_moment_is_not_the_television():
    tv = [word("lumière", 30.0, 30.5)]
    mic = [word("lumière", 1.0, 1.5)]
    assert tv_flags(mic, tv) == [False]


def test_the_name_is_never_flagged():
    tv = [word("Igor", 1.0, 1.4), word("Igor", 1.5, 1.9)]
    mic = [word("Igor", 1.0, 1.4), word("Igor", 1.5, 1.9)]
    assert tv_flags(mic, tv, keep={0, 1}) == [False, False]


def test_reference_returns_what_was_heard_between_two_moments():
    ref = Reference("unused")
    for i in range(10):
        ref._ring.append((100.0 + i * FRAME / RATE, np.full(FRAME, i, dtype=np.float32)))
    got = ref.audio(100.0 + 2 * FRAME / RATE, 100.0 + 5 * FRAME / RATE)
    assert sorted(set(got.tolist())) == [3.0, 4.0, 5.0, 6.0]
    assert ref.audio(500.0, 501.0) is None
