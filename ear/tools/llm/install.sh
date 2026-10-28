#!/usr/bin/env bash
# Igor — modèle de langage local pour la voix : installation du service.
# Fait de llama-server (compilé par ../llm-bench/setup.sh) un service qui
# démarre avec la VM, comme whisper-server : Qwen3 8B Q4_K_M sur la Radeon VII,
# joignable par Home Assistant sur le réseau local, protégé par une clé.
# La clé reste dans ~/.config/igor-llm/api-key ; ce script ne l'affiche jamais.
# Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, rien d'autre n'est fait.
#   bash install.sh
set -u
SERVER="$HOME/llama.cpp/build/bin/llama-server"
BENCH_MODEL="$HOME/igor-bench/models/qwen3-8b.gguf"
APP="$HOME/.local/share/igor-llm"
MODEL="$APP/qwen3-8b-q4_k_m.gguf"
CONF="$HOME/.config/igor-llm"
KEY="$CONF/api-key"
UNIT="$HOME/.config/systemd/user/igor-llm.service"
PORT=8180

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; exit 1; }

step "1/7 Utilisateur"
[ "$(id -u)" -ne 0 ] || fail "lance ce script avec ton utilisateur habituel, pas root"
ok "$USER"

step "2/7 llama-server"
[ -x "$SERVER" ] || fail "$SERVER absent : lance d'abord bash ../llm-bench/setup.sh"
"$SERVER" --help 2>/dev/null | grep -q -- "--api-key-file" || fail "llama-server trop ancien (pas de --api-key-file) : supprime ~/llama.cpp et relance setup.sh"
ok "$SERVER"

step "3/7 Modèle Qwen3 8B Q4_K_M"
mkdir -p "$APP"
if [ -s "$MODEL" ]; then
  ok "déjà en place ($(du -h "$MODEL" | cut -f1))"
else
  [ -s "$BENCH_MODEL" ] || fail "$BENCH_MODEL absent : lance d'abord bash ../llm-bench/setup.sh"
  # Un lien dur ne prend pas de place en plus ; une copie si le disque diffère.
  ln "$BENCH_MODEL" "$MODEL" 2>/dev/null || cp "$BENCH_MODEL" "$MODEL" || fail "copie du modèle dans $APP"
  ok "$MODEL ($(du -h "$MODEL" | cut -f1))"
fi

step "4/7 Clé d'accès"
mkdir -p "$CONF" && chmod 700 "$CONF"
if [ -s "$KEY" ]; then
  ok "déjà créée, gardée telle quelle"
else
  (umask 077 && python3 -c "import secrets; print(secrets.token_urlsafe(32))" >"$KEY") || fail "création de $KEY"
  ok "créée dans $KEY (non affichée)"
fi
chmod 600 "$KEY"

step "5/7 Service igor-llm"
if ! systemctl --user is-active --quiet igor-llm && curl -s -o /dev/null "http://127.0.0.1:$PORT/health"; then
  fail "le port $PORT est déjà pris (le banc d'essai tourne encore ?) : arrête-le, puis relance"
fi
mkdir -p "$(dirname "$UNIT")"
cat >"$UNIT" <<UNIT
[Unit]
Description=Igor local language model (llama.cpp, Vulkan, Radeon VII)
After=network-online.target

[Service]
# Deux places de 16 384 tokens : la conversation garde la sienne, et donc son
# début déjà lu en cache, pendant que ce qu'Igor retient de la conversation ou
# la vérification du destinataire passent dans l'autre. --cache-ram garde en
# mémoire vive un prompt déjà lu qu'une autre demande a chassé de sa place.
# Sans réflexion : la voix attend une phrase, vite.
ExecStart=$SERVER -m $MODEL --host 0.0.0.0 --port $PORT -ngl 99 -c 32768 -np 2 --cache-ram 2048 --jinja --reasoning-budget 0 --chat-template-kwargs '{"enable_thinking":false}' --api-key-file $KEY --no-webui
Restart=always
RestartSec=10
Nice=5

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload || fail "systemctl --user daemon-reload"
systemctl --user enable igor-llm >/dev/null 2>&1 || fail "activation au démarrage"
systemctl --user restart igor-llm || fail "démarrage (voir : journalctl --user -u igor-llm -n 50)"
ok "$UNIT"

step "6/7 Essai"
up=0
for _ in $(seq 1 120); do
  if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then up=1; break; fi
  systemctl --user is-active --quiet igor-llm || break
  sleep 1
done
[ "$up" = 1 ] || fail "le modèle ne répond pas (voir : journalctl --user -u igor-llm -n 50)"
code=$(curl -s -o /dev/null -w '%{http_code}' -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}' "http://127.0.0.1:$PORT/v1/chat/completions")
[ "$code" = 401 ] || fail "une demande sans clé n'est pas refusée (code $code)"
ok "sans clé : refusé"
reply=$(python3 -I - "$KEY" "$PORT" <<'PY'
import json, sys, time, urllib.request
key = open(sys.argv[1]).read().strip()
body = json.dumps({"messages": [
    {"role": "system", "content": "Tu es Igor, le majordome de la maison. Tu vouvoies et réponds en une phrase."},
    {"role": "user", "content": "Bonjour Igor, tu es prêt ?"}], "max_tokens": 60, "temperature": 0.2}).encode()
req = urllib.request.Request(f"http://127.0.0.1:{sys.argv[2]}/v1/chat/completions", data=body,
                             headers={"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
start = time.time()
with urllib.request.urlopen(req, timeout=60) as r:
    msg = json.loads(r.read())["choices"][0]["message"]["content"].strip()
print(f"{time.time() - start:.1f} s : {msg}")
PY
) || fail "une demande avec la clé n'a pas abouti"
ok "avec clé : $reply"
case "$reply" in *"<think>"*) fail "le modèle réfléchit encore à voix haute (<think>)";; esac
vram=$(cat /sys/class/drm/card*/device/mem_info_vram_used 2>/dev/null | sort -n | tail -1)
[ -n "$vram" ] && ok "mémoire graphique utilisée : $((vram / 1048576)) Mo sur 16 384"
systemctl --user is-active --quiet whisper-server && ok "whisper-server tourne toujours" || printf 'ATTENTION — whisper-server ne tourne pas\n'

step "7/7 Démarrage avec la VM"
if [ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" = yes ]; then
  ok "déjà actif"
else
  sudo loginctl enable-linger "$USER" || fail "sudo loginctl enable-linger $USER"
  ok "activé"
fi

ip=$(hostname -I 2>/dev/null | awk '{print $1}')
printf '\nTerminé. Le modèle répond sur http://%s:%s/v1\n' "${ip:-<ip-de-la-vm>}" "$PORT"
printf 'La clé est dans %s : elle servira à l'\''étape 2, ne l'\''envoie à personne.\n' "$KEY"
