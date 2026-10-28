#!/usr/bin/env bash
# Igor — banc d'essai d'un LLM local : installation.
# Compile llama.cpp (Vulkan) et télécharge les modèles à comparer dans
# ~/igor-bench. Ne touche ni à igor-ear, ni à whisper-server, ni à leurs
# fichiers. Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, rien d'autre
# n'est fait.
set -u
BENCH="$HOME/igor-bench"
LLAMA="$HOME/llama.cpp"
MODELS="$BENCH/models"
mkdir -p "$MODELS"

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; exit 1; }

step "1/5 Carte graphique vue par Vulkan"
command -v vulkaninfo >/dev/null || fail "vulkaninfo manquant : sudo apt install vulkan-tools, puis relance"
ls /dev/dri/renderD* >/dev/null 2>&1 || fail "aucune carte dans /dev/dri : la VM ne voit pas la carte graphique"
vulkaninfo --summary >"$BENCH/vulkan.log" 2>&1
gpu=$(grep -i "deviceName" "$BENCH/vulkan.log" | grep -iv llvmpipe | head -1 | sed 's/.*= *//')
[ -n "$gpu" ] && ok "$gpu" || fail "Vulkan ne voit pas la carte (voir $BENCH/vulkan.log)"

step "2/5 Espace disque"
free=$(df -BG --output=avail "$HOME" | tail -1 | tr -dc 0-9)
[ "${free:-0}" -ge 10 ] && ok "$free Go libres" || fail "il faut 10 Go libres dans $HOME, il y en a ${free:-0}"

step "3/5 Outils de compilation"
for t in git cmake make g++ curl python3 glslc; do
  command -v "$t" >/dev/null || fail "$t manquant : sudo apt install git cmake build-essential curl python3 glslc libvulkan-dev"
done
ok "git, cmake, make, g++, curl, python3, glslc"

step "4/5 llama.cpp (Vulkan)"
if [ -x "$LLAMA/build/bin/llama-server" ]; then
  ok "déjà compilé dans $LLAMA"
else
  [ -e "$LLAMA" ] && fail "$LLAMA existe déjà sans llama-server : déplace-le, puis relance"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp "$LLAMA" >"$BENCH/build.log" 2>&1 \
    || fail "téléchargement de llama.cpp (voir $BENCH/build.log)"
  cmake -S "$LLAMA" -B "$LLAMA/build" -DGGML_VULKAN=ON -DLLAMA_CURL=OFF -DCMAKE_BUILD_TYPE=Release >>"$BENCH/build.log" 2>&1 \
    || fail "configuration (voir $BENCH/build.log)"
  cmake --build "$LLAMA/build" --target llama-server -j"$(nproc)" >>"$BENCH/build.log" 2>&1 \
    || fail "compilation (voir $BENCH/build.log)"
  ok "llama-server compilé"
fi

step "5/5 Modèles (≈ 5 à 9 Go chacun)"
# nom | adresse. Un modèle qui ne se télécharge pas est signalé et sauté.
while IFS='|' read -r name url; do
  [ -z "$name" ] && continue
  file="$MODELS/$name.gguf"
  if [ -s "$file" ]; then ok "$name déjà là ($(du -h "$file" | cut -f1))"; continue; fi
  if curl -fL --retry 3 -C - -o "$file.part" "$url" 2>>"$BENCH/download.log"; then
    mv "$file.part" "$file" && ok "$name ($(du -h "$file" | cut -f1))"
  else
    printf 'ÉCHEC — %s non téléchargé (voir %s), on continue sans lui\n' "$name" "$BENCH/download.log"
  fi
done <<'LIST'
qwen3-8b|https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q4_K_M.gguf
qwen3-8b-q6|https://huggingface.co/Qwen/Qwen3-8B-GGUF/resolve/main/Qwen3-8B-Q6_K.gguf
ministral-8b|https://huggingface.co/bartowski/Ministral-8B-Instruct-2410-GGUF/resolve/main/Ministral-8B-Instruct-2410-Q4_K_M.gguf
qwen3-14b|https://huggingface.co/Qwen/Qwen3-14B-GGUF/resolve/main/Qwen3-14B-Q4_K_M.gguf
LIST

printf '\nTerminé. Lance ensuite : bash run.sh   (ou bash run.sh qwen3-8b pour ne passer que ceux-là)\n'
