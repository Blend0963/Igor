#!/bin/bash
# Install or update mado-ear for the current user. Run it as your normal
# user (not root) from a checkout of the MaDo repository:
#   bash ~/MaDo/ear/install.sh
set -euo pipefail
if [ "$(id -u)" -eq 0 ]; then
    echo "Run this as your normal user, not root."
    exit 1
fi
HERE=$(cd "$(dirname "$0")" && pwd)
APP="$HOME/.local/share/mado-ear"
CONF="$HOME/.config/mado-ear"

echo "== System packages (sudo)"
sudo apt-get install -y python3-venv pulseaudio-utils

echo "== Python environment in $APP/venv"
mkdir -p "$APP"
# /tmp is a RAM disk of half the memory on Debian 13: too small for the CUDA
# wheels (cuDNN alone unpacks to well over a gigabyte). Unpack on disk instead.
export TMPDIR="$APP/tmp"
mkdir -p "$TMPDIR"
trap 'rm -rf "$TMPDIR"' EXIT
# Which stack: a Maxwell GPU (compute capability below 6.0, like the GTX 960)
# needs CTranslate2 3.24 on Python 3.12 with CUDA 11; anything else gets the
# current one.
STACK=standard
CAP=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 || true)
if [ -n "$CAP" ] && awk -v c="$CAP" 'BEGIN { exit !(c < 6.0) }'; then
    STACK=maxwell
fi
echo "   GPU compute capability: ${CAP:-none}; stack: $STACK"
# A venv built for the other stack, or before stacks were recorded, is rebuilt.
if [ -d "$APP/venv" ] && [ "$(cat "$APP/venv/.mado-stack" 2>/dev/null)" != "$STACK" ]; then
    echo "   rebuilding the Python environment for the $STACK stack"
    rm -rf "$APP/venv"
fi

if [ "$STACK" = maxwell ]; then
    # uv brings its own Python 3.12, kept inside the app folder.
    [ -x "$APP/uv/bin/uv" ] || { python3 -m venv "$APP/uv" && "$APP/uv/bin/pip" install --quiet uv; }
    export UV_PYTHON_INSTALL_DIR="$APP/python"
    [ -x "$APP/venv/bin/python" ] || "$APP/uv/bin/uv" venv --quiet --python 3.12 "$APP/venv"
    VIRTUAL_ENV="$APP/venv" "$APP/uv/bin/uv" pip install --quiet --no-cache -r "$HERE/requirements-maxwell.txt"
    VIRTUAL_ENV="$APP/venv" "$APP/uv/bin/uv" pip install --quiet --no-cache --no-deps "faster-whisper==1.2.1"
else
    [ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
    "$APP/venv/bin/pip" install --quiet --upgrade pip
    "$APP/venv/bin/pip" install --quiet --no-cache-dir -r "$HERE/requirements.txt"
    if [ -n "$CAP" ]; then
        echo "== NVIDIA GPU found: CUDA libraries"
        "$APP/venv/bin/pip" install --quiet --no-cache-dir -r "$HERE/requirements-gpu.txt"
    fi
fi
echo "$STACK" > "$APP/venv/.mado-stack"

echo "== Program"
rm -rf "$APP/mado_ear"
cp -r "$HERE/mado_ear" "$APP/"
install -m 755 "$HERE/run.sh" "$APP/run.sh"
mkdir -p "$CONF"
if [ ! -f "$CONF/config.toml" ]; then
    install -m 600 "$HERE/config.example.toml" "$CONF/config.toml"
    echo "   settings written to $CONF/config.toml"
fi
mkdir -p "$HOME/.config/systemd/user"
install -m 644 "$HERE/mado-ear.service" "$HOME/.config/systemd/user/mado-ear.service"
# Keep the user's services running without a login session.
sudo loginctl enable-linger "$USER"
systemctl --user daemon-reload

cat <<MSG

Installed. Next:
  1. Test:   $APP/run.sh bench          (speak during the 5 seconds)
  2. Start:  systemctl --user enable --now mado-ear
  3. Watch:  journalctl --user -u mado-ear -f
  4. Later:  $APP/run.sh report
MSG
