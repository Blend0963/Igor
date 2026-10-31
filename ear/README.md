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
a pause of less than 0.6 s (`[mode] join_gap`; 1.2 s, `order_gap`, once Igor
waits for an order) does not end it; Whisper only checks the first
8 and last 6 seconds for the name. Nothing leaves the machine unless the
sentence names Igor. While the
satellite is busy (after its own wake word, or speaking) the service stays
quiet, so the wake word keeps working and Igor never answers its own voice.
While Igor speaks through the satellite (an answer, its "Oui ?") the ear is
closed: for the whole announce call, then, since Home Assistant may answer
before the voice even plays, until the voice has come out of the speakers
(4 s at most) and they have fallen quiet (2 s at most, if a television
plays). The journal says each time how long and why ("Ear closed 3.2 s
while Igor spoke…"). And should its voice still come back, a sentence that
starts with what Igor just said (in the last 30 s) is its own: dropped
(`own_voice`), or, with words after it, only those are read.

The name is heard twice: by Whisper, and by Vosk (`[name] spotter`), a
small French recogniser on the CPU that runs at the same time. The name
heard by either one counts; Vosk is steadier on a short name said alone,
at the start or the end, where Whisper "base" writes "Hector" or "ignore".
`[name] names` sets the names it answers to (`["igor"]`, `["mado"]`, or
both); Whisper is told to expect them. `install.sh` installs Vosk and its
41 MB model (checked against its SHA-256).

Said alone, "Igor" gets a short question aloud in its own voice ("Oui,
monsieur ?", "Que puis-je pour vous ?"…: about seventy, each said once in
random order before any comes back; `[mode] name_reply` replaces them, `[]`
for silence). Once it has finished saying it, the tablet shows "Je vous
écoute…", and the next sentence begun within `name_wait` seconds (8), however
long it lasts, is the order:
whatever is said then is for Igor, without the name (the satellite still
reporting its own reply, or Whisper doubting a short answer, no longer drop
it). With `[mode] name_alone = "satellite"` the satellite says the reply and
listens itself instead (`assist_satellite.start_conversation`), as after its
wake word; if it cannot, this ear takes the order.

Igor talked about rather than to is ignored (`mention` in the journal):
"c'est Igor l'autre jour qui a fait ça", "demande à Igor", "Igor a encore
éteint". French marks it around the name (a word like c'est, à, de, avec,
le, que just before it, or a third-person verb right after it with no
comma); said to Igor, the name stands apart, first or last or between
commas, and an order ("Igor éteins…") is always taken.

Whisper sometimes pads a lone "Igor" with a word or two ("Je m'appelle
Igor"). Such a short call (at most three words around the name, with no
verb, room, device, question or thanks) still goes to Igor as it is, in
case it was a short order; then the next sentence, begun within
`followup_seconds` (8), is taken without the name.

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
`pactl list short sources`), Home Assistant URL (its address on the local
network, `http://<ip>:8123`: through a public name, every sentence leaves the
house and back, and a name that resolves slowly adds seconds to each one;
one install measured 5.1 s against 0.014 s), a long-lived token
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
  These settings are in `[media]` and `when_media = "closed"` works in the
  "name" mode too: while the television plays, the ear is closed, except
  for the answer to a question Igor has just asked.
  With `when_media = "strict"`, in either mode, the ear is
  stricter while sound plays, since a film's voices were most of its false
  starts: the name must be heard by Whisper (Vosk alone or a name one
  letter off is ignored, `vosk_ignored` / `near_name_media`), and Igor's
  listening windows (after "Igor" alone, after its question) take only an
  order, a question or an answer of three words at most
  (`media_not_request` otherwise). Measure the silence first with
  `run.sh sound`: if it reads above `quiet_db`, the ear takes the house for
  noisy all the time and stays strict.
- **Try it first**: with `[smart] act = false` (the default) Igor only notes
  what it would have done, `WOULD ACT` in the journal and
  `smart_would_act` in the observations. Read a few days of it, then set
  `act = true`.

## Answers said as they are written

Igor's answer streams in from Home Assistant (intent-progress events, a
recent Home Assistant). Each whole sentence is announced as soon as it is
written, the next one once the previous has been heard to its end, so a
long answer starts speaking without waiting for the rest nor for the voice
of the rest. The journal says when the first sentence went out ("First
sentence said after …"). With a Home Assistant that does not stream the
answer, it is said whole at the end, as before.

## Resources

**On an AMD card, or any machine running whisper-server** (the Radeon VII
VM): set `[stt] server = "http://127.0.0.1:8178"`. Each sentence is then
transcribed by whisper.cpp on the GPU, about half a second, instead of
faster-whisper on two CPU cores at low priority (faster-whisper only knows
NVIDIA cards; on an AMD one it falls back to the CPU and logs "GPU
unusable"). The journal says which one runs at start ("Transcription:"),
and after each sentence sent, how long Igor took to answer ("Igor answered
in …").

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
