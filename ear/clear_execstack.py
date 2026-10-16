"""Clear the "executable stack" flag of ELF shared libraries.

glibc 2.41 (Debian 13) refuses to load a library whose PT_GNU_STACK program
header asks for an executable stack ("cannot enable executable stack as
shared object requires: Invalid argument"). The CTranslate2 3.24 wheel's
libctranslate2 carries that flag from its build, without needing it. This
clears the X bit of that one header, in place; nothing else changes.

    python clear_execstack.py FILE...
"""
from __future__ import annotations

import struct
import sys

PT_GNU_STACK = 0x6474E551
PF_X = 0x1


def clear(path: str) -> bool:
    """Return True if the flag was set and is now cleared."""
    with open(path, "r+b") as f:
        ident = f.read(16)
        if ident[:4] != b"\x7fELF" or ident[4] != 2:  # 64-bit ELF only
            return False
        end = "<" if ident[5] == 1 else ">"
        f.seek(0x20)
        (phoff,) = struct.unpack(end + "Q", f.read(8))
        f.seek(0x36)
        phentsize, phnum = struct.unpack(end + "HH", f.read(4))
        for i in range(phnum):
            base = phoff + i * phentsize
            f.seek(base)
            p_type, p_flags = struct.unpack(end + "II", f.read(8))
            if p_type == PT_GNU_STACK and p_flags & PF_X:
                f.seek(base + 4)
                f.write(struct.pack(end + "I", p_flags & ~PF_X))
                return True
    return False


if __name__ == "__main__":
    for name in sys.argv[1:]:
        if clear(name):
            print(f"   executable stack cleared: {name}")
