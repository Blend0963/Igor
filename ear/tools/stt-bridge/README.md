# Home Assistant speech-to-text on the ear VM's GPU

`bridge.py` is a small Wyoming server: Home Assistant's voice pipelines send it
the recorded audio on port 10300, it resamples it to 16 kHz mono, posts it to
the whisper.cpp server already running on this VM (`whisper-server`, Vulkan,
`127.0.0.1:8178`, `/inference`) and returns the text. The audio never leaves
the house, and the card works about half a second per sentence.

Install as the normal user on the VM, with `bridge.py` next to `install.sh`:

    bash install.sh

Then in Home Assistant: Settings → Devices & services → Add integration →
Wyoming Protocol, host = the VM's address, port 10300, and pick `igor-stt` as
the speech-to-text of the voice assistant.

Wyoming has no authentication: the port is open to the local network only.
Logs: `journalctl --user -u igor-stt -n 50`.
