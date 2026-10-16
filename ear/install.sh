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
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv"
"$APP/venv/bin/pip" install --quiet --upgrade pip
"$APP/venv/bin/pip" install --quiet -r "$HERE/requirements.txt"
if nvidia-smi >/dev/null 2>&1; then
    echo "== NVIDIA GPU found: CUDA libraries"
    "$APP/venv/bin/pip" install --quiet -r "$HERE/requirements-gpu.txt"
fi

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
