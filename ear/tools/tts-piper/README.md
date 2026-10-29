# Home Assistant text-to-speech on the ear VM (Piper)

`install.sh` runs `wyoming-piper` (Home Assistant's own Piper server) as the
`igor-tts` user service on port 10200, with a French voice
(`fr_FR-tom-medium` by default; pass another as the first argument, e.g.
`bash install.sh fr_FR-siwis-medium`). Piper runs on the CPU: the graphics
card stays idle. The voice is downloaded on first start into
`~/.local/share/igor-tts/voices`.

Then in Home Assistant: Settings → Devices & services → Add integration →
Wyoming Protocol, host = the VM's address, port 10200, and pick it as the
text-to-speech of the voice assistant.

Wyoming has no authentication: the port is open to the local network only.
Logs: `journalctl --user -u igor-tts -n 50`.
