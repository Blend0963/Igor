# Local language model for Igor's voice

`install.sh` turns the llama.cpp server built by `../llm-bench/setup.sh` into a
systemd user service, `igor-llm`, next to `whisper-server`:

- model: Qwen3 8B Q4_K_M (20/20 on the bench, about 2.3 s for a full spoken
  turn on the Radeon VII), hard-linked into `~/.local/share/igor-llm/`;
- listens on `0.0.0.0:8180`, OpenAI-compatible API under `/v1`;
- every request needs the key in `~/.config/igor-llm/api-key` (created once,
  mode 600, never printed); `/health` stays public;
- two slots of 16 384 tokens, so the conversation keeps its cached prompt while memory extraction and the addressee check use the other, plus 2 GB of prompt cache in RAM; thinking off. Igor sends the local model a short prompt (about 6 000 tokens): this card reads 576 tokens/s at the start of a prompt but 170 after 8 000.

Run it as the normal user on the VM, from this folder:

    bash install.sh

Each step prints OK or ÉCHEC and the script stops at the first failure. It
ends with a test request with and without the key, the graphics memory in use,
and the URL Home Assistant will use.

Useful afterwards:

    systemctl --user status igor-llm
    journalctl --user -u igor-llm -n 50

Keep `~/llama.cpp`: the service runs its `llama-server`.
