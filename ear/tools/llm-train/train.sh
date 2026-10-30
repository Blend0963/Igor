#!/usr/bin/env bash
# Igor — entraînement du modèle local sur la maison, sur une machine louée
# avec une carte NVIDIA (24 Go ou plus) : LoRA sur Qwen3 4B, puis un fichier
# GGUF Q4_K_M que la VM charge avec ../llm/install.sh.
# Chaque étape affiche OK ou ÉCHEC ; au premier ÉCHEC, rien d'autre n'est fait.
#   bash train.sh igor-local-dataset.zip
# Le jeu d'entraînement décrit la maison : supprime la machine louée après.
# À la fin, le modèle part directement sur la VM (runpodctl receive).
set -u
ZIP="${1:-}"
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-$([ -d /workspace ] && echo /workspace/igor-train || echo "$HOME/igor-train")}"
DATA="$WORK/data"
OUT="$WORK/out"
GGUF="$OUT/igor-local-q4_k_m.gguf"

step() { printf '\n== %s\n' "$1"; }
ok() { printf 'OK — %s\n' "$1"; }
fail() { printf 'ÉCHEC — %s\n' "$1"; exit 1; }

# Sur RunPod, la machine s'arrête toute seule à la fin, mais seulement après
# avoir remis le modèle à la VM (étape 7) : un pod arrêté peut revenir vide.
# Sans réception au bout de SEND_WAIT secondes (3 h), elle reste allumée pour ne
# rien perdre. En cas d'échec avant le modèle, elle s'arrête au bout d'une
# minute. AUTO_STOP=0 pour la laisser toujours tourner.
stop_pod() {
  [ -n "${RUNPOD_POD_ID:-}" ] && [ "${AUTO_STOP:-1}" = 1 ] || return 0
  printf '\nArrêt de la machine dans 60 s.\n'
  sleep 60
  runpodctl stop pod "$RUNPOD_POD_ID" >/dev/null 2>&1 \
    || printf 'ATTENTION — arrêt automatique impossible : arrête la machine toi-même sur runpod.io\n'
}
trap stop_pod EXIT

step "1/7 Carte graphique"
command -v nvidia-smi >/dev/null || fail "pas de carte NVIDIA (nvidia-smi absent)"
vram=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1 | tr -dc 0-9)
[ "${vram:-0}" -ge 22000 ] || fail "il faut 24 Go de mémoire graphique, la carte en a ${vram:-0} Mo"
ok "$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1), ${vram} Mo"

step "2/7 Jeu d'entraînement"
[ -n "$ZIP" ] && [ -s "$ZIP" ] || fail "donne le fichier : bash train.sh igor-local-dataset.zip"
mkdir -p "$DATA" "$OUT"
python3 -I -c 'import sys, zipfile; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])' "$ZIP" "$DATA" || fail "lecture de $ZIP"
[ -s "$DATA/train.jsonl" ] && [ -s "$DATA/test.jsonl" ] || fail "train.jsonl ou test.jsonl manquant dans $ZIP"
ok "$(wc -l <"$DATA/train.jsonl") exemples d'entraînement, $(wc -l <"$DATA/test.jsonl") de test"

step "3/7 Bibliothèques Python"
# --system-site-packages : garde le PyTorch déjà installé sur la machine louée.
[ -x "$WORK/venv/bin/python" ] || python3 -m venv --system-site-packages "$WORK/venv" || fail "création de $WORK/venv"
PY="$WORK/venv/bin/python"
"$PY" -c 'import torch; assert torch.cuda.is_available()' 2>/dev/null \
  || "$PY" -m pip install -q torch || fail "installation de PyTorch"
"$PY" -m pip install -q "transformers==4.56.2" "peft==0.17.1" "accelerate==1.10.1" safetensors sentencepiece protobuf cmake \
  || fail "installation de transformers et peft"
"$PY" -c 'import torch; assert torch.cuda.is_available(), "CUDA"' || fail "PyTorch ne voit pas la carte"
# Facultatif : sans lui l'entraînement tourne quand même, un exemple à la fois, plus lentement.
"$PY" -m pip install -q "liger-kernel==0.6.2" || printf 'ATTENTION — Liger Kernel non installé : entraînement plus lent\n'
ok "$("$PY" -c 'import torch, transformers, peft; print(f"torch {torch.__version__}, transformers {transformers.__version__}, peft {peft.__version__}")')"

# Fewer, larger free blocks: the logits of a long example need one big piece.
export PYTORCH_CUDA_ALLOC_CONF="${PYTORCH_CUDA_ALLOC_CONF:-expandable_segments:True}"
step "4/7 Entraînement (environ 40 min sur une RTX 4090, moins sur une A100)"
(cd "$HERE" && "$PY" train.py "$DATA" "$OUT") 2>&1 | tee "$OUT/train.log"
[ "${PIPESTATUS[0]}" = 0 ] || fail "entraînement (voir $OUT/train.log)"
[ -s "$OUT/merged/config.json" ] || fail "modèle entraîné introuvable dans $OUT/merged"
ok "$(grep '^SCORE' "$OUT/train.log" | tail -1) sur des phrases jamais vues"

step "5/7 llama.cpp (conversion)"
LC="$WORK/llama.cpp"
[ -d "$LC/.git" ] || git clone -q --depth 1 https://github.com/ggml-org/llama.cpp "$LC" || fail "téléchargement de llama.cpp"
"$PY" -m pip install -q "$LC/gguf-py" || fail "installation de gguf-py"
if [ ! -x "$LC/build/bin/llama-quantize" ]; then
  PATH="$WORK/venv/bin:$PATH" cmake -S "$LC" -B "$LC/build" -DGGML_CUDA=OFF -DLLAMA_CURL=OFF >/dev/null \
    && PATH="$WORK/venv/bin:$PATH" cmake --build "$LC/build" --target llama-quantize -j >/dev/null \
    || fail "compilation de llama-quantize (cmake et un compilateur C++ sont-ils installés ?)"
fi
ok "$LC"

step "6/7 Fichier GGUF Q4_K_M"
"$PY" "$LC/convert_hf_to_gguf.py" "$OUT/merged" --outtype f16 --outfile "$OUT/igor-local-f16.gguf" >"$OUT/convert.log" 2>&1 \
  || fail "conversion en GGUF (voir $OUT/convert.log)"
"$LC/build/bin/llama-quantize" "$OUT/igor-local-f16.gguf" "$GGUF" Q4_K_M >"$OUT/quantize.log" 2>&1 \
  || fail "quantification Q4_K_M (voir $OUT/quantize.log)"
rm -f "$OUT/igor-local-f16.gguf"
ok "$GGUF ($(du -h "$GGUF" | cut -f1))"

step "7/7 Envoi à la VM"
# Le modèle et le bilan partent ensemble, par le relais de runpodctl : sur la
# VM, « runpodctl receive <code> » les dépose dans le dossier courant.
SEND="$WORK/igor-modele"
rm -rf "$SEND" && mkdir -p "$SEND" && cp "$GGUF" "$OUT/eval.json" "$OUT/train.log" "$SEND/" || fail "préparation de $SEND"
if ! command -v runpodctl >/dev/null; then
  printf 'ATTENTION — runpodctl absent : télécharge %s toi-même, la machine reste allumée.\n' "$SEND"
  AUTO_STOP=0
  exit 0
fi
printf '\nSur la VM, dans le dossier où tu veux le modèle, tape la commande\n'
printf '« runpodctl receive … » affichée ci-dessous (le code change à chaque fois).\n'
printf 'La machine attend %s min au plus et ne s'\''arrête qu'\''une fois le modèle reçu.\n\n' "$(( ${SEND_WAIT:-10800} / 60 ))"
if timeout "${SEND_WAIT:-10800}" runpodctl send "$SEND"; then
  ok "modèle reçu par la VM"
else
  printf 'ÉCHEC — personne n'\''a reçu le modèle : il reste dans %s\n' "$SEND"
  printf 'La machine reste allumée. Relance l'\''envoi sans réentraîner : runpodctl send %s\n' "$SEND"
  AUTO_STOP=0
  exit 1
fi
