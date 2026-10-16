"""Make CTranslate2 3.24 load the pip cuDNN 8 instead of its own core.

The CTranslate2 3.24 wheel bundles only cuDNN's 8.1 core library, renamed
libcudnn-<hash>.so.8.1.1, and leaves out the parts that core opens at run
time (libcudnn_ops_infer.so.8, libcudnn_cnn_infer.so.8…). With the pip
nvidia-cudnn-cu11 parts on the library path, an 8.1 core meets 8.9 parts
and the process dies at the first GPU computation (segmentation fault);
without them, the parts are missing. Renaming the dependency to
libcudnn.so.8 in libctranslate2 makes the whole of cuDNN come from pip, in
one version. The new name is shorter, so it is written in place over the
old one in the string table (padded with zero bytes); nothing moves.

    python use_pip_cudnn.py /path/to/libctranslate2-*.so.3.24.0
"""
from __future__ import annotations

import re
import sys

BUNDLED = re.compile(rb"\x00(libcudnn-[0-9a-f]{8}\.so\.8(?:\.\d+)*)\x00")
WANTED = b"libcudnn.so.8"


def relink(path: str) -> bool:
    with open(path, "r+b") as f:
        data = f.read()
        match = BUNDLED.search(data)
        if not match:
            return False
        old = match.group(1)
        f.seek(match.start(1))
        f.write(WANTED + b"\x00" * (len(old) - len(WANTED)))
    return True


if __name__ == "__main__":
    for name in sys.argv[1:]:
        if relink(name):
            print(f"   cuDNN now taken from pip: {name}")
