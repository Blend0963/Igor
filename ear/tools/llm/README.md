# Local language model for Igor's voice

`install.sh` turns the llama.cpp server built by `../llm-bench/setup.sh` into a
systemd user service, `igor-llm`, next to `whisper-server`:

- model: Qwen3 8B Q4_K_M (20/20 on the bench, about 2.3 s for a full spoken
  turn on the Radeon VII), hard-linked into `~/.local/share/igor-llm/`;
- listens on `0.0.0.0:8180`, OpenAI-compatible API under `/v1`;
- every request needs the key in `~/.config/igor-llm/api-key` (created once,
  mode 600, never printed); `/health` stays public;
- one slot of 32 768 tokens with 4 GB of prompt cache in RAM; Igor reads the next spoken prompt ahead of time after each request and every 15 s (prewarm), so a request only has the person's words left to read; thinking off. This card reads 576 tokens/s at the start of a prompt but 170 after 8 000, so Igor sends the local model a short prompt (about 6 000 tokens);
- the card stays on automatic clocks (an earlier version forced them high, which kept the fans loud for a few milliseconds' gain; install.sh removes that).

Run it as the normal user on the VM, from this folder:

    bash install.sh

Each step prints OK or ÉCHEC and the script stops at the first failure. It
ends with a test request with and without the key, the graphics memory in use,
and the URL Home Assistant will use.

Useful afterwards:

    systemctl --user status igor-llm
    journalctl --user -u igor-llm -n 50

Keep `~/llama.cpp`: the service runs its `llama-server`.
