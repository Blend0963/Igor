#!/usr/bin/env bash
# Igor — banc d'essai d'un LLM local : mesure.
# Pour chaque modèle de ~/igor-bench/models : démarre llama-server sur
# 127.0.0.1:8180 (whisper-server continue de tourner sur 8178), passe les 20
# demandes de bench.py, puis l'arrête. Rien n'est envoyé hors de la machine.
set -u
BENCH="$HOME/igor-bench"
SERVER="$HOME/llama.cpp/build/bin/llama-server"
HERE="$(cd "$(dirname "$0")" && pwd)"
PORT=8180

ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; }

[ -x "$SERVER" ] || { fail "llama-server absent : lance d'abord bash setup.sh"; exit 1; }
ls "$BENCH"/models/*.gguf >/dev/null 2>&1 || { fail "aucun modèle dans $BENCH/models"; exit 1; }
curl -s -o /dev/null "http://127.0.0.1:$PORT/health" && { fail "le port $PORT est déjà pris"; exit 1; }

for model in "$BENCH"/models/*.gguf; do
  name=$(basename "$model" .gguf)
  printf '\n==================== %s ====================\n' "$name"
  "$SERVER" -m "$model" --host 127.0.0.1 --port "$PORT" -ngl 99 -c 8192 --jinja >"$BENCH/server-$name.log" 2>&1 &
  pid=$!
  up=0
  for _ in $(seq 1 180); do
    if curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then up=1; break; fi
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if [ "$up" = 1 ]; then
    ok "$name chargé"
    python3 -I "$HERE/bench.py" --url "http://127.0.0.1:$PORT" --name "$name" | tee "$BENCH/results-$name.txt"
  else
    fail "$name ne démarre pas (voir $BENCH/server-$name.log)"
  fi
  kill "$pid" 2>/dev/null; wait "$pid" 2>/dev/null
done

printf '\nRésumés :\n'
grep -h "^RÉSUMÉ" "$BENCH"/results-*.txt 2>/dev/null
printf '\nEnvoie-moi ces lignes RÉSUMÉ, et le fichier ~/igor-bench/results-<modèle>.txt du meilleur.\n'
