#!/bin/bash
# Start igor-ear from its virtual environment, with the CUDA libraries that
# pip installed on the library path (CTranslate2 looks for them there).
APP=$(cd "$(dirname "$0")" && pwd)
PY="$APP/venv/bin/python"
LIBS=$("$PY" -c '
import importlib, os
dirs = []
for name in ("nvidia.cublas.lib", "nvidia.cudnn.lib"):
    try:
        mod = importlib.import_module(name)
        dirs.append(os.path.dirname(mod.__file__) if getattr(mod, "__file__", None) else list(mod.__path__)[0])
    except Exception:
        pass
print(":".join(dirs))
' 2>/dev/null)
[ -n "$LIBS" ] && export LD_LIBRARY_PATH="$LIBS${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
cd "$APP" && exec "$PY" -m igor_ear "$@"
