# Local language model for Igor's voice

`install.sh` turns the llama.cpp server built by `../llm-bench/setup.sh` into a
systemd user service, `igor-llm`, next to `whisper-server`:

- model: Qwen3 8B Q4_K_M (20/20 on the bench, about 2.3 s for a full spoken
  turn on the Radeon VII), hard-linked into `~/.local/share/igor-llm/`;
- listens on `0.0.0.0:8180`, OpenAI-compatible API under `/v1`;
- every request needs the key in `~/.config/igor-llm/api-key` (created once,
  mode 600, never printed); `/health` stays public;
- one slot of 32 768 tokens (Igor's real prompt is over 16 000), thinking off.

Run it as the normal user on the VM, from this folder:

    bash install.sh

Each step prints OK or ÉCHEC and the script stops at the first failure. It
ends with a test request with and without the key, the graphics memory in use,
and the URL Home Assistant will use.

Useful afterwards:

    systemctl --user status igor-llm
    journalctl --user -u igor-llm -n 50

Keep `~/llama.cpp`: the service runs its `llama-server`.
