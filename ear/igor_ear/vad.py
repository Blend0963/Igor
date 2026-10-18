"""Silero voice activity detection, the model faster-whisper ships with.

Run one frame at a time with its recurrent state kept between frames, on
the CPU: it costs about a millisecond per 32 ms frame.
"""
from __future__ import annotations

import os

import numpy as np

CONTEXT = 64  # samples of the previous frame the model expects in front
# Fed for minutes without a break, the model's recurrent state drifts with
# the room's noise until a short word ("Igor") no longer reaches the speech
# threshold: on the hub the name was heard for half a minute after a start,
# then no more, while louder, longer sentences still went through. The state
# is cleared after this much silence (and after each sentence).
FRESH_AFTER_S = 3.0
FRAME_S = 512 / 16000


class Vad:
    def __init__(self) -> None:
        import faster_whisper
        import onnxruntime

        assets = os.path.join(os.path.dirname(faster_whisper.__file__), "assets")
        model = next(
            os.path.join(assets, f) for f in sorted(os.listdir(assets)) if f.startswith("silero_vad") and f.endswith(".onnx")
        )
        options = onnxruntime.SessionOptions()
        options.inter_op_num_threads = 1
        options.intra_op_num_threads = 1
        self._session = onnxruntime.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])
        self.reset()

    def reset(self) -> None:
        self._h = np.zeros((1, 1, 128), dtype=np.float32)
        self._c = np.zeros((1, 1, 128), dtype=np.float32)
        self._context = np.zeros(CONTEXT, dtype=np.float32)
        self._quiet = 0

    def quiet(self) -> None:
        """One more frame outside any speech: after FRESH_AFTER_S of them,
        the state starts afresh."""
        self._quiet += 1
        if self._quiet * FRAME_S >= FRESH_AFTER_S:
            self.reset()

    def __call__(self, frame: np.ndarray) -> float:
        """Speech probability of one 512-sample float32 frame."""
        x = np.concatenate([self._context, frame]).reshape(1, -1)
        self._context = frame[-CONTEXT:]
        prob, self._h, self._c = self._session.run(None, {"input": x, "h": self._h, "c": self._c})
        return float(np.asarray(prob).reshape(-1)[0])
