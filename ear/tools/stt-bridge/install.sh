#!/usr/bin/env bash
# Igor — la reconnaissance vocale de Home Assistant sur la carte graphique.
# Installe bridge.py comme service (igor-stt) : Home Assistant lui envoie
# l'audio (protocole Wyoming, port 10300), il le passe au whisper-server de
# cette VM (Radeon VII) et renvoie le texte. Rien ne sort de la maison.
# Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, rien d'autre n'est fait.
#   bash install.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$HOME/.local/share/igor-stt"
UNIT="$HOME/.config/systemd/user/igor-stt.service"
WHISPER=http://127.0.0.1:8178
PORT=10300

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; exit 1; }

step "1/6 Utilisateur"
[ "$(id -u)" -ne 0 ] || fail "lance ce script avec ton utilisateur habituel, pas root"
[ -f "$HERE/bridge.py" ] || fail "bridge.py doit être dans le même dossier que install.sh"
ok "$USER"

step "2/6 whisper-server"
code=$(curl -s -o /dev/null -w '%{http_code}' "$WHISPER/" || true)
[ -n "$code" ] && [ "$code" != 000 ] || fail "whisper-server ne répond pas sur $WHISPER (systemctl --user status whisper-server)"
ok "répond sur $WHISPER"

step "3/6 Environnement Python"
mkdir -p "$APP"
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv" || fail "python3 -m venv (sudo apt install python3-venv)"
"$APP/venv/bin/pip" install --quiet --upgrade "wyoming>=1.5,<2" || fail "installation de wyoming"
cp "$HERE/bridge.py" "$APP/bridge.py" || fail "copie de bridge.py"
ok "$APP"

step "4/6 Service igor-stt"
if ! systemctl --user is-active --quiet igor-stt && (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  fail "le port $PORT est déjà pris"
fi
mkdir -p "$(dirname "$UNIT")"
cat >"$UNIT" <<UNIT
[Unit]
Description=Igor speech-to-text for Home Assistant (Wyoming → whisper.cpp on the GPU)
After=whisper-server.service
Wants=whisper-server.service

[Service]
ExecStart=$APP/venv/bin/python -I $APP/bridge.py --uri tcp://0.0.0.0:$PORT --whisper $WHISPER --language fr
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload || fail "systemctl --user daemon-reload"
systemctl --user enable igor-stt >/dev/null 2>&1 || fail "activation au démarrage"
systemctl --user restart igor-stt || fail "démarrage (voir : journalctl --user -u igor-stt -n 30)"
ok "$UNIT"

step "5/6 Essai"
sleep 2
name=$("$APP/venv/bin/python" -I - "$PORT" <<'PY' 2>/dev/null
import asyncio, sys
from wyoming.client import AsyncTcpClient
from wyoming.info import Describe, Info
async def main():
    async with AsyncTcpClient("127.0.0.1", int(sys.argv[1])) as client:
        await client.write_event(Describe().event())
        print(Info.from_event(await client.read_event()).asr[0].name)
asyncio.run(main())
PY
)
[ "$name" = igor-stt ] || fail "le service ne répond pas (voir : journalctl --user -u igor-stt -n 30)"
ok "le service répond (igor-stt)"

step "6/6 Démarrage avec la VM"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then
  ok "déjà actif"
else
  sudo loginctl enable-linger "$USER" || fail "sudo loginctl enable-linger $USER"
  ok "activé"
fi

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
printf '\nTerminé. Dans Home Assistant : Paramètres → Appareils et services → Ajouter une intégration →\n'
printf 'Wyoming Protocol, hôte %s, port %s.\n' "${ip:-<ip-de-la-vm>}" "$PORT"
