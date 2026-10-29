# Training the local model on the house

Igor's local model has one job: turn what is said into the tool calls that
carry it out, or answer `-` so the online model answers. A small model
fine-tuned on the house does that with a much shorter prompt: it knows the
rooms, the devices and how each light takes white or a colour, so Igor no
longer sends it the room map or the light cheat sheet (option
`local_llm_tuned`).

## 1. The training set

In the Igor panel, open **Diagnostic** and click **Jeu d'entraînement du
modèle local**. It downloads `igor-local-dataset.zip`, built from the
entities exposed to Assist:

- `train.jsonl`: a few thousand requests, each exactly as Igor sends it to
  the local model, followed by the expected answer;
- `test.jsonl`: requests phrased in ways training never sees, for the bench;
- `sample.txt`: examples to read.

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
   machine's PyTorch;
4. trains a LoRA on `Qwen/Qwen3-4B-Instruct-2507` (2 epochs; about 3,000 tokens per example, so one to two hours on an RTX 4090, less on an A100 or H100; `EPOCHS=1` halves it),
   merges it, and scores 200 held-out requests (`out/eval.json`);
5. builds llama.cpp's converter;
6. writes `out/igor-local-q4_k_m.gguf` (about 2.5 GB).

Settings, as environment variables: `BASE_MODEL`, `EPOCHS`, `LR`, `BATCH`,
`ACCUM`, `MAX_LEN`, `EVAL`, `WORK`.

Only the model's own answers are learned: past messages in an example (what
the online model said) are marked `"training": false` and masked.

Delete the rented machine afterwards: it holds the training set.

## 3. On the VM

Copy the GGUF file to the VM, then install it as the `igor-llm` service:

    bash ../llm/install.sh ~/igor-local-q4_k_m.gguf

In the add-on, turn on `local_llm_tuned`. To go back: `bash ../llm/install.sh`
(Qwen3 8B) and turn the option off.

## 4. Bench

On the VM, against the running service:

    python3 bench.py ~/igor-local-dataset/test.jsonl

It prints the score per kind of request and the median time, and writes the
misses to `bench-misses.json` next to the test file. Run it with the tuned
model and `local_llm_tuned` on; for a comparison, run it with the base Qwen3
8B too (it gets the same short prompt, so it is expected to miss what only
the tuned model has learned).
