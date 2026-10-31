# Training the local model on the house

Igor's local model is the house: it turns what is said into the tool calls
that carry it out, on any entity, and ends with one line for Igor's voice
(`-` nothing to say, `>dire`, `>rep`, `>web`, `>libre`, `>demande`; see
`server/src/home-mind-server/src/llm/local-protocol.ts`). A small model
fine-tuned on the house does that with a much shorter prompt: it knows the
rooms, the devices and how each light takes white or a colour, so Igor no
longer sends it the room map or the light cheat sheet (option
`local_llm_tuned`).

## 1. The training set

In the Igor panel, open **Diagnostic** and click **Jeu d'entraînement :
toute la maison** (every entity, nothing to expose) or **Entités exposées
seulement**. The browser downloads `igor-local-dataset.zip`; nothing is kept
on the server. Its size grows with the house (8 examples per device, 4,000
to 20,000):

- `train.jsonl`: a few thousand requests, each exactly as Igor sends it to
  the local model, followed by the expected answer;
- `test.jsonl`: requests phrased in ways training never sees, for the bench;
- `sample.txt`: examples to read.
- `a-revoir.txt`: your real requests that failed or that you corrected.

With `local_turn_log` on (the default), the real requests the local model
handled and that worked are replayed in the training set (kind `real`), and a
sixth of them is held out in `test.jsonl`. Devices you switch often get more
examples. A week or two of use before training makes the biggest difference.

Your own words: give devices **aliases** in Home Assistant (Settings → Voice
assistants → Expose → the entity → Aliases); they become their preferred names.
And write phrases in **`igor-phrases.txt`** in Home Assistant's config folder,
one per line, from the ids in `appareils.txt`:

    passe l'aspirateur => vacuum.start vacuum.dreamebot_l10_prime
    mets la lumière du salon à fond => light.turn_on light.salon {"brightness_pct": 100}
    il fait combien dehors => get_state sensor.temperature_exterieure
    ferme tout et dis-moi quand c'est fait => cover.close_cover cover.salon >dire
    qui a gagné le match => web

Several actions are joined with ` + `; a trailing `>dire`, `>rep`… replaces the
default line. Unreadable lines are listed in `phrases-erreurs.txt`.

The file describes your house. Keep it to yourself.

## 2. Training (rented NVIDIA GPU, 24 GB or more)

The Radeon VII cannot train (no CUDA), so rent a machine by the hour
(RunPod, Vast.ai…) with a PyTorch image and a card with 24 GB or more (RTX
4090, A6000, L40S, A100…). Copy this folder and the zip onto it, then:

    bash train.sh igor-local-dataset.zip

Each step prints OK or ÉCHEC and the script stops at the first failure:

1. checks the card;
2. unpacks the training set;
3. installs transformers, peft and accelerate (pinned versions) next to the
   machine's PyTorch, and Liger Kernel if it can (fused loss: four examples
   per step on 24 GB instead of one);
4. trains a LoRA on `Qwen/Qwen3-4B-Instruct-2507` (1 epoch; about 1,500
   tokens per example, so roughly an hour for 7,000 examples on an RTX 4090
   with Liger Kernel; the first run, 2 epochs one example at a time, took
   4 hours), merges it, and scores 200 held-out requests (`out/eval.json`,
   with the words, the expected answer and the model's for each miss);
5. builds llama.cpp's converter;
6. writes `out/igor-local-q4_k_m.gguf` (about 2.5 GB);
7. hands the model, `eval.json` and `train.log` straight to the VM: it prints
   a `runpodctl receive <code>` command to type on the VM, and waits up to
   3 hours (`SEND_WAIT`, in seconds).

Settings, as environment variables: `BASE_MODEL`, `EPOCHS`, `LR`, `BATCH`,
`ACCUM`, `MAX_LEN`, `EVAL`, `WORK`, `SEND_WAIT`.

Only the model's own answers are learned: past messages in an example (what
the online model said) are marked `"training": false` and masked.

On RunPod the machine **stops by itself** once the VM has received the model
(`AUTO_STOP=0` to keep it running), and a minute after a failure that left no
model. If nobody receives it, it stays on, so nothing is lost: send it again
with `runpodctl send /workspace/igor-train/igor-modele`. Do not count on a
stopped pod to keep its files: restarted without a GPU, it can come back
empty. Once the model is on the VM, **Terminate** the pod: it holds the
training set.

On the VM, `runpodctl` installs with:

    wget -qO- cli.runpod.net | sudo bash

## 3. On the VM

The model is already in the folder where you ran `runpodctl receive`.
Install it as the `igor-llm` service:

    bash ../llm/install.sh ~/igor-modele/igor-local-q4_k_m.gguf

In the add-on, turn on `local_llm_tuned`, and turn off `tools_from_exposed`
so it can drive every entity, not only those exposed to Assist. To go back: `bash ../llm/install.sh`
(Qwen3 8B) and turn the option off.

## 4. Bench

On the VM, against the running service:

    python3 bench.py ~/igor-local-dataset/test.jsonl

It prints the score per kind of request and the median time, and writes the
misses to `bench-misses.json` next to the test file. Run it with the tuned
model and `local_llm_tuned` on; for a comparison, run it with the base Qwen3
8B too (it gets the same short prompt, so it is expected to miss what only
the tuned model has learned).
