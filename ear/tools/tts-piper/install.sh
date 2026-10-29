#!/usr/bin/env bash
# Igor — la voix de Home Assistant sur la VM, avec Piper.
# Installe wyoming-piper (le serveur Piper officiel de Home Assistant) comme
# service (igor-tts, port 10200). Il tourne sur le processeur : la carte
# graphique ne travaille pas. Rien ne sort de la maison.
# Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, rien d'autre n'est fait.
#   bash install.sh                      voix masculine fr_FR-tom-medium
#   bash install.sh fr_FR-siwis-medium   une autre voix
set -u
VOICE="${1:-fr_FR-tom-medium}"
APP="$HOME/.local/share/igor-tts"
UNIT="$HOME/.config/systemd/user/igor-tts.service"
PORT=10200

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; exit 1; }

step "1/5 Utilisateur"
[ "$(id -u)" -ne 0 ] || fail "lance ce script avec ton utilisateur habituel, pas root"
ok "$USER, voix $VOICE"

step "2/5 Piper"
mkdir -p "$APP/voices"
[ -x "$APP/venv/bin/python" ] || python3 -m venv "$APP/venv" || fail "python3 -m venv (sudo apt install python3-venv)"
"$APP/venv/bin/pip" install --quiet --upgrade "wyoming-piper>=2.5,<3" || fail "installation de wyoming-piper"
ok "$APP"

step "3/5 Service igor-tts"
if ! systemctl --user is-active --quiet igor-tts && (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null; then
  fail "le port $PORT est déjà pris"
fi
mkdir -p "$(dirname "$UNIT")"
cat >"$UNIT" <<UNIT
[Unit]
Description=Igor text-to-speech for Home Assistant (Piper, Wyoming)
After=network-online.target

[Service]
ExecStart=$APP/venv/bin/python -m wyoming_piper --voice $VOICE --uri tcp://0.0.0.0:$PORT --data-dir $APP/voices
Restart=always
RestartSec=5
# La voix d'abord, mais sans gêner le son et le Bluetooth de la VM.
Nice=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload || fail "systemctl --user daemon-reload"
systemctl --user enable igor-tts >/dev/null 2>&1 || fail "activation au démarrage"
systemctl --user restart igor-tts || fail "démarrage (voir : journalctl --user -u igor-tts -n 30)"
ok "$UNIT"

step "4/5 Essai (la voix se télécharge la première fois)"
result=$("$APP/venv/bin/python" -I - "$PORT" <<'PY' 2>&1
import asyncio, sys, time
from wyoming.client import AsyncTcpClient
from wyoming.tts import Synthesize
from wyoming.audio import AudioChunk, AudioStop
async def main():
    port = int(sys.argv[1])
    for _ in range(180):
        try:
            started, size = time.time(), 0
            async with AsyncTcpClient("127.0.0.1", port) as client:
                await client.write_event(Synthesize(text="Bonsoir, je suis prêt.").event())
                while True:
                    event = await client.read_event()
                    if event is None:
                        raise OSError("closed")
                    if AudioChunk.is_type(event.type):
                        size += len(AudioChunk.from_event(event).audio)
                    if AudioStop.is_type(event.type):
                        break
            print(f"{size} octets en {time.time() - started:.1f} s")
            return
        except OSError:
            await asyncio.sleep(1)
    print("pas de réponse")
asyncio.run(main())
PY
)
case "$result" in *octets*) ok "synthèse : $result";; *) fail "pas de son (voir : journalctl --user -u igor-tts -n 30)";; esac

step "5/5 Démarrage avec la VM"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then
  ok "déjà actif"
else
  sudo loginctl enable-linger "$USER" || fail "sudo loginctl enable-linger $USER"
  ok "activé"
fi

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
printf '\nTerminé. Dans Home Assistant : Paramètres → Appareils et services → Ajouter une intégration →\n'
printf 'Wyoming Protocol, hôte %s, port %s.\n' "${ip:-<ip-de-la-vm>}" "$PORT"
