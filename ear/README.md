# igor-ear — Igor without a wake word, by name

A small service for the Linux machine that holds the voice satellite's
microphone (linux-voice-assistant). Say "Igor" anywhere in the sentence,
"Igor, éteins la lumière" or "éteins la lumière Igor", and Igor answers
through the satellite, no "Ok Nabu" first.

```
microphone (PipeWire, shared with linux-voice-assistant)
  → voice activity (Silero, CPU, ~0.3 ms per 32 ms frame)
  → local transcription, only to hear the name (Whisper small; GPU, else CPU)
  → "Igor" in the sentence? (or "Igor" alone, then the order; or the answer
    to a question Igor just asked)
  → the recorded audio goes to Home Assistant's Assist pipeline in the
    satellite's name: Voxtral transcribes it properly, Igor answers in its
    spoken style, the wall tablet shows it
  → the satellite says the answer (assist_satellite.announce)
```

A long request is fine: Igor gets the whole recording (up to a minute), and
a pause of less than 0.6 s (`[mode] join_gap`) does not end it; Whisper only checks the first
8 and last 6 seconds for the name. Nothing leaves the machine unless the
sentence names Igor. While the
satellite is busy (after its own wake word, or speaking) the service stays
quiet, so the wake word keeps working and Igor never answers its own voice.

**Observation mode** (the default, `[mode] act = false`): nothing is sent;
each sentence is noted in `~/.local/state/igor-ear/observations.jsonl` on
this machine with what would have happened, to judge the name detection on
real life first. Audio is never written to disk; notes are deleted after
`keep_days` (7 by default).

## Install

```sh
sudo apt install -y git
git clone --depth 1 https://github.com/Blend0963/MaDo.git ~/MaDo
bash ~/MaDo/ear/install.sh
```

Then edit `~/.config/igor-ear/config.toml`: microphone source (from
`pactl list short sources`), Home Assistant URL, a long-lived token
(Profile > Security), the satellite entity and optionally a presence entity.
`act = true` once observation looks right. Then:

```sh
~/.local/share/igor-ear/run.sh bench                 # time the transcription
systemctl --user enable --now igor-ear              # start listening
journalctl --user -u igor-ear -f                    # follow it
~/.local/share/igor-ear/run.sh report               # what it would have sent
~/.local/share/igor-ear/run.sh check "éteins le salon Igor"   # test the rule
```

Update: `git -C ~/MaDo pull && bash ~/MaDo/ear/install.sh && systemctl --user restart igor-ear`.

## Smart mode: without the name

`[mode] addressing = "smart"` also takes requests said without "Igor". A
sentence that looks like one (it starts with an order, "éteins la lumière",
or is a question) goes to a small AI on this machine, with the sentences
heard just before; it says whether the sentence is for Igor or for someone
in the room. Nothing heard leaves the machine for this. "Igor" in the
sentence still works as always, and `addressing = "name"` switches back.

- **The AI** runs in [Ollama](https://ollama.com), on this machine:
  ```sh
  curl -fsSL https://ollama.com/install.sh | sh
  ollama pull qwen2.5:3b
  ```
  qwen2.5:3b needs about 2.5 GB of memory (give the VM 6 GB or more) and
  takes 2 to 3 seconds per judged sentence on 4 CPU cores, less on a GPU.
  Measured on 34 everyday sentences: 33 right, no false "yes", one question
  missed. A model this small says "no" when unsure; say "Igor" then.
- **Television and radio**: while sound plays, sentences without the name
  are not judged at all, so a film cannot give orders. By default
  (`[smart] sound_from = "speakers"`) igor-ear listens to what comes out of
  this machine's speakers (the monitor of its output, 8 kHz mono): the
  television, the radio, a phone over Bluetooth, anything the hub plays. A
  muted output or one at 0 % counts as silence, and sound counts for 3 s
  more so a pause in a film does not reopen the judge. Set the threshold
  with `~/.local/share/igor-ear/run.sh sound` (once with music playing, once
  in silence) and `quiet_db`. `sound_from = "players"` uses the Home
  Assistant media players listed in `media_players` instead, `"both"` both.
  `when_media = "closed"` goes further: nothing is heard, not even the name.
- **Try it first**: with `[smart] act = false` (the default) Igor only notes
  what it would have done, `WOULD ACT` in the journal and
  `smart_would_act` in the observations. Read a few days of it, then set
  `act = true`.

## Resources

The service runs at low priority (nice 10, at most two CPUs, idle I/O,
2 GB of memory) so that sound and Bluetooth on the same machine come first.
On a GTX 960 (2 GB, compute capability 5.2) CTranslate2 runs float32 only:
"small" fits in about 1 GB. CTranslate2 4.x has no kernels for such Maxwell
cards ("cudaErrorInvalidDevice"), so `install.sh` detects a compute
capability below 6.0 and installs CTranslate2 3.24 with CUDA 11 on a
Python 3.12 that uv downloads into the app folder.

## Tests

```sh
pip install pytest numpy && python -m pytest ear/tests
```
