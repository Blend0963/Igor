# mado-ear — MaDo without a wake word (observation mode)

A small service for the Linux machine that holds the voice satellite's
microphone. It listens all the time, but decides locally, sentence by
sentence, whether the sentence was meant for MaDo:

```
microphone (PipeWire, shared with linux-voice-assistant)
  → voice activity (Silero, CPU, ~0.3 ms per 32 ms frame)
  → local transcription (faster-whisper "small"; GPU float32, else CPU int8)
  → rules: "MaDo" anywhere in the sentence, or an order about the house
    (an action verb and a room or device), or a follow-up after MaDo spoke
```

**Observation mode** (this version): nothing is sent anywhere. Each sentence
is noted in `~/.local/state/mado-ear/observations.jsonl` on this machine,
with what MaDo would have done, so the rules can be judged on real life
(television, conversations) before they are allowed to act. Audio is never
written to disk; notes are deleted after `keep_days` (7 by default).

## Install

```sh
sudo apt install -y git
git clone --depth 1 https://github.com/Blend0963/MaDo.git ~/MaDo
bash ~/MaDo/ear/install.sh
```

Then edit `~/.config/mado-ear/config.toml` (microphone source from
`pactl list short sources`, optional Home Assistant presence entity), and:

```sh
~/.local/share/mado-ear/run.sh bench                 # time the transcription
systemctl --user enable --now mado-ear              # start listening
journalctl --user -u mado-ear -f                    # follow it
~/.local/share/mado-ear/run.sh report               # what it would have sent
~/.local/share/mado-ear/run.sh check "éteins le salon"   # test the rules
```

Update: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart mado-ear`.

## Resources

The service runs at low priority (nice 10, at most two CPUs, idle I/O,
2 GB of memory) so that sound and Bluetooth on the same machine come first.
On a GTX 960 (2 GB, compute capability 5.2) CTranslate2 runs float32 only:
"small" fits in about 1 GB.

## Tests

```sh
pip install pytest numpy && python -m pytest ear/tests
```
